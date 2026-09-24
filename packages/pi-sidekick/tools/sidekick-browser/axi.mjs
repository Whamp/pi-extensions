import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLING_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const AXI_CLI_RELATIVE_PATH = "node_modules/chrome-devtools-axi/dist/bin/chrome-devtools-axi.js";
const MCP_ENTRYPOINT_RELATIVE_PATH =
  "node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";

/** Builds a local-only AXI launch specification without shell evaluation or fallback. */
export function createSidekickBrowserLaunchSpec(
  argv,
  parentEnvironment = process.env,
  toolingDirectory = TOOLING_DIRECTORY,
  callerCwd = process.cwd(),
) {
  const absoluteToolingDirectory = resolve(toolingDirectory);
  const axiCliPath = resolve(absoluteToolingDirectory, AXI_CLI_RELATIVE_PATH);
  const mcpEntrypoint = resolve(absoluteToolingDirectory, MCP_ENTRYPOINT_RELATIVE_PATH);
  const missingPaths = [axiCliPath, mcpEntrypoint].filter((path) => !existsSync(path));
  if (missingPaths.length > 0) {
    throw new Error(
      `Pinned Sidekick browser tooling is not installed: ${missingPaths.join(", ")}. ` +
        `Run npm ci --prefix ${absoluteToolingDirectory}.`,
    );
  }
  return {
    command: process.execPath,
    args: [axiCliPath, ...argv],
    cwd: callerCwd,
    env: {
      ...parentEnvironment,
      CHROME_DEVTOOLS_AXI_MCP_PATH: mcpEntrypoint,
    },
  };
}

function writeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}

function installSignalForwarding(child) {
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map(
    signals.map((signal) => [
      signal,
      () => {
        if (!child.killed) {
          child.kill(signal);
        }
      },
    ]),
  );
  for (const [signal, handler] of handlers) {
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

/** Runs the pinned local AXI CLI and propagates its exit status or signal. */
export async function runSidekickBrowserLauncher(argv) {
  let launchSpec;
  try {
    launchSpec = createSidekickBrowserLaunchSpec(argv);
  } catch (error) {
    writeError(error);
    return 1;
  }

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: launchSpec.cwd,
    env: launchSpec.env,
    stdio: "inherit",
  });
  const removeSignalForwarding = installSignalForwarding(child);
  return await new Promise((resolveExit) => {
    let settled = false;
    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      removeSignalForwarding();
      resolveExit(exitCode);
    };
    child.once("error", (error) => {
      writeError(error);
      finish(1);
    });
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        removeSignalForwarding();
        process.kill(process.pid, signal);
        finish(1);
        return;
      }
      finish(code ?? 1);
    });
  });
}

const isMainModule =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  process.exitCode = await runSidekickBrowserLauncher(process.argv.slice(2));
}
