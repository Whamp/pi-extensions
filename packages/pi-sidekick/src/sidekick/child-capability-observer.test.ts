import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Parse } from "typebox/value";
import {
  registerChildCapabilityObserver,
  SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA,
} from "./child-capability-observer.ts";
import type { ChildCapabilityObserverHost } from "./child-capability-observer.ts";

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(`Capability observer did not write ${path} within ${timeoutMs}ms.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

test("child observer writes one normalized handshake and rejects invalid contracts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sidekick-observer-unit-"));
  const handshakePath = join(directory, "handshake.json");
  const previousPath = process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
  const previousNonce = process.env.PI_SIDEKICK_CAPABILITY_NONCE;
  const hooks = new Map<string, () => void | Promise<void>>();
  const pi: ChildCapabilityObserverHost = {
    on: (event, callback) => {
      hooks.set(event, callback);
    },
    getActiveTools: () => ["write", "read", "read"],
  };
  try {
    registerChildCapabilityObserver(pi);
    delete process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
    delete process.env.PI_SIDEKICK_CAPABILITY_NONCE;
    await hooks.get("session_start")?.();
    assert.equal(existsSync(handshakePath), false);

    process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE = handshakePath;
    process.env.PI_SIDEKICK_CAPABILITY_NONCE = "unit-nonce";
    await hooks.get("session_start")?.();
    const handshake = Parse(
      SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA,
      JSON.parse(readFileSync(handshakePath, "utf8")),
    );
    assert.equal(handshake.nonce, "unit-nonce");
    assert.equal(handshake.pid, process.pid);
    assert.deepEqual(handshake.activeToolNames, ["read", "write"]);

    delete process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
    const onSessionStart = hooks.get("session_start");
    assert.ok(onSessionStart);
    await assert.rejects(async () => {
      await onSessionStart();
    }, /invalid handshake contract/u);
    process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE = handshakePath;
    const blockedPath = join(directory, "blocked");
    mkdirSync(blockedPath);
    process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE = blockedPath;
    await assert.rejects(async () => {
      await onSessionStart();
    });
  } finally {
    if (previousPath === undefined) {
      delete process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
    } else {
      process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE = previousPath;
    }
    if (previousNonce === undefined) {
      delete process.env.PI_SIDEKICK_CAPABILITY_NONCE;
    } else {
      process.env.PI_SIDEKICK_CAPABILITY_NONCE = previousNonce;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

async function observeRealPiTools(observerFirst: boolean): Promise<void> {
  const packageDirectory = join(import.meta.dirname, "..", "..");
  const directory = mkdtempSync(join(tmpdir(), "sidekick-observer-"));
  const handshakePath = join(directory, "handshake.json");
  const nonce = `observer-order-${observerFirst ? "first" : "last"}`;
  const observer = join(packageDirectory, "index.ts");
  const registrar = join(directory, "register-custom-tool.ts");
  writeFileSync(
    registrar,
    `export default function register(pi) {
  pi.registerTool({
    name: "capability_fixture",
    label: "Capability fixture",
    description: "Harmless custom tool for capability admission tests.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "not invoked" }], details: {} };
    },
  });
}\n`,
  );
  const extensions = observerFirst ? [observer, registrar] : [registrar, observer];
  const extensionArguments = extensions.flatMap((extension) => ["--extension", extension]);
  const child = spawn(
    join(packageDirectory, "node_modules", ".bin", "pi"),
    [
      "--offline",
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-approve",
      ...extensionArguments,
      "--tools",
      "read,capability_fixture",
      "--append-system-prompt",
      "NO_INFERENCE_SMOKE",
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        NODE_V8_COVERAGE: undefined,
        PI_CODING_AGENT_DIR: directory,
        PI_SIDEKICK_CHILD: "1",
        PI_SIDEKICK_CAPABILITY_HANDSHAKE: handshakePath,
        PI_SIDEKICK_CAPABILITY_NONCE: nonce,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    await waitForFile(handshakePath, 5000);
    const handshake = Parse(
      SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA,
      JSON.parse(readFileSync(handshakePath, "utf8")),
    );
    assert.equal(handshake.nonce, nonce);
    assert.equal(handshake.pid, child.pid);
    assert.deepEqual(handshake.activeToolNames, ["capability_fixture", "read"]);
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    rmSync(directory, { recursive: true, force: true });
  }
  assert.doesNotMatch(stderr, /error|failed/iu);
}

for (const observerFirst of [true, false]) {
  test(`real Pi observer sees custom tools when loaded ${observerFirst ? "before" : "after"} their extension`, async () => {
    await observeRealPiTools(observerFirst);
  });
}
