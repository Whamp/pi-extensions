import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createSidekickBrowserLaunchSpec } from "./axi.mjs";

const AXI_CLI_RELATIVE_PATH = "node_modules/chrome-devtools-axi/dist/bin/chrome-devtools-axi.js";
const MCP_ENTRYPOINT_RELATIVE_PATH =
  "node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";

function createToolingFixture() {
  const toolingDirectory = mkdtempSync(join(tmpdir(), "sidekick-browser-launcher-"));
  for (const relativePath of [AXI_CLI_RELATIVE_PATH, MCP_ENTRYPOINT_RELATIVE_PATH]) {
    const path = join(toolingDirectory, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "fixture");
  }
  return toolingDirectory;
}

test("launch spec uses local entrypoints, caller cwd, and overrides a parent MCP path", () => {
  const toolingDirectory = createToolingFixture();
  const callerDirectory = mkdtempSync(join(tmpdir(), "sidekick-browser-caller-"));
  try {
    const spec = createSidekickBrowserLaunchSpec(
      ["open", "http://127.0.0.1:12345/fixture.html", "--full"],
      {
        PATH: "/parent-only/bin",
        CHROME_DEVTOOLS_AXI_MCP_PATH: "/parent-only/mcp.js",
      },
      toolingDirectory,
      callerDirectory,
    );
    assert.equal(spec.command, process.execPath);
    assert.deepEqual(spec.args, [
      resolve(toolingDirectory, AXI_CLI_RELATIVE_PATH),
      "open",
      "http://127.0.0.1:12345/fixture.html",
      "--full",
    ]);
    assert.equal(spec.cwd, callerDirectory);
    assert.equal(
      spec.env.CHROME_DEVTOOLS_AXI_MCP_PATH,
      resolve(toolingDirectory, MCP_ENTRYPOINT_RELATIVE_PATH),
    );
    assert.equal(spec.env.PATH, "/parent-only/bin");
  } finally {
    rmSync(callerDirectory, { recursive: true, force: true });
    rmSync(toolingDirectory, { recursive: true, force: true });
  }
});

test("missing local dependencies fail with an actionable local install command", () => {
  const toolingDirectory = mkdtempSync(join(tmpdir(), "sidekick-browser-missing-"));
  try {
    assert.throws(
      () =>
        createSidekickBrowserLaunchSpec(
          ["--version"],
          {
            PATH: "/parent-only/bin",
            CHROME_DEVTOOLS_AXI_MCP_PATH: "/parent-only/mcp.js",
          },
          toolingDirectory,
        ),
      (error) =>
        error instanceof Error &&
        error.message.includes(`npm ci --prefix ${resolve(toolingDirectory)}`),
    );
  } finally {
    rmSync(toolingDirectory, { recursive: true, force: true });
  }
});
