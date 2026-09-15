import assert from "node:assert/strict";
import test from "node:test";

import registerFilesExtension from "./index.ts";

test("Linux registers the files picker without the macOS Quick Look shortcut", () => {
  const commands: string[] = [];
  const shortcuts: string[] = [];
  const pi = {
    registerCommand: (name: string) => commands.push(name),
    registerShortcut: (key: string) => shortcuts.push(key),
  };

  registerFilesExtension(pi as never);

  assert.deepEqual(commands, ["files"]);
  assert.deepEqual(shortcuts, ["ctrl+shift+o"]);
});
