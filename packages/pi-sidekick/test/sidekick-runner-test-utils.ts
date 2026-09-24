import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { SidekickConfig } from "../src/config.ts";
import { freezePiSidekickPrompt } from "../src/prompt-profiles/pi-prompts.ts";
import { selectSidekickPromptProfile } from "../src/prompt-profiles/selectors.ts";
import { PiRpc } from "../src/sidekick/rpc.ts";
import type { RpcEvent } from "../src/sidekick/rpc.ts";
import { SidekickRunner } from "../src/sidekick/runner.ts";
import { SidekickStore } from "../src/store.ts";

type SidekickRunnerJournalRecord =
  | { type: "spawn"; args: string[]; pid: number }
  | { type: "prompt"; message: string }
  | { type: "steer"; message: string }
  | { type: "abort" }
  | { type: "clear_queue" }
  | { type: "get_session_stats" }
  | { type: "get_state" }
  | { type: "event"; eventType: string; message?: RpcEvent["message"] };

/** Absolute path to the deterministic Pi RPC fixture used by Sidekick runner tests. */
export const SIDEKICK_RUNNER_FIXTURE = fileURLToPath(
  new URL("./fixtures/fake-pi.mjs", import.meta.url),
);
/** Minimal nonblank message shared by runner and extension contract tests. */
export const SIDEKICK_TEST_MESSAGE = "Implement the scoped fixture task and report verification.";

/** Creates an isolated deterministic runner fixture that callers must close with cleanup(). */
export function createSidekickRunnerHarness(
  scenario = "normal",
  patch: Partial<SidekickConfig> = {},
  root?: string,
  parent = "parent-one",
) {
  const dir = root ?? mkdtempSync(join(tmpdir(), "pi-sidekick-test-"));
  const journal = join(dir, `journal-${parent}.jsonl`);
  const parentSessionDirectory = join(dir, "parent-sessions");
  const existingParentFile = existsSync(parentSessionDirectory)
    ? readdirSync(parentSessionDirectory)
        .filter((file) => file.endsWith(`_${parent}.jsonl`))
        .map((file) => join(parentSessionDirectory, file))[0]
    : undefined;
  const parentSessionManager = existingParentFile
    ? SessionManager.open(existingParentFile, parentSessionDirectory, dir)
    : SessionManager.create(dir, parentSessionDirectory, { id: parent });
  if (!existingParentFile) {
    parentSessionManager.appendMessage({
      role: "user",
      content: "Sidekick runner harness parent session",
      timestamp: Date.now(),
    });
    parentSessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Parent session fixture" }],
      api: "pi-messages",
      provider: "test",
      model: "parent",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
  }
  const store = new SidekickStore(dir, dir, parent, {
    sessionDir: parentSessionManager.getSessionDir(),
    parentSessionFile: parentSessionManager.getSessionFile(),
  });
  store.acquire();
  const snapshot = store.load();
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    enabled: true,
    sidekick: { provider: "test", id: "worker" },
    ...patch,
  };
  if (!snapshot.frozenSidekickPrompt) {
    const profile = selectSidekickPromptProfile({
      activeToolNames: config.tools,
      preferExec: config.sidekickPreferExec,
    });
    snapshot.frozenSidekickPrompt = freezePiSidekickPrompt(profile, config);
    store.save(snapshot);
  }
  const runner = new SidekickRunner({
    store,
    snapshot,
    config,
    trusted: false,
    parentSessionManager,
    rpcFactory: (args, env) =>
      new PiRpc({
        launch: {
          command: process.execPath,
          args: [SIDEKICK_RUNNER_FIXTURE, "--scenario", scenario, "--journal", journal],
        },
        args,
        cwd: dir,
        env,
        requestTimeoutMs: 1000,
        killGraceMs: 5,
      }),
  });
  const records = (): SidekickRunnerJournalRecord[] => {
    if (!existsSync(journal)) return [];
    const text = readFileSync(journal, "utf8");
    const completeEnd = text.lastIndexOf("\n");
    if (completeEnd < 0) return [];
    return text
      .slice(0, completeEnd)
      .split("\n")
      .filter(Boolean)
      .map((line): SidekickRunnerJournalRecord => JSON.parse(line));
  };
  return {
    dir,
    journal,
    runner,
    store,
    config,
    parentSessionManager,
    records,
    cleanup: async () => {
      await runner.close();
      if (!root) rmSync(dir, { recursive: true, force: true });
    },
  };
}
/** Polls a Sidekick test condition and throws when it remains false at the deadline. */
export async function waitUntilSidekickCondition(
  predicate: () => boolean,
  ms = 3000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Test wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
