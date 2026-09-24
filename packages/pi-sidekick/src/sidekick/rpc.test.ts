import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Parse } from "typebox/value";
import { PiRpc, resolveLaunch } from "./rpc.ts";
import type { RpcEvent } from "./rpc.ts";
import { SIDEKICK_RUNNER_FIXTURE } from "../../test/sidekick-runner-test-utils.ts";

test("Pi executable overrides never use shell tokenization", () => {
  assert.deepEqual(
    resolveLaunch({ PI_SIDEKICK_PI: "/a path/node", PI_SIDEKICK_PI_ARGS: '["/a path/pi.js"]' }),
    { command: "/a path/node", args: ["/a path/pi.js"] },
  );
  assert.throws(() => resolveLaunch({ PI_SIDEKICK_PI: "node", PI_SIDEKICK_PI_ARGS: "-e shell" }));
  assert.deepEqual(resolveLaunch({}, ["node", "/installed/pi/dist/bundle/cli.js"], "/bin/node"), {
    command: "/bin/node",
    args: ["/installed/pi/dist/bundle/cli.js"],
  });
});

test("legacy executable overrides are ignored while Sidekick overrides work", () => {
  const oldExecutableName = "PI_FUSION_PI";
  const oldArgumentsName = "PI_FUSION_PI_ARGS";
  assert.deepEqual(
    resolveLaunch(
      { [oldExecutableName]: "/legacy/node", [oldArgumentsName]: '["/legacy/pi.js"]' },
      ["node", "not-a-pi-entry"],
      "/bin/node",
    ),
    { command: "pi", args: [] },
  );
  assert.deepEqual(
    resolveLaunch(
      { PI_SIDEKICK_PI: "/new/node", PI_SIDEKICK_PI_ARGS: '["/new/pi.js"]' },
      ["node", "not-a-pi-entry"],
      "/bin/node",
    ),
    { command: "/new/node", args: ["/new/pi.js"] },
  );
});

function client(scenario = "normal", maxRecordBytes = 4096) {
  const cwd = mkdtempSync(join(tmpdir(), "sidekick-rpc-"));
  const journal = join(cwd, "journal");
  const rpc = new PiRpc({
    launch: {
      command: process.execPath,
      args: [SIDEKICK_RUNNER_FIXTURE, "--scenario", scenario, "--journal", journal],
    },
    args: [],
    cwd,
    requestTimeoutMs: 500,
    killGraceMs: 5,
    maxRecordBytes,
  });
  return {
    rpc,
    journal,
    cleanup: async () => {
      await rpc.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}
test("RPC correlates simultaneous requests and handles fragmented UTF-8 and Unicode separators", async () => {
  const h = client();
  try {
    await h.rpc.start();
    const [b, c] = await Promise.all([
      h.rpc.request("echo", { x: 42 }),
      h.rpc.request("echo", { x: 43 }),
    ]);
    const echoSchema = Type.Object({ echo: Type.Object({ x: Type.Number() }) });
    assert.equal(Parse(echoSchema, b).echo.x, 42);
    assert.equal(Parse(echoSchema, c).echo.x, 43);
    const a = await h.rpc.request("unicode");
    assert.equal(a.text, "Aπ😀\u2028B\u2029C");
  } finally {
    await h.cleanup();
  }
});
test("RPC request timeout does not poison subsequent requests", async () => {
  const h = client();
  try {
    await h.rpc.start();
    await assert.rejects(h.rpc.request("never_respond", {}, 20), /timed out/u);
    assert.ok(await h.rpc.request("get_state"));
  } finally {
    await h.cleanup();
  }
});
test("malformed startup output fails without hanging", async () => {
  const h = client("bad-start");
  try {
    await assert.rejects(h.rpc.start(), /Invalid sidekick JSONL/u);
  } finally {
    await h.cleanup();
  }
});

test("schema-valid responses missing dispatch fields fail without escaping", async () => {
  const h = client("missing-response-id");
  try {
    await assert.rejects(h.rpc.start(), /Cannot process sidekick JSONL record/u);
  } finally {
    await h.cleanup();
  }
});
for (const kind of ["bad_record", "oversized", "unterminated"])
  test(`RPC fails closed on ${kind}`, async () => {
    const h = client("normal", 1000);
    try {
      await h.rpc.start();
      const failure = new Promise<Error>((resolve) => h.rpc.once("failure", resolve));
      const req = h.rpc.request(kind);
      await assert.rejects(req);
      assert.ok(await failure);
      assert.equal(h.rpc.alive, false);
    } finally {
      await h.cleanup();
    }
  });
test("abort clears queued work before aborting and close is idempotent", async () => {
  const h = client("hang");
  try {
    await h.rpc.start();
    await h.rpc.request("prompt", { message: "work" });
    await h.rpc.abort();
    const events = readFileSync(h.journal, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.deepEqual(
      events.slice(-2).map((x) => x.type),
      ["clear_queue", "abort"],
    );
    await Promise.all([h.rpc.close(), h.rpc.close()]);
    assert.equal(h.rpc.alive, false);
  } finally {
    await h.cleanup();
  }
});
test("headless child extension confirmations are denied", async () => {
  const h = client("confirm");
  try {
    await h.rpc.start();
    const done = new Promise<void>((resolve) =>
      h.rpc.on("event", (e) => {
        if (e.type === "agent_settled") resolve();
      }),
    );
    await h.rpc.request("prompt", { message: "work" });
    await done;
    const events = readFileSync(h.journal, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(events.find((x) => x.type === "extension_ui_response")?.confirmed, false);
  } finally {
    await h.cleanup();
  }
});
test("missing executable rejects cleanly", async () => {
  const rpc = new PiRpc({
    launch: { command: "/nonexistent/pi-sidekick-test", args: [] },
    args: [],
    cwd: tmpdir(),
    killGraceMs: 1,
  });
  await assert.rejects(rpc.start(), /Cannot launch/u);
  await rpc.close();
});

type CompatibilityMessage = NonNullable<RpcEvent["message"]> & {
  sections?: { system: string };
};

const COMPATIBILITY_USAGE = {
  input: 900,
  output: 800,
  cacheRead: 700,
  cacheWrite: 600,
  cost: { total: 90 },
};
const STRING_MESSAGE_CASES = [
  [
    "message-system-string",
    { role: "system", content: "", sections: { system: "" }, usage: COMPATIBILITY_USAGE },
  ],
  [
    "message-system-blocks",
    {
      role: "system",
      content: [{ type: "text", text: "system message block" }],
      sections: { system: "system message block" },
      usage: COMPATIBILITY_USAGE,
    },
  ],
  [
    "message-user-string",
    { role: "user", content: "user message content", usage: COMPATIBILITY_USAGE },
  ],
  [
    "message-custom-string",
    { role: "custom", content: "custom message content", usage: COMPATIBILITY_USAGE },
  ],
] satisfies Array<[string, CompatibilityMessage]>;

for (const [scenario, expectedMessage] of STRING_MESSAGE_CASES) {
  test(
    `RPC preserves ${scenario} JSONL events and remains usable`,
    { timeout: 5000 },
    async (t) => {
      const h = client(scenario);
      t.after(async () => h.cleanup());
      await h.rpc.start();
      const events: RpcEvent[] = [];
      const completion = new Promise<void>((resolve, reject) => {
        h.rpc.on("event", (event: RpcEvent) => {
          if (event.type === "message_start" || event.type === "message_end") {
            events.push(event);
          }
          if (event.type === "agent_settled") {
            resolve();
          }
        });
        h.rpc.once("failure", reject);
      });
      const prompt = h.rpc.request("prompt", { message: "work" });
      await Promise.all([prompt, completion]);
      const messageEvents = events.filter(
        (event) => event.type === "message_start" || event.type === "message_end",
      );
      const nonAssistantEvents = messageEvents.filter(
        (event) => event.message?.role !== "assistant",
      );
      assert.deepEqual(nonAssistantEvents, [
        { type: "message_start", message: expectedMessage },
        { type: "message_end", message: expectedMessage },
      ]);
      assert.ok(h.rpc.alive);
      assert.ok(await h.rpc.request("get_state"));
      assert.ok(h.rpc.alive);
    },
  );
}

for (const scenario of [
  "invalid-assistant-string",
  "invalid-tool-result-string",
  "invalid-numeric-content",
  "invalid-object-content",
]) {
  test(
    `RPC rejects malformed ${scenario} content without keeping the child alive`,
    { timeout: 5000 },
    async (t) => {
      const h = client(scenario);
      t.after(async () => h.cleanup());
      await assert.rejects(h.rpc.start(), /Invalid sidekick JSONL/u);
      assert.equal(h.rpc.alive, false);
    },
  );
}
