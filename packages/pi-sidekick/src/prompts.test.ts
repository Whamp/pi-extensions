import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanDisplay,
  handoffAdmissionSummary,
  handoffSummary,
  handoffWaitWindowSummary,
} from "./prompts.ts";
import { Outcome } from "./enums.ts";
import type { Handoff } from "./types.ts";

function terminalHandoff(report: string): Handoff {
  return {
    id: "handoff-one",
    message: "Implement the requested change",
    status: "settled",
    outcome: Outcome.COMPLETED,
    startedAt: "2026-09-13T00:00:00.000Z",
    finishedAt: "2026-09-13T00:01:00.000Z",
    report,
    reportPath: "/tmp/handoff-one.md",
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
    accounting: "complete",
  };
}

test("admission presentation identifies the started or steered handoff", () => {
  const handoff: Handoff = {
    id: "handoff-one",
    message: "Implement the requested change",
    status: "running",
    startedAt: "2026-09-13T00:00:00.000Z",
    report: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };
  assert.match(handoffAdmissionSummary("started", handoff), /handoff-one started/u);
  assert.match(handoffAdmissionSummary("steered", handoff), /independently inspect/u);
});

test("terminal presentation requires independent review and preserves the full report path", () => {
  const summary = handoffSummary(terminalHandoff("A complete report."), "/tmp/child.jsonl");
  assert.match(summary, /UNTRUSTED REPORT/u);
  assert.match(summary, /Full report: \/tmp\/handoff-one\.md/u);
  assert.match(summary, /A complete report/u);
});

test("admission presentation includes the optional native child transcript", () => {
  const handoff: Handoff = {
    id: "handoff-running",
    message: "Implement the requested change",
    status: "running",
    startedAt: "2026-09-13T00:00:00.000Z",
    report: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
  };
  assert.match(handoffSummary(handoff, "/tmp/child.jsonl"), /Child session: \/tmp\/child\.jsonl/u);
  assert.match(handoffSummary(handoff), /Child session: native transcript/u);
});

test("visible report uses Pi truncateHead defaults and points to the complete artifact", () => {
  const report = `${"x".repeat(60_000)}\ncomplete tail marker`;
  const summary = handoffSummary(terminalHandoff(report));
  assert.match(summary, /Report truncated by Pi's default output limits/u);
  assert.match(summary, /\/tmp\/handoff-one\.md/u);
  assert.doesNotMatch(summary, /complete tail marker/u);
});

test("terminal presentation bounds oversized report and error text without inventing an artifact path", () => {
  const handoff = {
    ...terminalHandoff(`${"x".repeat(60_000)}\ncomplete tail marker`),
    reportPath: undefined,
    error: `worker failed: ${"é".repeat(60_000)}`,
  };
  const summary = handoffSummary(handoff, "/tmp/child.jsonl");
  assert.match(summary, /UNTRUSTED REPORT/u);
  assert.match(summary, /Complete report artifact unavailable/u);
  assert.match(summary, /Child session: \/tmp\/child\.jsonl/u);
  assert.match(summary, /Report truncated by Pi's default output limits/u);
  assert.doesNotMatch(summary, /complete tail marker/u);
  assert.doesNotMatch(summary, /the Sidekick report path/u);
  assert.doesNotMatch(summary, /é{1000}/u);
  assert.ok(Buffer.byteLength(summary, "utf8") <= 50 * 1024);
  assert.ok(summary.split("\n").length <= 2000);
});

test("passive wait window presentation keeps execution running and names the target", () => {
  const summary = handoffWaitWindowSummary("handoff-one", 25);
  assert.match(summary, /handoff-one/u);
  assert.match(summary, /25 ms elapsed/u);
  assert.match(summary, /without stopping the worker or observing a terminal report/u);
  assert.match(summary, /observation requested no stop/u);
  assert.doesNotMatch(summary, /is still running/u);
  assert.match(summary, /completion notification remains available/u);
});

test("cleanDisplay removes terminal controls while preserving readable separators", () => {
  assert.equal(cleanDisplay("before\x1b[31mred\x1b[0m\nnext\x00"), "beforered\nnext");
});
