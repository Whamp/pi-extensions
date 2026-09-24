import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLING_DIRECTORY = "tools/sidekick-browser";

function filesBelow(directory: string, prefix = ""): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return filesBelow(directory, relativePath);
    }
    return [relativePath];
  });
}

test("npm dry-run packs only runtime assets with resolvable local entrypoints", () => {
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--dry-run", "--json"], {
    cwd: PACKAGE_DIRECTORY,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const packedFiles = new Set<string>(pack.files.map((file: { path: string }) => file.path));
  const requiredFiles = [
    "index.ts",
    "agents/sidekick-duo.md",
    "README.md",
    "LICENSE",
    "src/extension.ts",
    "src/sidekick/child-capability-observer.ts",
    "src/prompt-profiles/prompt-catalog.ts",
    "src/prompt-profiles/pi-prompts.ts",
    "src/prompt-profiles/selectors.ts",
    "tools/sidekick-browser/axi.mjs",
    "tools/sidekick-browser/package.json",
    "tools/sidekick-browser/package-lock.json",
    "skills/sidekick-browser/SKILL.md",
    "examples/sidekick.json",
    "examples/smoke-project/math.mjs",
  ];
  for (const path of requiredFiles) {
    assert.ok(packedFiles.has(path), `missing from npm pack: ${path}`);
  }
  assert.equal(
    packedFiles.has("examples/smoke-project/math.test.mjs"),
    false,
    "packed the example smoke test",
  );
  for (const path of packedFiles) {
    assert.equal(
      /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u.test(path),
      false,
      `packed a test file: ${path}`,
    );
    assert.equal(path.startsWith("test/"), false, `packed test fixtures: ${path}`);
    assert.equal(path.startsWith("scripts/"), false, `packed scripts: ${path}`);
    assert.equal(path.startsWith("docs/"), false, `packed old docs: ${path}`);
    assert.equal(
      /^(?:\.lane|\.audit|\.pi|\.codegraph|artifacts|research|references|coverage|node_modules)(?:\/|$)/u.test(
        path,
      ),
      false,
      `packed excluded content: ${path}`,
    );
    assert.equal(path.includes("node_modules/"), false, `packed installed dependencies: ${path}`);
  }

  const runtimeFiles = filesBelow(PACKAGE_DIRECTORY, "src").filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
  );
  for (const path of runtimeFiles) {
    assert.ok(packedFiles.has(path), `runtime source omitted from npm pack: ${path}`);
  }

  const packageManifest = JSON.parse(readFileSync(join(PACKAGE_DIRECTORY, "package.json"), "utf8"));
  for (const extension of packageManifest.pi.extensions) {
    assert.ok(packedFiles.has(extension.replace(/^\.\//u, "")), `missing extension: ${extension}`);
  }
  const duoAgent = readFileSync(join(PACKAGE_DIRECTORY, "agents/sidekick-duo.md"), "utf8");
  const duoExtension = duoAgent.match(/^subagentOnlyExtensions:\s*(\S+)$/mu)?.[1];
  assert.ok(duoExtension);
  const duoExtensionPath = posix.normalize(posix.join("agents", duoExtension));
  assert.ok(packedFiles.has(duoExtensionPath), `missing Duo extension: ${duoExtensionPath}`);
  assert.ok(packedFiles.has("agents/sidekick-duo.md"));

  const skill = readFileSync(join(PACKAGE_DIRECTORY, "skills/sidekick-browser/SKILL.md"), "utf8");
  const browserLauncher = skill.match(/`\.\.\/\.\.\/tools\/sidekick-browser\/axi\.mjs`/u);
  assert.ok(browserLauncher, "browser skill launcher path changed");
  assert.ok(packedFiles.has("tools/sidekick-browser/axi.mjs"));

  const browserManifestPath = join(PACKAGE_DIRECTORY, TOOLING_DIRECTORY, "package.json");
  const browserLockPath = join(PACKAGE_DIRECTORY, TOOLING_DIRECTORY, "package-lock.json");
  const browserManifest = JSON.parse(readFileSync(browserManifestPath, "utf8"));
  const browserLock = JSON.parse(readFileSync(browserLockPath, "utf8"));
  assert.deepEqual(browserLock.packages[""].dependencies, browserManifest.dependencies);
  assert.equal(existsSync(join(PACKAGE_DIRECTORY, "index.ts")), true);
});
