import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);

const expectedPiManifest = {
  extensions: [
    "./packages/pi-quiet/src/index.ts",
    "./packages/pi-pstack/extensions/pstack/index.ts",
    "./packages/pi-answer/extensions/answer/index.ts",
    "./packages/pi-files/extensions/files/index.ts",
    "./packages/pi-local-vllm-thinking-budget/extensions/local-vllm-thinking-budget/index.ts",
    "./packages/pi-session-breakdown/extensions/session-breakdown/index.ts",
    "./packages/pi-todos/extensions/todos/index.ts",
    "./packages/pi-tokps/extensions/tokps/index.ts",
  ],
  skills: ["./packages/pi-pstack/skills"],
  subagents: {
    agents: ["./packages/pi-pstack/agents"],
  },
};

describe("root Pi package", () => {
  it("advertises every package extension and all pi-pstack resources", () => {
    assert.deepEqual(packageJson.pi, expectedPiManifest);
  });

  it("points every advertised resource at an existing path", () => {
    const advertisedPaths = [
      ...packageJson.pi.extensions,
      ...packageJson.pi.skills,
      ...packageJson.pi.subagents.agents,
    ];

    for (const resourcePath of advertisedPaths) {
      assert.equal(
        existsSync(join(repositoryRoot, resourcePath)),
        true,
        `missing advertised Pi resource: ${resourcePath}`,
      );
    }
  });
});
