import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Parse } from "typebox/value";
import { Outcome } from "./enums.ts";
import { SidekickStore, atomicJson } from "./store.ts";
import { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick/sidekick-state-schema.ts";
import type { Handoff, Snapshot } from "./types.ts";

const USAGE = { input: 100, output: 20, cacheRead: 30, cacheWrite: 5, cost: 9, turns: 1 };
const ATOMIC_VALUE_SCHEMA = Type.Object({ old: Type.Boolean() }, { additionalProperties: false });

function handoff(status: Handoff["status"] = "settled"): Handoff {
  const common = {
    id: "handoff-one",
    message: "Implement the scoped fixture task",
    startedAt: "2026-09-13T00:00:00.000Z",
    report: "Failed after preserving partial work.",
    usage: { ...USAGE },
  };
  if (status === "running") {
    return { ...common, status, accounting: "partial" };
  }
  return {
    ...common,
    status,
    outcome: Outcome.FAILED,
    finishedAt: "2026-09-13T00:01:00.000Z",
    error: "Sidekick failed after preserving partial work.",
    accounting: "complete",
  };
}

function frozenPrompt() {
  const effectiveText = "current version-3 prompt";
  const hash = createHash("sha256").update(effectiveText).digest("hex");
  return {
    profileId: "sidekick/current",
    effectiveSha256: hash,
    effectiveText,
    activeToolNames: ["read"],
    model: { provider: "test", id: "worker" },
    thinking: "medium" as const,
    sidekickExtensions: [],
    sidekickSkills: [],
  };
}

function readPersistedSnapshot(path: string): Snapshot {
  return Parse(SIDEKICK_SNAPSHOT_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
}

function withStore(name: string, run: (store: SidekickStore, statePath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), name));
  const store = new SidekickStore(directory, directory, "parent");
  try {
    store.acquire();
    run(store, join(store.dir, "state.json"));
  } finally {
    store.release();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("atomic JSON writes preserve the prior file after serialization failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "sidekick-atomic-"));
  const path = join(directory, "value.json");
  try {
    atomicJson(path, { old: true });
    const circular: { self?: object } = {};
    circular.self = circular;
    assert.throws(() => atomicJson(path, circular));
    assert.deepEqual(Parse(ATOMIC_VALUE_SCHEMA, JSON.parse(readFileSync(path, "utf8"))), {
      old: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict version-3 snapshots reject v2, removed fields, and open nested objects unchanged", () => {
  withStore("sidekick-store-strict-", (store, statePath) => {
    const base: Snapshot = {
      ...store.fresh(),
      frozenSidekickPrompt: frozenPrompt(),
      handoff: handoff(),
      totals: { ...USAGE },
    };
    const invalidStates: unknown[] = [
      { ...base, version: 2 },
      { ...base, task: {} },
      { ...base, handoff: { ...handoff(), reviews: [] } },
      { ...base, handoff: { ...handoff(), revision: 1 } },
      { ...base, handoff: { ...handoff(), verdict: "accept" } },
      { ...base, handoff: { ...handoff(), block: true } },
      { ...base, handoff: { ...handoff(), notification: true } },
      { ...base, configOverrides: { guardLeadWrites: true } },
      { ...base, configOverrides: { maxReportChars: 12000 } },
      { ...base, handoff: { ...handoff(), outcome: "timed_out" } },
      { ...base, handoff: { ...handoff("running"), outcome: Outcome.COMPLETED } },
      {
        ...base,
        handoff: { ...handoff("running"), finishedAt: "2026-09-13T00:01:00.000Z" },
      },
      { ...base, handoff: { ...handoff("running"), reportPath: "/tmp/forged.md" } },
      { ...base, handoff: { ...handoff(), outcome: undefined } },
      { ...base, handoff: { ...handoff(), finishedAt: undefined } },
      { ...base, totals: { ...USAGE, cost: "not-a-number" } },
    ];
    for (const invalid of invalidStates) {
      const bytes = `${JSON.stringify(invalid)}\n`;
      writeFileSync(statePath, bytes);
      assert.throws(() => store.load(), /Invalid Sidekick state structure/u);
      assert.equal(readFileSync(statePath, "utf8"), bytes);
    }
  });
});

test("current version-3 snapshot round-trips without legacy prompt metadata", () => {
  withStore("sidekick-store-roundtrip-", (store) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      frozenSidekickPrompt: frozenPrompt(),
      handoff: handoff(),
      totals: { ...USAGE },
    };
    store.save(snapshot);
    const restored = store.load();
    assert.deepEqual(restored, snapshot);
    assert.equal("canonicalSha256" in (restored.frozenSidekickPrompt ?? {}), false);
    assert.equal(restored.version, 3);
    assert.equal(restored.handoff?.status, "settled");
    assert.equal(
      restored.handoff?.status === "settled" ? restored.handoff.outcome : undefined,
      "failed",
    );
    assert.equal(restored.handoff?.usage.cost, 9);
    assert.equal(restored.totals.cost, 9);
  });
});

test("synthetic legacy canonical hash remains readable in a version-3 snapshot", () => {
  withStore("sidekick-store-legacy-canonical-", (store) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      frozenSidekickPrompt: { ...frozenPrompt(), canonicalSha256: "a".repeat(64) },
      totals: { ...USAGE },
    };
    store.save(snapshot);
    assert.deepEqual(store.load(), snapshot);
  });
});

test("changed frozen prompt text with an unchanged effective hash fails store loading", () => {
  withStore("sidekick-store-prompt-integrity-", (store, statePath) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      frozenSidekickPrompt: frozenPrompt(),
      totals: { ...USAGE },
    };
    store.save(snapshot);
    const persisted = JSON.parse(readFileSync(statePath, "utf8"));
    persisted.frozenSidekickPrompt.effectiveText = "changed frozen prompt text";
    const changedBytes = `${JSON.stringify(persisted)}\n`;
    writeFileSync(statePath, changedBytes);

    assert.throws(() => store.load(), /Invalid Sidekick state structure/u);
    assert.equal(readFileSync(statePath, "utf8"), changedBytes);
  });
});

test("running version-3 handoff recovery settles interrupted exactly once with a report artifact", () => {
  withStore("sidekick-store-recovery-", (store, statePath) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: handoff("running"),
      totals: { ...USAGE },
    };
    store.save(snapshot);
    const first = store.load();
    const recoveredBytes = readFileSync(statePath, "utf8");
    const second = store.load();
    assert.equal(first.handoff?.status, "settled");
    assert.equal(first.handoff?.outcome, "interrupted");
    assert.match(first.handoff?.error ?? "", /No automatic replay/u);
    assert.ok(first.handoff?.reportPath);
    assert.match(readFileSync(first.handoff.reportPath, "utf8"), /partial changes/u);
    assert.deepEqual(second, first);
    assert.equal(readFileSync(statePath, "utf8"), recoveredBytes);
  });
});

test("interrupted recovery reuses an exact report written before the state checkpoint", () => {
  withStore("sidekick-store-recovery-report-", (store, statePath) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: handoff("running"),
      totals: { ...USAGE },
    };
    const expectedReportPath = join(store.dir, snapshot.epoch, `${snapshot.handoff?.id}.md`);
    const expectedReport = [
      snapshot.handoff?.report,
      "Previous Pi process ended before settlement; partial changes may remain. Inspect the working tree.",
    ].join("\n\n");
    mkdirSync(join(store.dir, snapshot.epoch), { recursive: true });
    writeFileSync(expectedReportPath, expectedReport);
    store.save(snapshot);
    const recovered = store.load();
    assert.equal(recovered.handoff?.status, "settled");
    assert.equal(recovered.handoff?.reportPath, expectedReportPath);
    assert.equal(recovered.handoff?.report, expectedReport);
    assert.equal(readFileSync(expectedReportPath, "utf8"), expectedReport);
    const persisted = readPersistedSnapshot(statePath);
    assert.equal(persisted.handoff?.status, "settled");
    assert.equal(persisted.handoff.report, expectedReport);
  });
});

test("normal execution recovery adopts the persisted running report without a recovery note", () => {
  withStore("sidekick-store-recovery-normal-report-", (store) => {
    const normalReport = "Report from normal execution before terminal checkpoint.";
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: { ...handoff("running"), report: normalReport },
      totals: { ...USAGE },
    };
    const expectedReportPath = join(store.dir, snapshot.epoch, `${snapshot.handoff?.id}.md`);
    mkdirSync(join(store.dir, snapshot.epoch), { recursive: true });
    writeFileSync(expectedReportPath, normalReport);
    store.save(snapshot);
    const recovered = store.load();
    assert.equal(recovered.handoff?.status, "settled");
    assert.equal(recovered.handoff?.reportPath, expectedReportPath);
    assert.equal(recovered.handoff?.report, normalReport);
    assert.doesNotMatch(recovered.handoff?.report ?? "", /Previous Pi process ended/u);
    assert.equal(readFileSync(expectedReportPath, "utf8"), normalReport);
  });
});

test("interrupted recovery does not adopt mismatched existing report bytes", () => {
  withStore("sidekick-store-recovery-mismatch-", (store) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: handoff("running"),
      totals: { ...USAGE },
    };
    const expectedReportPath = join(store.dir, snapshot.epoch, `${snapshot.handoff?.id}.md`);
    mkdirSync(join(store.dir, snapshot.epoch), { recursive: true });
    writeFileSync(expectedReportPath, "unrelated bytes");
    store.save(snapshot);
    const recovered = store.load();
    assert.equal(recovered.handoff?.status, "settled");
    assert.equal(recovered.handoff?.reportPath, undefined);
    assert.match(recovered.handoff?.error ?? "", /Could not reuse interrupted report/u);
    assert.match(recovered.handoff?.report ?? "", /Could not reuse interrupted report/u);
    assert.equal(readFileSync(expectedReportPath, "utf8"), "unrelated bytes");
  });
});

test("interrupted recovery does not adopt an expected-name symlink", () => {
  withStore("sidekick-store-recovery-symlink-", (store) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: handoff("running"),
      totals: { ...USAGE },
    };
    const expectedReportPath = join(store.dir, snapshot.epoch, `${snapshot.handoff?.id}.md`);
    const targetPath = join(store.dir, "outside-report.md");
    mkdirSync(join(store.dir, snapshot.epoch), { recursive: true });
    writeFileSync(targetPath, "unrelated target bytes");
    symlinkSync(targetPath, expectedReportPath);
    store.save(snapshot);
    const recovered = store.load();
    assert.equal(recovered.handoff?.status, "settled");
    assert.equal(recovered.handoff?.reportPath, undefined);
    assert.match(recovered.handoff?.error ?? "", /Could not reuse interrupted report/u);
    assert.equal(lstatSync(expectedReportPath).isSymbolicLink(), true);
    assert.equal(readFileSync(targetPath, "utf8"), "unrelated target bytes");
  });
});

test("persisted report paths require the canonical regular artifact and matching bytes", () => {
  withStore("sidekick-store-report-path-", (store, statePath) => {
    const snapshot: Snapshot = {
      ...store.fresh(),
      handoff: handoff(),
      totals: { ...USAGE },
    };
    const expectedReportPath = join(store.dir, snapshot.epoch, `${snapshot.handoff?.id}.md`);
    const targetPath = join(store.dir, "outside-report.md");
    mkdirSync(join(store.dir, snapshot.epoch), { recursive: true });
    const invalidStates = [
      {
        reportPath: join(store.dir, "escaped.md"),
        prepare: () => undefined,
      },
      {
        reportPath: `${store.dir}/${snapshot.epoch}/./${snapshot.handoff?.id}.md`,
        prepare: () => writeFileSync(expectedReportPath, snapshot.handoff?.report ?? ""),
      },
      {
        reportPath: expectedReportPath,
        prepare: () => writeFileSync(expectedReportPath, "mismatched bytes"),
      },
      {
        reportPath: expectedReportPath,
        prepare: () => {
          writeFileSync(targetPath, snapshot.handoff?.report ?? "");
          symlinkSync(targetPath, expectedReportPath);
        },
      },
    ];
    for (const invalidState of invalidStates) {
      rmSync(expectedReportPath, { force: true });
      rmSync(targetPath, { force: true });
      invalidState.prepare();
      const invalid = {
        ...snapshot,
        handoff: { ...snapshot.handoff, reportPath: invalidState.reportPath },
      };
      const bytes = `${JSON.stringify(invalid)}\n`;
      writeFileSync(statePath, bytes);
      assert.throws(() => store.load(), /Invalid Sidekick state structure/u);
      assert.equal(readFileSync(statePath, "utf8"), bytes);
    }
  });
});

test("old state root is ignored and untouched while version-3 Sidekick state is saved", () => {
  const directory = mkdtempSync(join(tmpdir(), "sidekick-store-cutover-"));
  const oldStateDirectory = join(directory, "fusion", "sessions", "legacy");
  const oldStatePath = join(oldStateDirectory, "state.json");
  mkdirSync(oldStateDirectory, { recursive: true });
  writeFileSync(oldStatePath, "legacy state\n");
  try {
    const store = new SidekickStore(directory, directory, "parent");
    store.acquire();
    try {
      const snapshot = store.load();
      store.save(snapshot);
      assert.match(store.dir, /sidekick[/\\]sessions/u);
      assert.equal(snapshot.handoff, undefined);
      assert.equal(readFileSync(oldStatePath, "utf8"), "legacy state\n");
    } finally {
      store.release();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dead owners can be recovered while malformed locks fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "sidekick-store-lock-"));
  try {
    const malformed = new SidekickStore(directory, directory, "malformed");
    malformed.acquire();
    writeFileSync(join(malformed.dir, "lock.json"), "not-json");
    const contender = new SidekickStore(directory, directory, "malformed");
    assert.throws(() => contender.acquire(), /Unreadable Sidekick lock/u);
    assert.throws(() => malformed.release());

    const recovered = new SidekickStore(directory, directory, "dead-owner");
    mkdirSync(recovered.dir, { recursive: true });
    writeFileSync(
      join(recovered.dir, "lock.json"),
      JSON.stringify({ pid: 999999999, nonce: "dead" }),
    );
    assert.doesNotThrow(() => recovered.acquire());
    recovered.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mismatched parent, unsafe paths, and missing child admission fail closed", () => {
  withStore("sidekick-store-boundaries-", (store, statePath) => {
    const base: Snapshot = {
      ...store.fresh(),
      frozenSidekickPrompt: frozenPrompt(),
      totals: { ...USAGE },
    };
    const invalidStates = [
      { ...base, parentId: "other-parent" },
      { ...base, cwd: "/other-cwd" },
      { ...base, configOverrides: { sidekickExtensions: ["relative.ts"] } },
      { ...base, configOverrides: { sidekickSkills: ["relative.md"] } },
      {
        ...base,
        frozenSidekickPrompt: { ...base.frozenSidekickPrompt, effectiveSha256: "0".repeat(64) },
      },
      {
        ...base,
        childSession: {
          sessionFile: join(store.dir, "child.jsonl"),
          sessionDir: store.dir,
          sessionId: "child",
        },
      },
    ];
    for (const invalid of invalidStates) {
      const bytes = `${JSON.stringify(invalid)}\n`;
      writeFileSync(statePath, bytes);
      assert.throws(
        () => store.load(),
        /Invalid Sidekick state structure|Invalid or mismatched Sidekick state/u,
      );
      assert.equal(readFileSync(statePath, "utf8"), bytes);
    }
  });
});

test("report writes use private mode and reject unsafe handoff identifiers", () => {
  withStore("sidekick-store-report-write-", (store) => {
    const snapshot = store.fresh();
    assert.throws(
      () => store.saveReport(snapshot, "../escape", "report"),
      /Unsafe Sidekick handoff ID/u,
    );
    const path = store.saveReport(snapshot, "safe-handoff", "report bytes");
    assert.equal(readFileSync(path, "utf8"), "report bytes");
  });
});
