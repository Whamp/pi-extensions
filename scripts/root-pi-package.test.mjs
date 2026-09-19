import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    "./packages/pi-jev-pruner/src/index.ts",
  ],
  skills: ["./packages/pi-pstack/skills"],
  subagents: {
    agents: ["./packages/pi-pstack/agents"],
  },
};

// Pi provides these itself, so packages list them instead of installing them.
const piBundledPackages = new Set([
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
]);

describe("package runtime dependencies", () => {
  it("declares every third-party runtime dependency in the root install surface", () => {
    // A git install runs npm install in this directory only, so a package's
    // third-party dependency resolves only when the root declares it too.
    const rootDependencies = packageJson.dependencies ?? {};
    const packageNames = readdirSync(join(repositoryRoot, "packages"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    assert.ok(packageNames.length > 0, "no packages found to check");

    for (const packageName of packageNames) {
      const manifest = JSON.parse(
        readFileSync(
          join(repositoryRoot, "packages", packageName, "package.json"),
          "utf8",
        ),
      );

      for (const [dependency, range] of Object.entries(
        manifest.dependencies ?? {},
      )) {
        if (piBundledPackages.has(dependency)) {
          continue;
        }
        assert.equal(
          rootDependencies[dependency],
          range,
          `packages/${packageName} needs ${dependency}@${range}, but the root dependencies say ${rootDependencies[dependency] ?? "nothing"}`,
        );
      }
    }
  });
});

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
