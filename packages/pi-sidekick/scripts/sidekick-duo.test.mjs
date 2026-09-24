import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const packageRoot = resolve(import.meta.dirname, "..");
const duoAgentPath = join(packageRoot, "agents", "sidekick-duo.md");
const sidekickExtensionPath = join(packageRoot, "index.ts");

test("pi-subagents discovers the packaged Sidekick Duo with its exact child contract", async () => {
  const testRoot = mkdtempSync(join(tmpdir(), "pi-sidekick-duo-"));
  const agentDirectory = join(testRoot, "agent");
  const projectDirectory = join(testRoot, "project");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  try {
    mkdirSync(agentDirectory, { recursive: true });
    mkdirSync(projectDirectory, { recursive: true });
    writeFileSync(
      join(agentDirectory, "settings.json"),
      `${JSON.stringify({ packages: [packageRoot] }, null, 2)}\n`,
    );
    process.env.PI_CODING_AGENT_DIR = agentDirectory;

    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const { resolveSubagentLaunchContract } = await jiti.import("pi-subagents/preflight");
    const result = await resolveSubagentLaunchContract({
      agent: "sidekick-duo",
      cwd: projectDirectory,
      task: "Repair the fixture and verify its focused test.",
      artifacts: false,
    });

    assert.equal(result.ok, true, result.ok ? undefined : result.message);
    if (!result.ok) {
      return;
    }
    assert.equal(result.contract.model, undefined);
    assert.deepEqual(
      {
        name: result.contract.agent.name,
        source: result.contract.agent.source,
        filePath: result.contract.agent.filePath,
        context: result.contract.context,
        systemPromptMode: result.contract.systemPromptMode,
        inheritProjectContext: result.contract.inheritProjectContext,
        inheritGlobalContext: result.contract.inheritGlobalContext,
        inheritSkills: result.contract.inheritSkills,
        explicitToolAllowlist: result.contract.tools.explicitAllowlist,
        fanoutAuthorized: result.contract.tools.fanoutAuthorized,
        disableAmbientExtensions: result.contract.tools.disableAmbientExtensions,
      },
      {
        name: "sidekick-duo",
        source: "package",
        filePath: duoAgentPath,
        context: "fresh",
        systemPromptMode: "append",
        inheritProjectContext: true,
        inheritGlobalContext: false,
        inheritSkills: true,
        explicitToolAllowlist: false,
        fanoutAuthorized: false,
        disableAmbientExtensions: false,
      },
    );
    assert.deepEqual(result.contract.tools.requestedBuiltin, []);
    assert.deepEqual(result.contract.tools.requiredChildTools, []);
    assert.ok(result.contract.tools.configuredExtensions.includes(sidekickExtensionPath));
    assert.ok(result.contract.tools.extensionArgs.includes(sidekickExtensionPath));
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
    rmSync(testRoot, { recursive: true, force: true });
  }
});
