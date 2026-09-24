import assert from "node:assert/strict";
import { test } from "node:test";
import { Parse } from "typebox/value";
import { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick-state-schema.ts";

const VALID_SNAPSHOT = {
  version: 3,
  parentId: "parent-session",
  cwd: "/tmp/sidekick-project",
  epoch: "epoch-one",
  checkpoint: "branch-checkpoint",
  configOverrides: {
    version: 2,
    sidekick: { provider: "openai", id: "worker" },
    thinking: "medium",
    leadProfile: "auto",
    broadExploration: false,
    leadRenderedBrowser: false,
    sidekickPreferExec: false,
    enabled: true,
    sidekickExtensions: ["/trusted/provider.ts"],
    sidekickSkills: ["/trusted/skill.md"],
    tools: ["read", "write"],
  },
  frozenSidekickPrompt: {
    profileId: "sidekick-capable",
    canonicalSha256: "a".repeat(64),
    effectiveSha256: "b".repeat(64),
    effectiveText: "Frozen Sidekick prompt",
    activeToolNames: ["read", "write"],
    model: { provider: "openai", id: "worker" },
    thinking: "medium",
    sidekickExtensions: ["/trusted/provider.ts"],
    sidekickSkills: ["/trusted/skill.md"],
  },
  childSession: {
    sessionFile: "/tmp/pi-sessions/child.jsonl",
    sessionDir: "/tmp/pi-sessions",
    sessionId: "child-session",
  },
  handoff: {
    id: "handoff-one",
    message: "Implement the requested change",
    status: "settled",
    outcome: "completed",
    startedAt: "2026-09-13T00:00:00.000Z",
    finishedAt: "2026-09-13T00:01:00.000Z",
    report: "Completed",
    reportPath: "/tmp/report.md",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 3,
      cacheWrite: 4,
      cost: 0.01,
      turns: 2,
    },
    accounting: "complete",
  },
  totals: {
    input: 10,
    output: 20,
    cacheRead: 3,
    cacheWrite: 4,
    cost: 0.01,
    turns: 2,
  },
  accountingPartial: false,
};

function cloneSnapshot() {
  return structuredClone(VALID_SNAPSHOT);
}

test("SIDEKICK_SNAPSHOT_SCHEMA accepts one complete atomic version-3 snapshot", () => {
  const parsed = Parse(SIDEKICK_SNAPSHOT_SCHEMA, VALID_SNAPSHOT);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.handoff?.message, "Implement the requested change");
  assert.deepEqual(parsed.childSession, VALID_SNAPSHOT.childSession);
});

test("SIDEKICK_SNAPSHOT_SCHEMA accepts a new snapshot without legacy canonical metadata", () => {
  const snapshot = cloneSnapshot();
  const { canonicalSha256: legacyHash, ...newFrozenPrompt } = snapshot.frozenSidekickPrompt;
  assert.equal(legacyHash, "a".repeat(64));

  const parsed = Parse(SIDEKICK_SNAPSHOT_SCHEMA, {
    ...snapshot,
    frozenSidekickPrompt: newFrozenPrompt,
  });
  assert.ok(parsed.frozenSidekickPrompt);
  assert.equal("canonicalSha256" in parsed.frozenSidekickPrompt, false);
});

test("SIDEKICK_SNAPSHOT_SCHEMA validates synthetic legacy canonical metadata when present", () => {
  const parsed = Parse(SIDEKICK_SNAPSHOT_SCHEMA, VALID_SNAPSHOT);
  assert.equal(parsed.frozenSidekickPrompt?.canonicalSha256, "a".repeat(64));
  for (const malformedHash of ["not-a-hash", "A".repeat(64)]) {
    assert.throws(() =>
      Parse(SIDEKICK_SNAPSHOT_SCHEMA, {
        ...cloneSnapshot(),
        frozenSidekickPrompt: {
          ...cloneSnapshot().frozenSidekickPrompt,
          canonicalSha256: malformedHash,
        },
      }),
    );
  }
});

test("SIDEKICK_SNAPSHOT_SCHEMA rejects v2 and all removed task/review presentation fields", () => {
  const invalidStates: unknown[] = [
    { ...cloneSnapshot(), version: 2 },
    { ...cloneSnapshot(), task: {} },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, reviews: [] } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, revision: 1 } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, verdict: "accept" } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, background: false } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, block: true } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, notification: true } },
    {
      ...cloneSnapshot(),
      configOverrides: { ...cloneSnapshot().configOverrides, guardLeadWrites: true },
    },
    {
      ...cloneSnapshot(),
      configOverrides: { ...cloneSnapshot().configOverrides, maxReportChars: 12000 },
    },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, outcome: "timed_out" } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, status: "review" } },
    { ...cloneSnapshot(), handoff: { ...cloneSnapshot().handoff, message: "   " } },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "running",
        outcome: "completed",
      },
    },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "running",
        finishedAt: "2026-09-13T00:01:00.000Z",
      },
    },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "running",
        reportPath: "/tmp/forged.md",
      },
    },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "running",
        outcome: "completed",
        finishedAt: "2026-09-13T00:01:00.000Z",
        reportPath: "/tmp/forged.md",
      },
    },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "settled",
        outcome: undefined,
      },
    },
    {
      ...cloneSnapshot(),
      handoff: {
        ...cloneSnapshot().handoff,
        status: "settled",
        outcome: "completed",
        finishedAt: undefined,
      },
    },
  ];
  for (const [index, candidate] of invalidStates.entries()) {
    assert.throws(() => Parse(SIDEKICK_SNAPSHOT_SCHEMA, candidate), `invalid state ${index}`);
  }
});
