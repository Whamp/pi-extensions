import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Parse } from "typebox/value";
import { SidekickStore, atomicJson } from "../store.ts";
import { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick-state-schema.ts";
import type { Snapshot } from "../types.ts";
import type { RpcEvent } from "./rpc.ts";
import {
  createSidekickRunnerHarness,
  SIDEKICK_TEST_MESSAGE,
  waitUntilSidekickCondition,
} from "../../test/sidekick-runner-test-utils.ts";

const SECOND_MESSAGE = "Add the missing negative case and rerun the focused checks.";
type CompatibilityMessage = NonNullable<RpcEvent["message"]> & {
  sections?: { system: string };
};
const ATOMIC_VALUE_SCHEMA = Type.Object({ old: Type.Boolean() }, { additionalProperties: false });

function readPersistedSnapshot(path: string): Snapshot {
  return Parse(SIDEKICK_SNAPSHOT_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
}

test("child transcript creation is lazy and first dispatch preserves the raw message", async () => {
  const h = createSidekickRunnerHarness();
  try {
    const parentSessionFile = h.parentSessionManager.getSessionFile();
    assert.ok(parentSessionFile);
    const childFiles = () =>
      readdirSync(h.parentSessionManager.getSessionDir()).filter(
        (file) => join(h.parentSessionManager.getSessionDir(), file) !== parentSessionFile,
      );
    assert.equal(h.runner.sessionPath, undefined);
    assert.deepEqual(childFiles(), []);
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    assert.equal(dispatched.kind, "started");
    assert.equal(dispatched.handoff.status, "running");
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 1);
    assert.equal(
      h.records().find((record) => record.type === "prompt")?.message,
      SIDEKICK_TEST_MESSAGE,
    );
    const settled = await dispatched.completion;
    assert.equal(settled.status, "settled");
    assert.equal(settled.outcome, "completed");
    assert.ok(h.runner.sessionPath);
    assert.equal(childFiles().length, 1);
  } finally {
    await h.cleanup();
  }
});

test("assistant message_end persists the latest report while the handoff is running", async () => {
  const h = createSidekickRunnerHarness("report-then-hang");
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    assert.equal(dispatched.handoff.status, "running");
    await waitUntilSidekickCondition(() => {
      const persisted = readPersistedSnapshot(join(h.store.dir, "state.json"));
      return persisted.handoff?.report === "Report 1: persisted while running";
    });
    const persisted = readPersistedSnapshot(join(h.store.dir, "state.json"));
    assert.ok(persisted.handoff);
    assert.equal(persisted.handoff.status, "running");
    assert.equal(persisted.handoff.report, "Report 1: persisted while running");
    await h.runner.cancel("Stop persisted-report fixture.");
  } finally {
    await h.cleanup();
  }
});

test(
  "system, user, and custom JSONL messages are ignored until assistant settlement",
  { timeout: 8000 },
  async (t) => {
    const h = createSidekickRunnerHarness("compatibility-messages");
    t.after(async () => h.cleanup());
    const expectedMessages = [
      {
        role: "system",
        content: "",
        sections: { system: "" },
        usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
      },
      {
        role: "user",
        content: "user message content",
        usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
      },
      {
        role: "custom",
        content: "custom message content",
        usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
      },
      {
        role: "system",
        content: [{ type: "text", text: "system message block" }],
        sections: { system: "system message block" },
        usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
      },
    ] satisfies CompatibilityMessage[];

    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    assert.equal(first.status, "admitted");
    await waitUntilSidekickCondition(() => {
      const current = h.runner.handoff;
      return (
        current?.status === "running" &&
        current.report === "Report 1: compatibility messages ignored"
      );
    });
    const inFlight = h.runner.handoff;
    assert.equal(inFlight?.status, "running");
    assert.equal(inFlight?.report, "Report 1: compatibility messages ignored");

    const firstTerminal = await first.completion;
    assert.equal(firstTerminal.outcome, "completed");
    assert.equal(firstTerminal.report, "Report 1: compatibility messages ignored");
    assert.deepEqual(firstTerminal.usage, {
      input: 100,
      output: 20,
      cacheRead: 30,
      cacheWrite: 5,
      cost: 0.01,
      turns: 1,
    });

    const childSession = h.runner.sessionPath;
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    const secondTerminal = await second.completion;
    assert.equal(secondTerminal.outcome, "completed");
    assert.equal(secondTerminal.report, "Report 2: compatibility messages ignored");
    assert.equal(h.runner.sessionPath, childSession);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "prompt")
        .map((record) => record.message),
      [SIDEKICK_TEST_MESSAGE, SECOND_MESSAGE],
    );
    assert.deepEqual(h.runner.snapshot.totals, {
      input: 200,
      output: 40,
      cacheRead: 60,
      cacheWrite: 10,
      cost: 0.02,
      turns: 2,
    });

    const eventRecords = h.records().filter((record) => record.type === "event");
    const nonAssistantMessages = eventRecords
      .filter(
        (record) =>
          (record.eventType === "message_start" || record.eventType === "message_end") &&
          record.message?.role !== "assistant",
      )
      .map((record) => ({ type: record.eventType, message: record.message }));
    assert.deepEqual(
      nonAssistantMessages,
      Array.from({ length: 2 }, () =>
        expectedMessages.flatMap((message) => [
          { type: "message_start", message },
          { type: "message_end", message },
        ]),
      ).flat(),
    );
  },
);

test("running dispatch steers the same handoff, process, transcript, and completion", async () => {
  const h = createSidekickRunnerHarness("hang");
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    assert.equal(second.kind, "steered");
    assert.equal(second.handoff.id, first.handoff.id);
    assert.equal(second.completion, first.completion);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "steer")
        .map((record) => record.message),
      [SECOND_MESSAGE],
    );
    const stopped = await h.runner.cancel("Explicit test cancellation.");
    assert.equal(stopped?.id, first.handoff.id);
    assert.equal(stopped?.outcome, "cancelled");
    assert.equal(stopped?.error, "Explicit test cancellation.");
    assert.deepEqual(
      h
        .records()
        .filter((record) => ["clear_queue", "abort"].includes(record.type))
        .map((record) => record.type),
      ["clear_queue", "abort"],
    );
  } finally {
    await h.cleanup();
  }
});

test("settled dispatch starts a new handoff while reusing the child process and transcript", async () => {
  const h = createSidekickRunnerHarness();
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    await first.completion;
    const sessionPath = h.runner.sessionPath;
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    const settled = await second.completion;
    assert.notEqual(second.handoff.id, first.handoff.id);
    assert.equal(second.kind, "started");
    assert.equal(settled.outcome, "completed");
    assert.equal(h.runner.sessionPath, sessionPath);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "prompt")
        .map((record) => record.message),
      [SIDEKICK_TEST_MESSAGE, SECOND_MESSAGE],
    );
  } finally {
    await h.cleanup();
  }
});

test("dispatch rejects blank and oversized messages without creating a handoff", async () => {
  const h = createSidekickRunnerHarness();
  try {
    await assert.rejects(h.runner.dispatch("   \n\t"), /must not be blank/u);
    await assert.rejects(h.runner.dispatch("x".repeat(30001)), /1–30000/u);
    assert.equal(h.runner.handoff, undefined);
    assert.equal(h.records().length, 0);
  } finally {
    await h.cleanup();
  }
});

for (const scenario of ["crash", "reject", "wrong-model", "no-report", "length"]) {
  test(`${scenario} cannot be reported as successful execution`, async () => {
    const h = createSidekickRunnerHarness(scenario);
    try {
      const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
      const handoff = await dispatched.completion;
      assert.equal(handoff.status, "settled");
      assert.equal(handoff.outcome, "failed");
      assert.ok(handoff.error);
    } finally {
      await h.cleanup();
    }
  });
}

test("automatic retry settles only after agent_settled and preserves usage", async () => {
  const h = createSidekickRunnerHarness("retry");
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const handoff = await dispatched.completion;
    assert.equal(handoff.outcome, "completed");
    assert.match(handoff.report, /recovered after retry/u);
    assert.equal(handoff.usage.cost, 0.02);
  } finally {
    await h.cleanup();
  }
});

test("completion arriving before prompt acknowledgment is retained", async () => {
  const h = createSidekickRunnerHarness("settle-before-ack");
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const handoff = await dispatched.completion;
    assert.equal(handoff.outcome, "completed");
    assert.match(handoff.report, /early completion/u);
  } finally {
    await h.cleanup();
  }
});

test("a steer that loses a natural settlement starts a new handoff in the same child", async () => {
  const h = createSidekickRunnerHarness("settle-before-ack");
  try {
    const firstPromise = h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const secondPromise = h.runner.dispatch(SECOND_MESSAGE);
    const first = await firstPromise;
    const second = await secondPromise;
    assert.equal(first.status, "admitted");
    assert.equal(second.status, "admitted");
    assert.equal(second.kind, "started");
    assert.notEqual(second.handoff.id, first.handoff.id);
    await first.completion;
    await second.completion;
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "prompt")
        .map((record) => record.message),
      [SIDEKICK_TEST_MESSAGE, SECOND_MESSAGE],
    );
  } finally {
    await h.cleanup();
  }
});

test("a cancelled prompt race rejects the steer without claiming delivery", async () => {
  const h = createSidekickRunnerHarness("delayed-prompt-ack");
  try {
    const firstPromise = h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const secondPromise = h.runner.dispatch(SECOND_MESSAGE);
    await waitUntilSidekickCondition(() => h.records().some((record) => record.type === "prompt"));
    await h.runner.cancel("Cancel before prompt admission.");
    const first = await firstPromise;
    const second = await secondPromise;
    assert.equal(first.status, "not-delivered");
    assert.equal(first.handoff.error, "Cancel before prompt admission.");
    assert.equal(second.status, "not-delivered");
    assert.equal(second.handoff.error, "Cancel before prompt admission.");
    assert.deepEqual(
      h.records().filter((record) => record.type === "steer"),
      [],
    );
  } finally {
    await h.cleanup();
  }
});

test("delayed prompt admission blocks dispatch until the prompt acknowledgment", async () => {
  const h = createSidekickRunnerHarness("delayed-prompt-ack");
  try {
    let settled = false;
    const startedAt = Date.now();
    const dispatchPromise = h.runner.dispatch(SIDEKICK_TEST_MESSAGE).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    const dispatched = await dispatchPromise;
    assert.ok(Date.now() - startedAt >= 45);
    assert.equal(dispatched.status, "admitted");
    await h.runner.cancel("Stop delayed admission fixture.");
  } finally {
    await h.cleanup();
  }
});

test("delayed steer acknowledgment cannot report a terminally lost steer as accepted", async () => {
  const h = createSidekickRunnerHarness("delayed-steer-ack");
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    assert.equal(second.status, "admitted");
    assert.equal(second.kind, "started");
    assert.notEqual(second.handoff.id, first.handoff.id);
    await first.completion;
    await second.completion;
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "prompt")
        .map((record) => record.message),
      [SIDEKICK_TEST_MESSAGE, SECOND_MESSAGE],
    );
  } finally {
    await h.cleanup();
  }
});

test("a rejected steer after settlement is redelivered as a new handoff", async () => {
  const h = createSidekickRunnerHarness("steer-reject-after-settle");
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    assert.equal(second.status, "admitted");
    assert.equal(second.kind, "started");
    assert.notEqual(second.handoff.id, first.handoff.id);
    await first.completion;
    await second.completion;
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.deepEqual(
      h
        .records()
        .filter((record) => record.type === "prompt")
        .map((record) => record.message),
      [SIDEKICK_TEST_MESSAGE, SECOND_MESSAGE],
    );
  } finally {
    await h.cleanup();
  }
});

test("Sidekick remains running beyond the former deadline until explicit cancellation", async () => {
  const h = createSidekickRunnerHarness("hang");
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    await waitUntilSidekickCondition(() => h.records().some((record) => record.type === "prompt"));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(h.runner.running, true);
    assert.equal(
      h.records().some((record) => ["clear_queue", "abort"].includes(record.type)),
      false,
    );
    const cancellationReason = "Explicit cancellation after the former deadline.";
    const stopped = await h.runner.cancel(cancellationReason);
    assert.equal(stopped?.id, dispatched.handoff.id);
    assert.equal(stopped?.outcome, "cancelled");
    assert.equal(stopped?.error, cancellationReason);
  } finally {
    await h.cleanup();
  }
});

test("Sidekick supports more than forty turns and reconciles provider usage", async () => {
  const manyTurns = createSidekickRunnerHarness("many-turns");
  try {
    const dispatched = await manyTurns.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const handoff = await dispatched.completion;
    assert.equal(handoff.outcome, "completed");
    assert.equal(handoff.usage.turns, 42);
  } finally {
    await manyTurns.cleanup();
  }
  const expensive = createSidekickRunnerHarness("expensive-reconciled");
  try {
    const dispatched = await expensive.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const handoff = await dispatched.completion;
    assert.equal(handoff.accounting, "complete");
    assert.equal(handoff.usage.cost, 9);
    assert.equal(expensive.runner.snapshot.totals.cost, 9);
  } finally {
    await expensive.cleanup();
  }
});

test("child launch keeps discovery disabled and ordered trusted capabilities", async () => {
  const h = createSidekickRunnerHarness("normal", {
    sidekickExtensions: ["/trusted/extension-b.ts", "/trusted/extension-a.ts"],
    sidekickSkills: ["/trusted/skill-b.md", "/trusted/skill-a.md"],
  });
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    await dispatched.completion;
    const spawn = h.records().find((record) => record.type === "spawn");
    assert.ok(spawn);
    assert.ok(spawn.args.includes("--no-extensions"));
    assert.ok(spawn.args.includes("--no-skills"));
    assert.deepEqual(
      spawn.args.slice(spawn.args.indexOf("--extension"), spawn.args.indexOf("--skill")),
      ["--extension", "/trusted/extension-b.ts", "--extension", "/trusted/extension-a.ts"],
    );
    assert.equal(existsSync(h.runner.sessionPath ?? ""), true);
  } finally {
    await h.cleanup();
  }
});

test("child identity save failure leaves no phantom transcript and terminally fails the handoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-child-save-failure-"));
  const h = createSidekickRunnerHarness("normal", {}, dir);
  const originalSave = h.store.save.bind(h.store);
  let saveCount = 0;
  try {
    h.store.save = (snapshot) => {
      saveCount++;
      if (saveCount === 2) {
        throw new Error("Simulated child identity state save failure");
      }
      originalSave(snapshot);
    };
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const handoff = await dispatched.completion;
    assert.equal(handoff.outcome, "failed");
    assert.match(handoff.error ?? "", /child identity state save failure/u);
    assert.equal(h.runner.snapshot.childSession, undefined);
    const parentSessionFile = h.parentSessionManager.getSessionFile();
    assert.ok(parentSessionFile);
    assert.deepEqual(
      readdirSync(h.parentSessionManager.getSessionDir()).filter(
        (file) => join(h.parentSessionManager.getSessionDir(), file) !== parentSessionFile,
      ),
      [],
    );
  } finally {
    h.store.save = originalSave;
    await h.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal reports are complete on disk and use unique handoff paths", async () => {
  const h = createSidekickRunnerHarness();
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const firstTerminal = await first.completion;
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    const secondTerminal = await second.completion;
    assert.ok(firstTerminal.reportPath);
    assert.ok(secondTerminal.reportPath);
    assert.notEqual(firstTerminal.reportPath, secondTerminal.reportPath);
    assert.match(firstTerminal.reportPath, new RegExp(`${firstTerminal.id}\\.md$`, "u"));
    assert.match(readFileSync(firstTerminal.reportPath, "utf8"), /Report 1/u);
    assert.match(readFileSync(secondTerminal.reportPath, "utf8"), /Report 2/u);
  } finally {
    await h.cleanup();
  }
});

test("disabled Sidekick cannot dispatch messages", async () => {
  const h = createSidekickRunnerHarness("normal", { enabled: false });
  try {
    await assert.rejects(h.runner.dispatch(SIDEKICK_TEST_MESSAGE), /Sidekick is off/u);
  } finally {
    await h.cleanup();
  }
});

test("a restarted runner resumes its child while different parents stay isolated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-resume-v3-"));
  try {
    const first = createSidekickRunnerHarness("normal", {}, dir);
    const firstDispatch = await first.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const firstTerminal = await firstDispatch.completion;
    const sessionPath = first.runner.sessionPath;
    assert.ok(sessionPath);
    await first.cleanup();

    const resumed = createSidekickRunnerHarness("normal", {}, dir);
    try {
      assert.equal(resumed.runner.sessionPath, sessionPath);
      const secondDispatch = await resumed.runner.dispatch(SECOND_MESSAGE);
      const secondTerminal = await secondDispatch.completion;
      assert.equal(secondTerminal.outcome, "completed");
      assert.match(secondTerminal.report, /Report 2/u);
      assert.equal(resumed.runner.sessionPath, sessionPath);
      assert.ok(firstTerminal.reportPath);
    } finally {
      await resumed.cleanup();
    }

    const fork = createSidekickRunnerHarness("normal", {}, dir, "fork-parent");
    try {
      const forkDispatch = await fork.runner.dispatch(SIDEKICK_TEST_MESSAGE);
      const forkTerminal = await forkDispatch.completion;
      assert.equal(forkTerminal.outcome, "completed");
      assert.notEqual(fork.runner.sessionPath, sessionPath);
      assert.notEqual(fork.store.dir, resumed.store.dir);
      assert.match(forkTerminal.report, /Report 1/u);
    } finally {
      await fork.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live owner lock blocks a second writer and persisted state uses private mode", async () => {
  const h = createSidekickRunnerHarness();
  try {
    const other = new SidekickStore(h.dir, h.dir, "parent-one");
    assert.throws(() => other.acquire(), /already has a Sidekick owner/u);
    h.store.save(h.runner.snapshot);
    if (process.platform !== "win32") {
      assert.equal(statSync(join(h.store.dir, "state.json")).mode & 0o777, 0o600);
    }
  } finally {
    await h.cleanup();
  }
});

test("orphaned running state recovers once without replaying the message", async () => {
  const h = createSidekickRunnerHarness();
  try {
    h.runner.snapshot.handoff = {
      id: "orphaned-handoff",
      message: SIDEKICK_TEST_MESSAGE,
      status: "running",
      startedAt: new Date().toISOString(),
      report: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    };
    h.store.save(h.runner.snapshot);
    const restored = h.store.load();
    const restoredAgain = h.store.load();
    assert.equal(restored.handoff?.status, "settled");
    assert.equal(restored.handoff?.outcome, "interrupted");
    assert.deepEqual(restoredAgain, restored);
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 0);
  } finally {
    await h.cleanup();
  }
});

test("corrupt and nested persisted state fail closed without resetting bytes", async () => {
  const h = createSidekickRunnerHarness();
  try {
    const statePath = join(h.store.dir, "state.json");
    writeFileSync(statePath, "bad JSON");
    assert.throws(() => h.store.load(), /Corrupt Sidekick state/u);
    const invalid = { ...h.runner.snapshot, totals: { ...h.runner.snapshot.totals, cost: "bad" } };
    const invalidBytes = `${JSON.stringify(invalid)}\n`;
    writeFileSync(statePath, invalidBytes);
    assert.throws(() => h.store.load(), /Invalid Sidekick state structure/u);
    assert.equal(readFileSync(statePath, "utf8"), invalidBytes);
    const { epoch: removedEpoch, ...missingEpoch } = h.runner.snapshot;
    void removedEpoch;
    atomicJson(statePath, missingEpoch);
    assert.throws(() => h.store.load(), /Invalid Sidekick state structure/u);
  } finally {
    await h.cleanup();
  }
});

test("atomic writes preserve the prior file after serialization failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-atomic-runner-"));
  const path = join(dir, "value.json");
  try {
    atomicJson(path, { old: true });
    const circular: { self?: object } = {};
    circular.self = circular;
    assert.throws(() => atomicJson(path, circular));
    assert.deepEqual(Parse(ATOMIC_VALUE_SCHEMA, JSON.parse(readFileSync(path, "utf8"))), {
      old: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session-stat reconciliation includes compaction without double counting", async () => {
  const h = createSidekickRunnerHarness("compaction");
  try {
    const first = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const firstTerminal = await first.completion;
    assert.equal(firstTerminal.accounting, "complete");
    assert.equal(firstTerminal.usage.cost, 0.04);
    assert.equal(firstTerminal.usage.input, 300);
    const second = await h.runner.dispatch(SECOND_MESSAGE);
    const secondTerminal = await second.completion;
    assert.equal(secondTerminal.accounting, "complete");
    assert.equal(secondTerminal.usage.cost, 0.04);
    assert.equal(h.runner.snapshot.totals.cost, 0.08);
  } finally {
    await h.cleanup();
  }
});

test("initial state persistence failure leaves no phantom running handoff", async () => {
  const h = createSidekickRunnerHarness();
  const originalSave = h.store.save.bind(h.store);
  try {
    h.store.save = () => {
      throw new Error("Simulated disk failure");
    };
    await assert.rejects(h.runner.dispatch(SIDEKICK_TEST_MESSAGE), /disk failure/u);
    assert.equal(h.runner.running, false);
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 0);
  } finally {
    h.store.save = originalSave;
    await h.cleanup();
  }
});

test("streaming persistence failure closes the worker and settles failed evidence", async () => {
  const h = createSidekickRunnerHarness("slow");
  const originalSave = h.store.save.bind(h.store);
  try {
    const dispatch = h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    await waitUntilSidekickCondition(() => h.records().some((record) => record.type === "prompt"));
    h.store.save = () => {
      throw new Error("Simulated streaming disk failure");
    };
    const admitted = await dispatch;
    assert.equal(admitted.status, "admitted");
    await assert.rejects(admitted.completion, /streaming disk failure/u);
    const spawnRecord = h.records().find((record) => record.type === "spawn");
    assert.ok(spawnRecord);
    assert.throws(() => process.kill(spawnRecord.pid, 0));
  } finally {
    h.store.save = originalSave;
    await h.cleanup();
  }
});

test("child capability mismatch fails before the first prompt", async () => {
  const h = createSidekickRunnerHarness("missing-tool");
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    assert.equal(dispatched.status, "not-delivered");
    const terminal = await dispatched.completion;
    assert.equal(terminal.outcome, "failed");
    assert.match(terminal.error ?? "", /capability admission rejected/u);
    assert.equal(
      h.records().some((record) => record.type === "prompt"),
      false,
    );
  } finally {
    await h.cleanup();
  }
});

test("report persistence failure remains a failed terminal result", async () => {
  const h = createSidekickRunnerHarness();
  const originalSaveReport = h.store.saveReport.bind(h.store);
  try {
    h.store.saveReport = () => {
      throw new Error("Simulated report disk failure");
    };
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const terminal = await dispatched.completion;
    assert.equal(terminal.outcome, "failed");
    assert.match(terminal.error ?? "", /report disk failure/u);
  } finally {
    h.store.saveReport = originalSaveReport;
    await h.cleanup();
  }
});

test("child launch preserves session lineage and ordered trusted capabilities", async () => {
  const h = createSidekickRunnerHarness("normal", {
    sidekickExtensions: ["/trusted/extension-a.ts", "/trusted/extension-b.ts"],
    sidekickSkills: ["/trusted/skill-a.md", "/trusted/skill-b.md"],
  });
  try {
    const dispatched = await h.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    const terminal = await dispatched.completion;
    assert.equal(terminal.outcome, "completed");
    const spawn = h.records().find((record) => record.type === "spawn");
    assert.ok(spawn);
    assert.equal(spawn.args[spawn.args.indexOf("--session") + 1], h.runner.sessionPath);
    assert.ok(h.runner.sessionPath);
    const reopened = SessionManager.open(
      h.runner.sessionPath,
      h.parentSessionManager.getSessionDir(),
    );
    assert.equal(reopened.getHeader()?.parentSession, h.parentSessionManager.getSessionFile());
    const extensions: string[] = [];
    const skills: string[] = [];
    for (let index = 0; index < spawn.args.length; index++) {
      if (spawn.args[index] === "--extension") {
        extensions.push(spawn.args[index + 1]);
      }
      if (spawn.args[index] === "--skill") {
        skills.push(spawn.args[index + 1]);
      }
    }
    assert.deepEqual(extensions, [
      "/trusted/extension-a.ts",
      "/trusted/extension-b.ts",
      spawn.args.at(-1),
    ]);
    assert.deepEqual(skills, ["/trusted/skill-a.md", "/trusted/skill-b.md"]);
    assert.ok(spawn.args.includes("--no-skills"));
    assert.ok(spawn.args.includes("--no-extensions"));
  } finally {
    await h.cleanup();
  }
});

test("frozen prompt, model, thinking, tools, extensions, and skills reuse byte-for-byte", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-frozen-v3-"));
  try {
    const first = createSidekickRunnerHarness(
      "normal",
      {
        sidekickExtensions: ["/trusted/extension.ts"],
        sidekickSkills: ["/trusted/skill.md"],
      },
      dir,
    );
    const expected = structuredClone(first.runner.snapshot.frozenSidekickPrompt);
    const firstDispatch = await first.runner.dispatch(SIDEKICK_TEST_MESSAGE);
    await firstDispatch.completion;
    const firstSpawn = first.records().find((record) => record.type === "spawn");
    await first.cleanup();
    const second = createSidekickRunnerHarness("normal", {}, dir);
    try {
      assert.deepEqual(second.runner.snapshot.frozenSidekickPrompt, expected);
      const nextDispatch = await second.runner.dispatch(SECOND_MESSAGE);
      await nextDispatch.completion;
      const secondSpawn = second
        .records()
        .filter((record) => record.type === "spawn")
        .at(-1);
      assert.ok(firstSpawn);
      assert.ok(secondSpawn);
      const firstPrompt = firstSpawn.args[firstSpawn.args.indexOf("--append-system-prompt") + 1];
      const secondPrompt = secondSpawn.args[secondSpawn.args.indexOf("--append-system-prompt") + 1];
      assert.equal(firstPrompt, expected?.effectiveText);
      assert.equal(secondPrompt, expected?.effectiveText);
      assert.equal(
        secondSpawn.args[secondSpawn.args.indexOf("--tools") + 1],
        expected?.activeToolNames.join(","),
      );
    } finally {
      await second.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
