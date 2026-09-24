import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPi087CompatibilityHarness } from "../../test/sidekick-pi-087-compatibility-harness.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPORT_TEXT = "Offline compatibility handoff complete.";

test(
  "Pi 0.87.1 completes two Sidekick handoffs through localhost OpenAI SSE",
  { timeout: 45000 },
  async (t) => {
    const piCliPath = join(
      PACKAGE_ROOT,
      "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    );
    const hostManifestPath = join(
      PACKAGE_ROOT,
      "node_modules/@earendil-works/pi-coding-agent/package.json",
    );
    assert.ok(existsSync(piCliPath));
    const harness = await createPi087CompatibilityHarness({
      packageRoot: PACKAGE_ROOT,
      piCliPath,
      hostManifestPath,
    });
    t.after(async () => harness.cleanup());

    const first = await harness.runner.dispatch("Run the offline Pi compatibility handoff.");
    assert.equal(first.status, "admitted");
    const firstTerminal = await first.completion;
    assert.equal(firstTerminal.status, "settled");
    assert.equal(firstTerminal.outcome, "completed");
    assert.equal(firstTerminal.report, REPORT_TEXT);
    assert.deepEqual(firstTerminal.usage, {
      input: 17,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 1,
    });

    const firstChildPid = harness.workers[0]?.pid;
    assert.ok(firstChildPid);
    const second = await harness.runner.dispatch("Repeat the offline Pi compatibility handoff.");
    assert.equal(second.status, "admitted");
    const secondTerminal = await second.completion;
    assert.equal(secondTerminal.status, "settled");
    assert.equal(secondTerminal.outcome, "completed");
    assert.equal(secondTerminal.report, REPORT_TEXT);
    assert.deepEqual(secondTerminal.usage, {
      input: 17,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 1,
    });
    assert.equal(harness.workers.length, 1);
    assert.equal(harness.workers[0]?.pid, firstChildPid);
    assert.equal(harness.requests.length, 2);
    assert.deepEqual(harness.unexpectedRequests, []);
    assert.ok(
      harness.requests.every(
        (request) =>
          request.path === "/v1/chat/completions" &&
          request.model === "fixture" &&
          request.stream === true &&
          request.authorization === "Bearer offline-fixture" &&
          request.roles.includes("system") &&
          request.roles.includes("user"),
      ),
    );
    assert.ok(
      harness.protocolEvents.some(
        (event) => event.type === "message_start" && event.role === "system",
      ),
    );
    assert.ok(
      harness.protocolEvents.some(
        (event) => event.type === "message_end" && event.role === "system",
      ),
    );
    assert.ok(
      harness.protocolEvents.some(
        (event) => event.type === "message_start" && event.role === "user",
      ),
    );
    assert.ok(
      harness.protocolEvents.some((event) => event.type === "message_end" && event.role === "user"),
    );
    assert.deepEqual(harness.toolExecutionEvents, []);
    assert.deepEqual(
      harness.milestones.map((milestone) => milestone.type),
      ["turn_end", "agent_settled", "turn_end", "agent_settled"],
    );
    for (const milestone of harness.milestones) {
      assert.equal(milestone.status, "running");
      assert.equal(milestone.report, REPORT_TEXT);
    }
    assert.deepEqual(harness.runner.snapshot.totals, {
      input: 34,
      output: 14,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      turns: 2,
    });

    const evidence = harness.finalEvidence([
      {
        outcome: firstTerminal.outcome,
        report: firstTerminal.report,
        usage: firstTerminal.usage,
      },
      {
        outcome: secondTerminal.outcome,
        report: secondTerminal.report,
        usage: secondTerminal.usage,
      },
    ]);
    if (process.env.PI_SIDEKICK_COMPATIBILITY_EVIDENCE) {
      writeFileSync(
        process.env.PI_SIDEKICK_COMPATIBILITY_EVIDENCE,
        `${JSON.stringify(evidence, null, 2)}\n`,
        { mode: 0o600 },
      );
    }
    t.diagnostic(
      JSON.stringify({
        hostPiVersion: evidence.hostPiVersion,
        provider: evidence.provider,
        model: evidence.model,
        childPids: evidence.childPids,
        protocolEvents: evidence.protocolEvents,
        milestones: evidence.milestones,
        serverRequests: evidence.serverRequests,
        handoffs: evidence.handoffs,
        toolExecutionEvents: evidence.toolExecutionEvents,
      }),
    );
  },
);
