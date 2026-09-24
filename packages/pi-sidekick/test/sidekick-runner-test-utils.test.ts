import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { createSidekickRunnerHarness } from "./sidekick-runner-test-utils.ts";

test("journal reads ignore a record until its newline is complete", async () => {
  const fixture = createSidekickRunnerHarness();
  try {
    writeFileSync(fixture.journal, '{"type":"abort"}\n{"type":"get_state"');
    assert.deepEqual(fixture.records(), [{ type: "abort" }]);

    writeFileSync(fixture.journal, '{"type":"abort"}\n{"type":"get_state"}\n');
    assert.deepEqual(fixture.records(), [{ type: "abort" }, { type: "get_state" }]);
  } finally {
    await fixture.cleanup();
  }
});
