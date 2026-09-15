import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiffCommand,
  describeRevealAction,
  selectDiffEditor,
} from "./external-file-commands.ts";

test("Zed is preferred for graphical diffs when its CLI is installed", () => {
  assert.deepEqual(selectDiffEditor(new Set(["code", "zeditor"])), {
    executable: "zeditor",
    label: "Zed",
  });
  assert.deepEqual(buildDiffCommand("zeditor", "/tmp/base.ts", "/work/file.ts"), {
    executable: "zeditor",
    args: ["--wait", "--diff", "/tmp/base.ts", "/work/file.ts"],
  });
});

test("PI_FILES_DIFF_EDITOR can select an installed supported editor", () => {
  assert.deepEqual(selectDiffEditor(new Set(["code", "zeditor"]), "code"), {
    executable: "code",
    label: "VS Code",
  });
  assert.equal(selectDiffEditor(new Set(["zeditor"]), "code"), null);
});

test("VS Code remains a fallback when Zed is unavailable", () => {
  assert.deepEqual(selectDiffEditor(new Set(["code"])), {
    executable: "code",
    label: "VS Code",
  });
});

test("reveal action wording matches the host platform", () => {
  assert.equal(describeRevealAction("linux"), "Reveal in file manager");
  assert.equal(describeRevealAction("darwin"), "Reveal in Finder");
});
