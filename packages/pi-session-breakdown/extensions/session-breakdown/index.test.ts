import assert from "node:assert/strict";
import test from "node:test";

import registerSessionBreakdownExtension from "./index.ts";

test("registers the session-breakdown command", () => {
  const commands: string[] = [];
  const pi = {
    registerCommand: (name: string) => commands.push(name),
  };

  registerSessionBreakdownExtension(pi as never);

  assert.deepEqual(commands, ["session-breakdown"]);
});
