import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, loadConfig, parseModel, validateConfig } from "./config.ts";

const CURRENT_CONFIG_KEYS = [
  "broadExploration",
  "enabled",
  "leadProfile",
  "leadRenderedBrowser",
  "sidekick",
  "sidekickExtensions",
  "sidekickPreferExec",
  "sidekickSkills",
  "thinking",
  "tools",
  "version",
];

function temporaryConfigDirectories(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return { root, agentDir, cwd };
}

test("model IDs retain nested provider slashes", () =>
  assert.deepEqual(parseModel("openrouter/vendor/model"), {
    provider: "openrouter",
    id: "vendor/model",
  }));

test("invalid and fuzzy model inputs are rejected", () => {
  for (const value of [
    "worker",
    "/worker",
    "provider/",
    "provider/model with space",
    "provider/\u0000x",
  ]) {
    assert.throws(() => parseModel(value));
  }
});

test("current config rejects stale, removed, unknown, and nested fields", () => {
  for (const raw of [
    { maxTaskCost: 5 },
    { maxTurns: 40 },
    { maxRevisions: 3 },
    { profile: "capable" },
    { taskTimeoutSeconds: 600 },
    { guardLeadWrites: true },
    { maxReportChars: 12000 },
    { version: 1 },
    { arbitrary: true },
    { sidekick: { provider: "test", id: "worker", stale: true } },
  ]) {
    assert.throws(() => validateConfig(raw));
  }
});

test("config validation rejects invalid tools, paths, and execution policy", () => {
  for (const raw of [
    { tools: ["invalid tool"] },
    { tools: ["read", "read"] },
    { sidekickExtensions: ["./untrusted.ts"] },
    { sidekickExtensions: ["/trusted/\u0000extension.ts"] },
    { sidekickSkills: ["./untrusted-skill.md"] },
    { sidekickSkills: ["/trusted/\u0000skill.md"] },
    { sidekick: { provider: "", id: "x" } },
  ]) {
    assert.throws(() => validateConfig(raw));
  }
  assert.deepEqual(validateConfig({ tools: ["read", "exec", "todo", "browser"] }).tools, [
    "read",
    "exec",
    "todo",
    "browser",
  ]);
  const { root, agentDir, cwd } = temporaryConfigDirectories("sidekick-exec-config-");
  try {
    writeFileSync(
      join(agentDir, "sidekick.json"),
      JSON.stringify({ sidekickPreferExec: true, tools: ["bash"] }),
    );
    assert.equal(loadConfig(cwd, false, agentDir).sidekickPreferExec, true);
    writeFileSync(
      join(agentDir, "sidekick.json"),
      JSON.stringify({ sidekickPreferExec: true, tools: ["exec"] }),
    );
    assert.equal(loadConfig(cwd, false, agentDir).sidekickPreferExec, true);
    writeFileSync(
      join(agentDir, "sidekick.json"),
      JSON.stringify({ sidekickPreferExec: true, tools: ["read", "todo"] }),
    );
    assert.throws(
      () => loadConfig(cwd, false, agentDir),
      /Shell-first file strategy requires bash or exec in tools\./u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every supplied config layer rejects removed keys before precedence", () => {
  for (const key of ["guardLeadWrites", "maxReportChars", "taskTimeoutSeconds"]) {
    const { root, agentDir, cwd } = temporaryConfigDirectories(`sidekick-stale-${key}-`);
    try {
      writeFileSync(join(agentDir, "sidekick.json"), JSON.stringify({ [key]: 3 }));
      assert.throws(() => loadConfig(cwd, true, agentDir, { enabled: true }));
      writeFileSync(join(agentDir, "sidekick.json"), "{}");
      writeFileSync(join(cwd, ".pi", "sidekick.json"), JSON.stringify({ [key]: 3 }));
      assert.throws(() => loadConfig(cwd, true, agentDir));
      assert.doesNotThrow(() => loadConfig(cwd, false, agentDir));
      writeFileSync(join(cwd, ".pi", "sidekick.json"), "{}");
      assert.throws(() => loadConfig(cwd, true, agentDir, { [key]: 3 }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("invalid lower-precedence config cannot be hidden by a valid later value", () => {
  const { root, agentDir, cwd } = temporaryConfigDirectories("sidekick-config-precedence-");
  try {
    writeFileSync(join(agentDir, "sidekick.json"), JSON.stringify({ enabled: "yes" }));
    writeFileSync(join(cwd, ".pi", "sidekick.json"), JSON.stringify({ enabled: true }));
    assert.throws(() => loadConfig(cwd, true, agentDir, { enabled: false }), /Cannot load/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("untrusted project config is not read while trusted project config is validated", () => {
  const { root, agentDir, cwd } = temporaryConfigDirectories("sidekick-config-trust-");
  try {
    writeFileSync(join(agentDir, "sidekick.json"), JSON.stringify({ enabled: true }));
    writeFileSync(join(cwd, ".pi", "sidekick.json"), "this is invalid JSON");
    assert.equal(loadConfig(cwd, false, agentDir).enabled, true);
    assert.throws(() => loadConfig(cwd, true, agentDir), /Cannot load/u);
    writeFileSync(join(cwd, ".pi", "sidekick.json"), JSON.stringify({ enabled: false }));
    assert.equal(loadConfig(cwd, true, agentDir).enabled, false);
    assert.equal(loadConfig(cwd, true, agentDir, { enabled: true }).enabled, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolved current config has the exact 11-key shape and round-trips", () => {
  const { root, agentDir, cwd } = temporaryConfigDirectories("sidekick-config-shape-");
  try {
    const config = loadConfig(cwd, false, agentDir);
    assert.deepEqual(Object.keys(config).sort(), CURRENT_CONFIG_KEYS);
    assert.deepEqual(config, DEFAULT_CONFIG);
    writeFileSync(join(agentDir, "sidekick.json"), `${JSON.stringify(config)}\n`);
    assert.deepEqual(loadConfig(cwd, false, agentDir), config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("old config filename is ignored and untouched while Sidekick config is loaded", () => {
  const { root, agentDir, cwd } = temporaryConfigDirectories("sidekick-config-cutover-");
  const oldPath = join(agentDir, "fusion.json");
  try {
    writeFileSync(oldPath, JSON.stringify({ enabled: true }));
    const oldBytes = readFileSync(oldPath, "utf8");
    assert.equal(loadConfig(cwd, false, agentDir).enabled, false);
    writeFileSync(join(agentDir, "sidekick.json"), JSON.stringify({ enabled: true }));
    assert.equal(loadConfig(cwd, false, agentDir).enabled, true);
    assert.equal(readFileSync(oldPath, "utf8"), oldBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
