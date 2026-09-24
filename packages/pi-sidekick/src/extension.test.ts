import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type as SCHEMA, type Static, type TObject } from "typebox";
import { Parse } from "typebox/value";
import { SIDEKICK_BROWSER_SKILL_PATH } from "./browser-capability.ts";
import { registerSidekick } from "./extension.ts";
import type { HandoffToolDetails } from "./extension.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick/sidekick-state-schema.ts";
import type { Snapshot } from "./types.ts";
import type { ParentSessionManagerLike } from "./sidekick/session.ts";
import {
  SIDEKICK_RUNNER_FIXTURE,
  SIDEKICK_TEST_MESSAGE,
  waitUntilSidekickCondition,
} from "../test/sidekick-runner-test-utils.ts";

type TestMode = "tui" | "rpc" | "json" | "print";
interface TestEntry {
  id: string;
  type: "message" | "custom";
  customType?: string;
  data?: unknown;
}
interface TestModelReference {
  provider: string;
  id: string;
}
interface TestSessionManager extends ParentSessionManagerLike {
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}
interface TestContext {
  cwd: string;
  mode: TestMode;
  hasUI: boolean;
  model: TestModelReference | undefined;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setStatus(key: string, value: string | undefined): void;
    select(title: string, choices: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
  };
  sessionManager: TestSessionManager;
  modelRegistry: {
    getAvailable(): TestModelReference[];
    find(provider: string, id: string): TestModelReference | undefined;
  };
  isProjectTrusted(): boolean;
  signal: AbortSignal | undefined;
}
interface TestBeforeAgentStartResult {
  systemPrompt: string;
  message?: { customType: string; display: boolean; content: string };
}
interface TestEvent {
  type: string;
  systemPrompt: string;
  toolName: string;
  isError: boolean;
}
type TestEventHandler = (
  event: TestEvent,
  ctx: TestContext,
) => TestBeforeAgentStartResult | void | Promise<TestBeforeAgentStartResult | void>;
interface TestTextContent {
  type: "text";
  text: string;
}
interface TestWaitCompletedDetails {
  kind: "wait_completed";
  handoff: { id: string; status: "settled" };
  sessionFile?: string;
}
interface TestWaitWindowDetails {
  kind: "window_elapsed";
  handoffId: string;
  timeoutMs: number;
}
type TestWaitToolDetails = TestWaitCompletedDetails | TestWaitWindowDetails;
interface TestToolUpdate {
  content: TestTextContent[];
  details: HandoffToolDetails | TestWaitToolDetails | { kind: "progress" };
}
interface TestToolResult {
  content: TestTextContent[];
  details: HandoffToolDetails;
}
interface TestToolExecutionResult {
  content: TestTextContent[];
  details: HandoffToolDetails | TestWaitToolDetails;
}
interface TestWaitToolResult {
  content: TestTextContent[];
  details: TestWaitToolDetails;
}
interface TestTool {
  name: string;
  description: string;
  executionMode?: "sequential" | "parallel";
  parameters: TObject;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((update: TestToolUpdate) => void) | undefined,
    ctx: TestContext,
  ): Promise<TestToolExecutionResult>;
}
interface TestCommand {
  handler(args: string, ctx: TestContext): Promise<void>;
}
interface SidekickHostTestHooks {
  defaultObservationTimeoutMs?: number;
}
interface TestSentMessagePayload {
  customType: string;
  content: string;
  display: boolean;
}
interface TestSentMessage extends TestSentMessagePayload {
  options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
}
type TestNotification = [message: string, level?: "info" | "warning" | "error"];
const JOURNAL_RECORD_SCHEMA = SCHEMA.Object(
  {
    type: SCHEMA.String(),
    id: SCHEMA.Optional(SCHEMA.String()),
    args: SCHEMA.Optional(SCHEMA.Array(SCHEMA.String())),
    pid: SCHEMA.Optional(SCHEMA.Integer()),
    message: SCHEMA.Optional(SCHEMA.String()),
  },
  { additionalProperties: true },
);
type TestJournalRecord = Static<typeof JOURNAL_RECORD_SCHEMA>;
const BEFORE_AGENT_START_RESULT_SCHEMA = SCHEMA.Object(
  {
    systemPrompt: SCHEMA.String(),
    message: SCHEMA.Optional(
      SCHEMA.Object({
        customType: SCHEMA.String(),
        display: SCHEMA.Boolean(),
        content: SCHEMA.String(),
      }),
    ),
  },
  { additionalProperties: false },
);
const TEST_LEDGER_DATA_SCHEMA = SCHEMA.Object(
  { handoffId: SCHEMA.String() },
  { additionalProperties: true },
);
const TEST_WAIT_DETAILS_SCHEMA = SCHEMA.Union([
  SCHEMA.Object(
    {
      kind: SCHEMA.Literal("wait_completed"),
      handoff: SCHEMA.Object(
        { id: SCHEMA.String(), status: SCHEMA.Literal("settled") },
        { additionalProperties: true },
      ),
      sessionFile: SCHEMA.Optional(SCHEMA.String()),
    },
    { additionalProperties: false },
  ),
  SCHEMA.Object(
    {
      kind: SCHEMA.Literal("window_elapsed"),
      handoffId: SCHEMA.String(),
      timeoutMs: SCHEMA.Integer(),
    },
    { additionalProperties: false },
  ),
]);
type TestWaitDetails = Static<typeof TEST_WAIT_DETAILS_SCHEMA>;
function waitDetails(result: TestWaitToolResult): TestWaitDetails {
  return Parse(TEST_WAIT_DETAILS_SCHEMA, result.details);
}
function sessionInfoEntry(id: string): SessionEntry {
  return {
    type: "session_info",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    name: id,
  };
}
function customSessionEntry(id: string, customType: string, data: unknown): SessionEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType,
    data,
  };
}
function nativeEntries(entries: readonly TestEntry[]): SessionEntry[] {
  return entries.map((entry) =>
    entry.type === "custom"
      ? customSessionEntry(entry.id, entry.customType ?? "test", entry.data)
      : sessionInfoEntry(entry.id),
  );
}
function readPersistedSnapshot(path: string): Snapshot {
  return Parse(SIDEKICK_SNAPSHOT_SCHEMA, JSON.parse(readFileSync(path, "utf8")));
}

async function host(
  scenario: string = "normal",
  enabled: boolean = true,
  mode: TestMode = "tui",
  configPatch: Record<string, unknown> = {},
  failInitialStatusUpdate = false,
  testHooks: SidekickHostTestHooks = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-host-"));
  const journal = join(dir, "journal.jsonl");
  const oldEnv = {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_SIDEKICK_PI: process.env.PI_SIDEKICK_PI,
    PI_SIDEKICK_PI_ARGS: process.env.PI_SIDEKICK_PI_ARGS,
  };
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_SIDEKICK_PI = process.execPath;
  process.env.PI_SIDEKICK_PI_ARGS = JSON.stringify([
    SIDEKICK_RUNNER_FIXTURE,
    "--scenario",
    scenario,
    "--journal",
    journal,
  ]);
  const parentSessionDirectory = join(dir, "parent-sessions");
  mkdirSync(parentSessionDirectory);
  writeFileSync(
    join(dir, "sidekick.json"),
    JSON.stringify({
      ...DEFAULT_CONFIG,
      enabled,
      sidekick: { provider: "test", id: "worker" },
      ...configPatch,
    }),
  );
  let parentId = "lead-one";
  let entries: TestEntry[] = [{ id: "root", type: "message" }];
  let serial = 0;
  const hooks = new Map<string, TestEventHandler[]>();
  const tools = new Map<string, TestTool>();
  const commands = new Map<string, TestCommand>();
  const notifications: TestNotification[] = [];
  const messages: TestSentMessage[] = [];
  const completionRegistrySizes: number[] = [];
  const observationTimeouts: number[] = [];
  const passiveWaitClaimCounts: number[] = [];
  const statuses = new Map<string, string | undefined>();
  let failCompletionDelivery = false;
  let holdCompletionDelivery = false;
  let releaseHeldCompletionDelivery: (() => void) | undefined;
  let failReminderDelivery = false;
  let failAppendEntry = false;
  let failStatus = failInitialStatusUpdate;
  let failNotify = false;
  const ctx: TestContext = {
    cwd: dir,
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    model: { provider: "test", id: "lead" },
    ui: {
      notify: (message, level) => {
        if (failNotify) {
          throw new Error("simulated notification failure");
        }
        notifications.push([message, level]);
      },
      setStatus: (key: string, value: string | undefined) => {
        if (failStatus) {
          throw new Error("simulated status update failure");
        }
        statuses.set(key, value);
      },
      select: async (_title: string, choices: string[]) => choices[0],
      confirm: async () => true,
    },
    sessionManager: {
      getSessionId: () => parentId,
      getSessionDir: () => parentSessionDirectory,
      getSessionFile: () => join(parentSessionDirectory, `${parentId}.jsonl`),
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntries: () => nativeEntries(entries),
      getBranch: () => nativeEntries(entries),
    },
    modelRegistry: {
      getAvailable: () => [{ provider: "test", id: "worker" }],
      find: (provider: string, id: string) =>
        provider === "test" && ["worker", "worker-two", "lead"].includes(id)
          ? { provider, id }
          : undefined,
    },
    isProjectTrusted: () => false,
    signal: undefined,
  };
  const pi = {
    on: (name: string, fn: TestEventHandler) => {
      hooks.set(name, [...(hooks.get(name) ?? []), fn]);
    },
    registerTool: (tool: TestTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, commandValue: TestCommand) => commands.set(name, commandValue),
    getActiveTools: () => [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "sidekick",
      "sidekick_wait",
    ],
    appendEntry: (customType: string, data?: unknown) => {
      if (failAppendEntry) {
        throw new Error("simulated parent ledger failure");
      }
      entries.push({ id: `entry-${++serial}`, type: "custom", customType, data });
    },
    sendMessage: (message: TestSentMessagePayload, options?: TestSentMessage["options"]) => {
      if (failReminderDelivery && message.customType === "pi-sidekick-reminder") {
        throw new Error("simulated reminder delivery failure");
      }
      if (failCompletionDelivery && message.customType === "pi-sidekick" && options?.triggerTurn) {
        throw new Error("simulated completion delivery failure");
      }
      messages.push({ ...message, options: options ?? {} });
      if (holdCompletionDelivery && message.customType === "pi-sidekick" && options?.triggerTurn) {
        return new Promise<void>((resolve) => {
          releaseHeldCompletionDelivery = resolve;
        });
      }
    },
  };
  registerSidekick(pi, SCHEMA, {
    defaultObservationTimeoutMs: testHooks.defaultObservationTimeoutMs,
    onCompletionRegistrySize: (size) => completionRegistrySizes.push(size),
    onObservationTimeoutScheduled: (timeoutMs) => observationTimeouts.push(timeoutMs),
    onPassiveWaitClaimCount: (count) => passiveWaitClaimCounts.push(count),
  });
  async function emit(
    name: "before_agent_start",
    event?: Partial<TestEvent>,
  ): Promise<Array<TestBeforeAgentStartResult | undefined>>;
  async function emit(
    name: string,
    event?: Partial<TestEvent>,
  ): Promise<Array<TestBeforeAgentStartResult | undefined>>;
  async function emit(name: string, event: Partial<TestEvent> = {}) {
    const input: TestEvent = {
      type: name,
      systemPrompt: event.systemPrompt ?? "",
      toolName: event.toolName ?? "",
      isError: event.isError ?? false,
    };
    const results: Array<TestBeforeAgentStartResult | undefined> = [];
    for (const fn of hooks.get(name) ?? []) {
      const output = await fn(input, ctx);
      results.push(
        output === undefined ? undefined : Parse(BEFORE_AGENT_START_RESULT_SCHEMA, output),
      );
    }
    return results;
  }
  async function call(
    name: "sidekick",
    args?: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: TestToolUpdate) => void,
  ): Promise<TestToolResult>;
  async function call(
    name: "sidekick_wait",
    args?: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: TestToolUpdate) => void,
  ): Promise<TestWaitToolResult>;
  async function call(
    name: string,
    args: unknown = {},
    signal?: AbortSignal,
    onUpdate?: (update: TestToolUpdate) => void,
  ): Promise<TestToolExecutionResult> {
    const tool = tools.get(name);
    assert.ok(tool, `missing tool ${name}`);
    return await tool.execute("call", args, signal, onUpdate, ctx);
  }
  const command = async (text: string) => {
    const sidekickCommand = commands.get("sidekick");
    assert.ok(sidekickCommand, "missing sidekick command");
    await sidekickCommand.handler(text, ctx);
  };
  const records = (): TestJournalRecord[] => {
    if (!existsSync(journal)) {
      return [];
    }
    const text = readFileSync(journal, "utf8");
    const completeEnd = text.lastIndexOf("\n");
    if (completeEnd < 0) {
      return [];
    }
    return text
      .slice(0, completeEnd)
      .split("\n")
      .filter(Boolean)
      .map((line) => Parse(JOURNAL_RECORD_SCHEMA, JSON.parse(line)));
  };
  await emit("session_start");
  return {
    dir,
    journal,
    ctx,
    tools,
    commands,
    notifications,
    messages,
    completionRegistrySizes,
    observationTimeouts,
    passiveWaitClaimCounts,
    statuses,
    call,
    emit,
    command,
    entries: () => entries.slice(),
    records,
    failCompletionDelivery: (fail: boolean) => {
      failCompletionDelivery = fail;
    },
    holdCompletionDelivery: (hold: boolean) => {
      holdCompletionDelivery = hold;
    },
    releaseCompletionDelivery: () => {
      const release = releaseHeldCompletionDelivery;
      releaseHeldCompletionDelivery = undefined;
      release?.();
    },
    failReminderDelivery: (fail: boolean) => {
      failReminderDelivery = fail;
    },
    failAppendEntry: (fail: boolean) => {
      failAppendEntry = fail;
    },
    failStatus: (fail: boolean) => {
      failStatus = fail;
    },
    failNotify: (fail: boolean) => {
      failNotify = fail;
    },
    clearLedger: () => {
      entries = entries.filter(
        (entry) => entry.id === "root" || entry.customType === "pi-sidekick-checkpoint",
      );
    },
    changeParent: (id: string) => {
      parentId = id;
      entries = [{ id: "root", type: "message" }];
    },
    rewind: () => {
      entries = [{ id: "root", type: "message" }];
    },
    markChildSession: () => {
      entries = [
        { id: "root", type: "message" },
        {
          id: "child-marker",
          type: "custom",
          customType: "pi-sidekick-child",
          data: { parentId, epoch: "epoch-one", sessionId: "child-session" },
        },
      ];
    },
    cleanup: async () => {
      await emit("session_shutdown");
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("explicit bundled browser skill enables browser guidance without a browser tool", async () => {
  const h = await host("normal", true, "tui", {
    sidekickSkills: [SIDEKICK_BROWSER_SKILL_PATH],
    tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  });
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const spawn = h.records().find((record) => record.type === "spawn");
    assert.ok(spawn);
    assert.ok(spawn.args);
    const promptIndex = spawn.args.indexOf("--append-system-prompt");
    assert.notEqual(promptIndex, -1);
    const prompt = spawn.args[promptIndex + 1];
    assert.ok(prompt);
    assert.match(prompt, /Visual verification: use the browser tools when/u);
    assert.doesNotMatch(prompt, /browser tools are slow/u);
  } finally {
    await h.cleanup();
  }
});

test("adapter registers sequential messaging and passive wait tools with closed schemas", async () => {
  const h = await host("normal", false);
  try {
    assert.deepEqual([...h.tools.keys()], ["sidekick", "sidekick_wait"]);
    const sidekickTool = h.tools.get("sidekick");
    assert.ok(sidekickTool);
    assert.equal(sidekickTool.executionMode, "sequential");
    assert.match(sidekickTool.description, /30-second.*observation window/u);
    assert.match(sidekickTool.description, /Execution has no product deadline/u);
    assert.deepEqual(Object.keys(sidekickTool.parameters.properties), ["message", "block"]);
    const waitTool = h.tools.get("sidekick_wait");
    assert.ok(waitTool);
    assert.equal(waitTool.executionMode, "sequential");
    assert.match(waitTool.description, /30-second default observation window/u);
    assert.match(waitTool.description, /never stops execution/u);
    assert.deepEqual(Object.keys(waitTool.parameters.properties), ["handoffId", "timeoutMs"]);
    assert.equal(h.commands.has("sidekick"), true);
    assert.equal(h.tools.has("sidekick_delegate"), false);
    assert.equal(h.tools.has("sidekick_wait"), true);
    assert.equal(h.tools.has("sidekick_review"), false);
    assert.equal(h.tools.has("sidekick_steer"), false);
    assert.equal(h.tools.has("sidekick_cancel"), false);
    assert.equal(h.tools.has("sidekick_status"), false);
    await assert.rejects(h.call("sidekick", { message: "   " }), /blank/u);
    await assert.rejects(h.call("sidekick", {}), /message/u);
    await assert.rejects(h.call("sidekick_wait", { handoffId: "not-a-uuid" }), /UUID/u);
    await assert.rejects(
      h.call("sidekick_wait", {
        handoffId: "00000000-0000-0000-0000-000000000000",
        message: "not allowed",
      }),
      /UUID/u,
    );
  } finally {
    await h.cleanup();
  }
});

test("model-facing dispatch rejects a missing Sidekick model before launch", async () => {
  const h = await host("normal", true, "tui", { sidekick: null });
  try {
    await assert.rejects(
      h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE }),
      /Choose a sidekick with \/sidekick model/u,
    );
    assert.deepEqual(h.records(), []);
  } finally {
    await h.cleanup();
  }
});

test("tool calls expose Sidekick progress without changing the terminal result", async () => {
  const h = await host();
  try {
    const updates: TestToolUpdate[] = [];
    const terminal = await h.call(
      "sidekick",
      { message: SIDEKICK_TEST_MESSAGE },
      undefined,
      (update) => updates.push(update),
    );
    assert.equal(terminal.details.handoff.status, "settled");
    assert.deepEqual(updates, [
      {
        content: [{ type: "text", text: "Sidekick working: read" }],
        details: { kind: "progress" },
      },
    ]);
  } finally {
    await h.cleanup();
  }
});

test("idle message starts a handoff and running message steers in place", async () => {
  const h = await host("hang");
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const second = await h.call("sidekick", {
      message: "Steer without starting another child.",
      block: false,
    });
    assert.equal(first.details.kind, "started");
    assert.equal(second.details.kind, "steered");
    assert.equal(second.details.handoff.id, first.details.handoff.id);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 1);
    assert.equal(h.records().filter((record) => record.type === "steer").length, 1);
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("nonblocking result waits for admission and sends exactly one terminal notification", async () => {
  const h = await host("slow");
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    assert.equal(admission.details.handoff.status, "running");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
    assert.match(h.messages[0].content, /UNTRUSTED REPORT/u);
    assert.ok(h.entries().some((entry) => entry.customType === "pi-sidekick-child-link"));
    assert.ok(h.entries().some((entry) => entry.customType === "pi-sidekick-completion"));
  } finally {
    await h.cleanup();
  }
});

test("passive wait returns the exact running handoff report without steering or notifying", async () => {
  const h = await host("slow");
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const waited = await h.call("sidekick_wait", {
      handoffId: admission.details.handoff.id,
    });
    const details = waitDetails(waited);
    assert.equal(details.kind, "wait_completed");
    if (details.kind !== "wait_completed") {
      throw new Error("passive wait unexpectedly elapsed");
    }
    assert.equal(details.handoff.id, admission.details.handoff.id);
    assert.match(waited.content[0].text, /Report 1: verified fixture/u);
    const records = h.records();
    assert.equal(records.filter((record) => record.type === "prompt").length, 1);
    assert.equal(
      records.filter((record) => ["steer", "abort", "clear_queue"].includes(record.type)).length,
      0,
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
  } finally {
    await h.cleanup();
  }
});

test("passive wait rejects foreign and old handoff IDs without touching the child", async () => {
  const h = await host("normal");
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const second = await h.call("sidekick", { message: "Start the next handoff." });
    const beforeForeign = h.records().length;
    await assert.rejects(
      h.call("sidekick_wait", { handoffId: "00000000-0000-0000-0000-000000000000" }),
      /target unavailable/u,
    );
    assert.equal(h.records().length, beforeForeign);
    const beforeOld = h.records().length;
    await assert.rejects(
      h.call("sidekick_wait", { handoffId: first.details.handoff.id }),
      /target unavailable/u,
    );
    assert.equal(h.records().length, beforeOld);
    assert.notEqual(first.details.handoff.id, second.details.handoff.id);
  } finally {
    await h.command("cancel");
    await h.cleanup();
  }
});

test("aborting passive wait detaches only its waiter and later delivers one notification", async () => {
  const h = await host("slow");
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const controller = new AbortController();
    const pending = h.call(
      "sidekick_wait",
      { handoffId: admission.details.handoff.id },
      controller.signal,
    );
    await waitUntilSidekickCondition(() => h.passiveWaitClaimCounts.at(-1) === 1);
    controller.abort();
    await assert.rejects(pending, /wait was cancelled/u);
    assert.equal(h.passiveWaitClaimCounts.at(-1), 0);
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    const records = h.records();
    assert.equal(
      records.filter((record) => ["steer", "abort", "clear_queue"].includes(record.type)).length,
      0,
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("passive wait timeout only ends observation and preserves notification fallback", async () => {
  const h = await host("slow");
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const result = await h.call("sidekick_wait", {
      handoffId: admission.details.handoff.id,
      timeoutMs: 1,
    });
    const details = waitDetails(result);
    assert.equal(details.kind, "window_elapsed");
    if (details.kind !== "window_elapsed") {
      throw new Error("passive wait unexpectedly completed");
    }
    assert.equal(details.handoffId, admission.details.handoff.id);
    assert.equal(details.timeoutMs, 1);
    assert.equal(
      h.records().some((record) => ["abort", "clear_queue"].includes(record.type)),
      false,
    );
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("passive wait omission uses the default observation window", async () => {
  const h = await host("slow", true, "tui", {}, false, {
    defaultObservationTimeoutMs: 1,
  });
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const result = await h.call("sidekick_wait", {
      handoffId: admission.details.handoff.id,
    });
    const details = waitDetails(result);
    assert.equal(details.kind, "window_elapsed");
    if (details.kind !== "window_elapsed") {
      throw new Error("default passive observation unexpectedly completed");
    }
    assert.equal(details.timeoutMs, 1);
    assert.deepEqual(h.observationTimeouts, [1]);
    assert.equal(
      h.records().some((record) => ["steer", "abort", "clear_queue"].includes(record.type)),
      false,
    );
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("passive wait rejects a notification already in progress", async () => {
  const h = await host("slow");
  try {
    h.holdCompletionDelivery(true);
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    const before = h.records().length;
    await assert.rejects(
      h.call("sidekick_wait", { handoffId: admission.details.handoff.id }),
      /already owned by an in-progress notification delivery/u,
    );
    assert.equal(h.records().length, before);
    h.releaseCompletionDelivery();
    await waitUntilSidekickCondition(() => h.completionRegistrySizes.at(-1) === 0);
  } finally {
    h.releaseCompletionDelivery();
    await h.cleanup();
  }
});

test("passive wait replays the exact latest settled handoff without launch or notification", async () => {
  const h = await host("normal");
  try {
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const before = h.records().length;
    const messages = h.messages.length;
    const replay = await h.call("sidekick_wait", { handoffId: terminal.details.handoff.id });
    const details = waitDetails(replay);
    assert.equal(details.kind, "wait_completed");
    if (details.kind !== "wait_completed") {
      throw new Error("latest settled handoff did not replay");
    }
    assert.equal(details.handoff.id, terminal.details.handoff.id);
    assert.equal(h.records().length, before);
    assert.equal(h.messages.length, messages);
  } finally {
    await h.cleanup();
  }
});

test("passive wait keeps the original child path after a configuration refresh retry", async () => {
  const h = await host("slow");
  try {
    h.failCompletionDelivery(true);
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const originalChildSession = admission.details.sessionFile;
    assert.ok(originalChildSession);
    await waitUntilSidekickCondition(() =>
      h.entries().some((entry) => entry.customType === "pi-sidekick-completion"),
    );
    await h.command("model test/worker-two");
    const waited = await h.call("sidekick_wait", { handoffId: admission.details.handoff.id });
    assert.match(waited.content[0].text, new RegExp(`Child session: ${originalChildSession}`, "u"));
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    h.failCompletionDelivery(false);
  } finally {
    h.failCompletionDelivery(false);
    await h.cleanup();
  }
});

test("human cancellation and lifecycle suppression remain authoritative when passive wait exits", async () => {
  for (const command of ["cancel", "off", "reset --yes"]) {
    const h = await host("hang");
    try {
      const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
      const pending = h.call("sidekick_wait", { handoffId: admission.details.handoff.id });
      await waitUntilSidekickCondition(() => h.passiveWaitClaimCounts.at(-1) === 1);
      await h.command(command);
      const result = await pending;
      assert.equal(h.passiveWaitClaimCounts.at(-1), 0);
      assert.match(result.content[0].text, /UNTRUSTED REPORT/u);
      assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    } finally {
      await h.cleanup();
    }
  }
});

test("passive wait forwards child progress and removes its listener", async () => {
  const h = await host("delayed-progress");
  try {
    const admission = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const updates: string[] = [];
    await h.call(
      "sidekick_wait",
      { handoffId: admission.details.handoff.id },
      undefined,
      (update) => updates.push(update.content[0]?.text ?? ""),
    );
    assert.deepEqual(updates, ["Sidekick working: read"]);
    await h.call("sidekick", { message: "Run a second handoff with progress." });
    assert.deepEqual(updates, ["Sidekick working: read"]);
  } finally {
    await h.cleanup();
  }
});

test("blocking same-handoff steer releases the prior completion promise", async () => {
  const h = await host("slow");
  try {
    const initial = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    assert.equal(h.completionRegistrySizes.at(-1), 1);
    const terminal = await h.call("sidekick", { message: "Finish the same handoff." });
    assert.equal(terminal.details.handoff.id, initial.details.handoff.id);
    assert.equal(h.completionRegistrySizes.at(-1), 0);
  } finally {
    await h.cleanup();
  }
});

test("settlement-race replacement releases the suppressed completion promise", async () => {
  const h = await host("delayed-steer-ack");
  try {
    const initial = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    assert.equal(h.completionRegistrySizes.at(-1), 1);
    const replacement = await h.call("sidekick", { message: "Replace the settled handoff." });
    assert.equal(replacement.details.kind, "started");
    assert.notEqual(replacement.details.handoff.id, initial.details.handoff.id);
    assert.equal(h.completionRegistrySizes.at(-1), 0);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 2);
    assert.equal(h.records().filter((record) => record.type === "steer").length, 1);
  } finally {
    await h.cleanup();
  }
});

test("Pi defaults interactive observation to 30 seconds", async () => {
  const h = await host("slow");
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const admission = await h.call("sidekick", {
      message: "Start one background handoff.",
      block: false,
    });
    await h.call("sidekick_wait", { handoffId: admission.details.handoff.id });
    assert.deepEqual(h.observationTimeouts, [30_000, 30_000]);
  } finally {
    await h.cleanup();
  }
});

test("default blocking observation moves an admitted handoff into the background", async () => {
  const h = await host("slow", true, "tui", {}, false, {
    defaultObservationTimeoutMs: 1,
  });
  try {
    const backgrounded = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    assert.equal(backgrounded.details.handoff.status, "running");
    assert.match(backgrounded.content[0].text, /1 ms elapsed without stopping the worker/u);
    assert.deepEqual(h.observationTimeouts, [1]);
    assert.equal(
      h.records().some((record) => ["steer", "abort", "clear_queue"].includes(record.type)),
      false,
    );
    const terminal = await h.call("sidekick_wait", {
      handoffId: backgrounded.details.handoff.id,
      timeoutMs: 1000,
    });
    assert.equal(waitDetails(terminal).kind, "wait_completed");
    assert.equal(h.records().filter((record) => record.type === "prompt").length, 1);
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
  } finally {
    await h.cleanup();
  }
});

test("aborting a blocking initial call detaches only its waiter and later notifies once", async () => {
  const h = await host("slow");
  try {
    const controller = new AbortController();
    const pending = h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE }, controller.signal);
    await waitUntilSidekickCondition(() =>
      h.entries().some((entry) => entry.customType === "pi-sidekick-child-link"),
    );
    controller.abort();
    await assert.rejects(pending, /wait was cancelled/u);
    const childLink = h.entries().find((entry) => entry.customType === "pi-sidekick-child-link");
    assert.ok(childLink);
    const { handoffId } = Parse(TEST_LEDGER_DATA_SCHEMA, childLink.data);
    const [nextLeadTurn] = await h.emit("before_agent_start");
    assert.match(nextLeadTurn?.message?.content ?? "", new RegExp(handoffId, "u"));
    assert.equal(
      h.records().some((record) => ["clear_queue", "abort"].includes(record.type)),
      false,
    );
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("aborting a blocking steer detaches only that waiter and never aborts the child", async () => {
  const h = await host("hang");
  try {
    const initial = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const controller = new AbortController();
    const pending = h.call(
      "sidekick",
      { message: "Please inspect the edge case." },
      controller.signal,
    );
    await waitUntilSidekickCondition(() => h.records().some((record) => record.type === "steer"));
    controller.abort();
    await assert.rejects(pending, /wait was cancelled/u);
    assert.equal(
      h.records().some((record) => ["clear_queue", "abort"].includes(record.type)),
      false,
    );
    await h.command("cancel");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    const next = await h.call("sidekick", { message: "new handoff", block: false });
    assert.notEqual(next.details.handoff.id, initial.details.handoff.id);
    assert.equal(next.details.sessionFile, initial.details.sessionFile);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("nonblocking initial admission waits for a delayed prompt acknowledgment", async () => {
  const h = await host("delayed-prompt-ack");
  try {
    let settled = false;
    const pending = h
      .call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false })
      .then((result) => {
        settled = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    const admission = await pending;
    assert.equal(admission.details.handoff.status, "running");
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("aborting before prompt admission preserves the later dispatch notification path", async () => {
  const h = await host("delayed-prompt-ack");
  try {
    const controller = new AbortController();
    const pending = h.call(
      "sidekick",
      { message: SIDEKICK_TEST_MESSAGE, block: false },
      controller.signal,
    );
    await waitUntilSidekickCondition(() => h.records().some((record) => record.type === "prompt"));
    controller.abort();
    await assert.rejects(pending, /dispatch was cancelled/u);
    await waitUntilSidekickCondition(() => h.completionRegistrySizes.at(-1) === 1);
    assert.equal(
      h.records().some((record) => record.type === "abort"),
      false,
    );
    await h.command("cancel");
    assert.equal(h.completionRegistrySizes.at(-1), 0);
  } finally {
    await h.cleanup();
  }
});

test("nonblocking steer admission waits for a delayed steer acknowledgment", async () => {
  const h = await host("delayed-steer-ack-running");
  try {
    const initial = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    let settled = false;
    const pending = h
      .call("sidekick", { message: "Steer after the delayed acknowledgment.", block: false })
      .then((result) => {
        settled = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    const admission = await pending;
    assert.equal(admission.details.kind, "steered");
    assert.equal(admission.details.handoff.status, "running");
    assert.equal(admission.details.handoff.id, initial.details.handoff.id);
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("blocking steer intent suppresses duplicate notification during settlement", async () => {
  const h = await host("delayed-steer-ack");
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const terminal = await h.call("sidekick", { message: "Correct the delayed handoff." });
    assert.equal(terminal.details.handoff.status, "settled");
    await h.emit("agent_settled");
    await h.emit("agent_settled");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    assert.equal(h.records().filter((record) => record.type === "spawn").length, 1);
  } finally {
    await h.cleanup();
  }
});

test("shutdown marks the parent dead before an interrupted completion event", async () => {
  const h = await host("hang");
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await h.emit("session_shutdown");
    assert.equal(
      h.entries().filter((entry) => entry.customType === "pi-sidekick-completion").length,
      0,
    );
  } finally {
    await h.cleanup();
  }
});

test("already-aborted calls do not create state or launch prompt/steer", async () => {
  const h = await host();
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE }, controller.signal),
      /before starting/u,
    );
    assert.equal(h.records().length, 0);
    assert.equal(h.messages.length, 0);
  } finally {
    await h.cleanup();
  }
});

test("blocking terminal result and completion notification carry the untrusted review obligation", async () => {
  const h = await host();
  try {
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    assert.equal(terminal.details.handoff.status, "settled");
    assert.match(terminal.content[0].text, /UNTRUSTED REPORT/u);
    const first = await h.call("sidekick", { message: "Apply one ordinary correction." });
    assert.notEqual(first.details.handoff.id, terminal.details.handoff.id);
    assert.match(first.content[0].text, /UNTRUSTED REPORT/u);
  } finally {
    await h.cleanup();
  }
});

test("failed admission rejects the tool while preserving the terminal report artifact", async () => {
  for (const scenario of ["bad-start", "reject", "wrong-model", "missing-tool"]) {
    const h = await host(scenario);
    try {
      await assert.rejects(
        h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false }),
        /not delivered/u,
      );
      const sessionRoot = join(h.dir, "sidekick", "sessions");
      const sessionDirectory = readdirSync(sessionRoot)[0];
      assert.ok(sessionDirectory);
      const state = readPersistedSnapshot(join(sessionRoot, sessionDirectory, "state.json"));
      assert.ok(state.handoff);
      assert.equal(state.handoff.status, "settled");
      assert.equal(state.handoff.outcome, "failed");
      const reportPath = state.handoff.reportPath;
      assert.ok(reportPath);
      assert.equal(existsSync(reportPath), true);
      assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    } finally {
      await h.cleanup();
    }
  }
});

test("completion notification retries after a delivery failure without duplicates", async () => {
  const h = await host("slow");
  try {
    h.failCompletionDelivery(true);
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    h.failCompletionDelivery(false);
    await h.emit("agent_settled");
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    await h.emit("agent_settled");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("Sidekick-affecting config refresh transfers a failed completion notification exactly once", async () => {
  const h = await host("slow");
  try {
    h.failCompletionDelivery(true);
    const admission = await h.call("sidekick", {
      message: SIDEKICK_TEST_MESSAGE,
      block: false,
    });
    const completedChildSession = admission.details.sessionFile;
    assert.ok(completedChildSession);
    await waitUntilSidekickCondition(() =>
      h.entries().some((entry) => entry.customType === "pi-sidekick-completion"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    await h.command("model test/worker-two");
    h.failCompletionDelivery(false);
    await h.emit("agent_settled");
    await waitUntilSidekickCondition(() =>
      h.messages.some((message) => message.options.triggerTurn),
    );
    await h.emit("agent_settled");
    const completionMessages = h.messages.filter((message) => message.options.triggerTurn);
    assert.equal(completionMessages.length, 1);
    assert.equal(
      completionMessages[0]?.content.includes(`Child session: ${completedChildSession}`),
      true,
    );
  } finally {
    await h.cleanup();
  }
});

test("explicit reset releases a failed completion notification without replay", async () => {
  const h = await host("slow");
  try {
    h.failCompletionDelivery(true);
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await waitUntilSidekickCondition(() =>
      h.entries().some((entry) => entry.customType === "pi-sidekick-completion"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await h.command("reset --yes");
    h.failCompletionDelivery(false);
    await h.emit("agent_settled");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
  } finally {
    await h.cleanup();
  }
});

test("parent ledger and status listener failures do not reject a persisted terminal result", async () => {
  const h = await host();
  try {
    h.failAppendEntry(true);
    h.failStatus(true);
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    assert.equal(terminal.details.handoff.status, "settled");
    assert.match(terminal.content[0].text, /UNTRUSTED REPORT/u);
  } finally {
    await h.cleanup();
  }
});

test("parent observer failures cannot reject completion or shutdown", async () => {
  const h = await host();
  try {
    h.failAppendEntry(true);
    h.failStatus(true);
    h.failNotify(true);
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    assert.equal(terminal.details.handoff.status, "settled");
    const sessionDirectory = readdirSync(join(h.dir, "sidekick", "sessions"))[0];
    assert.ok(sessionDirectory);
    const state = readPersistedSnapshot(
      join(h.dir, "sidekick", "sessions", sessionDirectory, "state.json"),
    );
    assert.ok(state.handoff);
    assert.equal(state.handoff.status, "settled");
    assert.equal(state.handoff.id, terminal.details.handoff.id);
  } finally {
    await h.cleanup();
  }
});

test("oversized reports stay complete on disk while tool details remain compact", async () => {
  const h = await host("oversized-report");
  try {
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const details = terminal.details.handoff;
    assert.equal(Object.hasOwn(details, "report"), false);
    assert.equal(Object.hasOwn(details, "message"), false);
    assert.ok(details.reportPath);
    const report = readFileSync(details.reportPath, "utf8");
    assert.equal(report, `Report 1: ${"x".repeat(60_000)}`);
    assert.match(terminal.content[0].text, /Report truncated by Pi's default output limits/u);
    assert.match(
      terminal.content[0].text,
      new RegExp(details.reportPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  } finally {
    await h.cleanup();
  }
});

test("human cancel remains available while model cancellation tools are absent", async () => {
  const h = await host("hang");
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await h.command("cancel");
    assert.deepEqual(
      h
        .records()
        .filter((record) => ["clear_queue", "abort"].includes(record.type))
        .map((record) => record.type),
      ["clear_queue", "abort"],
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    assert.equal(h.tools.has("sidekick_cancel"), false);
  } finally {
    await h.cleanup();
  }
});

test("human off suppresses pending completion notifications before stopping the child", async () => {
  const h = await host("hang");
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await h.command("off");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    assert.deepEqual(
      h
        .records()
        .filter((record) => ["clear_queue", "abort"].includes(record.type))
        .map((record) => record.type),
      ["clear_queue", "abort"],
    );
  } finally {
    await h.cleanup();
  }
});

test("print and JSON modes force blocking even when block is false", async () => {
  const HEADLESS_MODES: TestMode[] = ["print", "json"];
  for (const mode of HEADLESS_MODES) {
    const h = await host("slow", true, mode, {}, false, {
      defaultObservationTimeoutMs: 1,
    });
    try {
      const result = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
      assert.equal(result.details.handoff.status, "settled");
      assert.deepEqual(h.observationTimeouts, []);
      assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    } finally {
      await h.cleanup();
    }
  }
});

test("parent ledger deduplicates child link and completion entries across repeated events", async () => {
  const h = await host();
  try {
    const result = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const linkCount = () =>
      h.entries().filter((entry) => entry.customType === "pi-sidekick-child-link").length;
    const completionCount = () =>
      h.entries().filter((entry) => entry.customType === "pi-sidekick-completion").length;
    assert.equal(linkCount(), 1);
    assert.equal(completionCount(), 1);
    await h.emit("agent_settled");
    assert.equal(linkCount(), 1);
    assert.equal(completionCount(), 1);
    const completionEntry = h
      .entries()
      .find((entry) => entry.customType === "pi-sidekick-completion");
    assert.ok(completionEntry);
    const completionData = Parse(TEST_LEDGER_DATA_SCHEMA, completionEntry.data);
    assert.equal(completionData.handoffId, result.details.handoff.id);
  } finally {
    await h.cleanup();
  }
});

test("session recovery recreates missing child and completion ledger entries", async () => {
  const h = await host();
  try {
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    h.clearLedger();
    await h.emit("session_shutdown");
    await h.emit("session_start");
    assert.equal(
      h.entries().filter((entry) => entry.customType === "pi-sidekick-child-link").length,
      1,
    );
    assert.equal(
      h.entries().filter((entry) => entry.customType === "pi-sidekick-completion").length,
      1,
    );
  } finally {
    await h.cleanup();
  }
});

test("thinking command updates effective Sidekick status before epoch creation without changing Lead", async () => {
  const h = await host("normal", true, "tui", { sidekick: null });
  try {
    await h.command("thinking max");
    const sessionDirectory = readdirSync(join(h.dir, "sidekick", "sessions"))[0];
    assert.ok(sessionDirectory);
    const snapshot = readPersistedSnapshot(
      join(h.dir, "sidekick", "sessions", sessionDirectory, "state.json"),
    );
    assert.equal(snapshot.configOverrides.thinking, "max");
    await h.command("status");
    const status = h.messages.at(-1)?.content ?? "";
    assert.match(status, /Lead: test\/lead \(auto; direct exploration\)/u);
    assert.match(status, /Configured sidekick: not configured \(max\)/u);
    assert.match(status, /Frozen epoch: not created/u);
    assert.deepEqual(h.ctx.model, { provider: "test", id: "lead" });
    assert.deepEqual(h.records(), []);
  } finally {
    await h.cleanup();
  }
});

test("file-strategy command toggles the persisted compatibility boolean and status", async () => {
  const h = await host();
  try {
    await h.command("status");
    assert.match(h.messages.at(-1)?.content ?? "", /File strategy: builtin-first/u);

    await h.command("file-strategy shell-first");
    assert.equal(h.notifications.at(-1)?.[0], "Sidekick file strategy: shell-first");
    const sessionDirectory = readdirSync(join(h.dir, "sidekick", "sessions"))[0];
    assert.ok(sessionDirectory);
    const statePath = join(h.dir, "sidekick", "sessions", sessionDirectory, "state.json");
    assert.equal(readPersistedSnapshot(statePath).configOverrides.sidekickPreferExec, true);
    await h.command("status");
    assert.match(h.messages.at(-1)?.content ?? "", /File strategy: shell-first/u);

    const beforeInvalid = readPersistedSnapshot(statePath).configOverrides;
    await h.command("file-strategy invalid");
    assert.match(
      h.notifications.at(-1)?.[0] ?? "",
      /Use \/sidekick file-strategy builtin-first\|shell-first/u,
    );
    assert.deepEqual(readPersistedSnapshot(statePath).configOverrides, beforeInvalid);

    await h.command("file-strategy builtin-first");
    assert.equal(h.notifications.at(-1)?.[0], "Sidekick file strategy: builtin-first");
    assert.equal(readPersistedSnapshot(statePath).configOverrides.sidekickPreferExec, false);
    await h.command("prefer-exec on");
    assert.equal(readPersistedSnapshot(statePath).configOverrides.sidekickPreferExec, true);
    await h.command("prefer-exec off");
    assert.equal(readPersistedSnapshot(statePath).configOverrides.sidekickPreferExec, false);
  } finally {
    await h.cleanup();
  }
});

test("save writes the exact current config shape without guard or report cap", async () => {
  const h = await host();
  try {
    await h.command("thinking max");
    await h.command("save");
    const saved = loadConfig(h.dir, false, h.dir);
    assert.deepEqual(Object.keys(saved).sort(), [
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
    ]);
    assert.equal(Object.hasOwn(saved, "guardLeadWrites"), false);
    assert.equal(Object.hasOwn(saved, "maxReportChars"), false);
    assert.equal(saved.thinking, "max");
    assert.deepEqual(loadConfig(h.dir, false, h.dir), saved);
  } finally {
    await h.cleanup();
  }
});

test("thinking command rejects invalid and empty values without changing config", async () => {
  const h = await host();
  try {
    await h.command("status");
    const before = h.messages.at(-1)?.content ?? "";
    await h.command("thinking invalid");
    assert.match(
      h.notifications.at(-1)?.[0] ?? "",
      /Use \/sidekick thinking off\|minimal\|low\|medium\|high\|xhigh\|max/u,
    );
    await h.command("thinking");
    assert.match(
      h.notifications.at(-1)?.[0] ?? "",
      /Use \/sidekick thinking off\|minimal\|low\|medium\|high\|xhigh\|max/u,
    );
    await h.command("status");
    assert.equal(h.messages.at(-1)?.content, before);
  } finally {
    await h.cleanup();
  }
});

test("marked child sessions warn, skip lead injection, and reject Sidekick operations", async () => {
  const h = await host();
  try {
    await h.emit("session_shutdown");
    h.markChildSession();
    await h.emit("session_start");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /PI_SIDEKICK_CHILD=1/u);
    assert.match(h.statuses.get("pi-sidekick") ?? "", /disabled/u);
    assert.deepEqual(await h.emit("before_agent_start", { systemPrompt: "lead prompt" }), [
      undefined,
    ]);
    await assert.rejects(h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE }), /marked child/u);
  } finally {
    await h.cleanup();
  }
});

test("failed initialization releases the store lock before a corrected restart", async () => {
  const h = await host("normal", true, "tui", { enabled: "invalid" });
  try {
    assert.match(h.notifications.at(-1)?.[0] ?? "", /Sidekick disabled/u);
    writeFileSync(
      join(h.dir, "sidekick.json"),
      JSON.stringify({
        ...DEFAULT_CONFIG,
        enabled: true,
        sidekick: { provider: "test", id: "worker" },
      }),
    );
    await h.emit("session_start");
    await h.command("status");
    assert.match(h.messages.at(-1)?.content ?? "", /Enabled: true/u);
  } finally {
    await h.cleanup();
  }
});

test("status presents provider telemetry without removed workflow controls", async () => {
  const h = await host("expensive");
  try {
    const terminal = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    await h.command("status");
    const status = h.messages.at(-1)?.content ?? "";
    assert.match(status, /Sidekick totals: .*"cost":6/u);
    assert.match(status, /Sidekick totals: .* \(reconciled when available\)\n/u);
    assert.match(status, /Costs are provider-reported estimates/u);
    assert.match(status, /handoff/u);
    assert.doesNotMatch(
      status,
      /maxReportChars|taskTimeoutSeconds|timed_out|cost limit|review required/u,
    );
    assert.equal(terminal.details.handoff.cost, 6);
  } finally {
    await h.cleanup();
  }
});

test("unknown command follows the ordinary Sidekick help error path", async () => {
  const h = await host();
  try {
    await h.command("profile capable");
    const expected = h.notifications.at(-1)?.[0] ?? "";
    assert.match(expected, /\/sidekick model \[provider\/model-id\]/u);
    assert.match(expected, /\/sidekick thinking off\|minimal\|low\|medium\|high\|xhigh\|max/u);
    await h.command("unknown capable");
    assert.equal(h.notifications.at(-1)?.[0], expected);
    await h.command("rendered-browser maybe");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /rendered-browser on\|off/u);
    await h.command("file-strategy maybe");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /file-strategy builtin-first\|shell-first/u);
  } finally {
    await h.cleanup();
  }
});

test("running handoffs reject Sidekick-affecting changes until explicit cancellation", async () => {
  const h = await host("hang");
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    await h.command("model test/worker-two");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /Wait for the running Sidekick handoff/u);
    await h.command("thinking max");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /Wait for the running Sidekick handoff/u);
    await h.command("file-strategy shell-first");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /Wait for the running Sidekick handoff/u);
    await h.command("cancel");
    await h.command("model test/worker-two");
    const second = await h.call("sidekick", {
      message: "Start with the new child model.",
      block: false,
    });
    assert.notEqual(second.details.handoff.id, first.details.handoff.id);
    assert.notEqual(second.details.sessionFile, first.details.sessionFile);
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("lead-only policy changes apply on the next turn without replacing the child epoch", async () => {
  const h = await host();
  try {
    await h.command("lead strict");
    await h.command("broad-exploration on");
    await h.command("rendered-browser on");
    const [event] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(event);
    assert.match(event.systemPrompt, /Specify the code, don't describe it/u);
    assert.match(h.notifications.at(-1)?.[0] ?? "", /rendered-browser policy: on/u);
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    await h.command("lead standard");
    const second = await h.call("sidekick", { message: "Continue with the same child context." });
    assert.equal(second.details.sessionFile, first.details.sessionFile);
  } finally {
    await h.cleanup();
  }
});

test("reset during a background handoff stops the old epoch and preserves its evidence", async () => {
  const h = await host("hang");
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const oldSession = first.details.sessionFile;
    assert.ok(oldSession);
    const sessionDirectory = readdirSync(join(h.dir, "sidekick", "sessions"))[0];
    assert.ok(sessionDirectory);
    const statePath = join(h.dir, "sidekick", "sessions", sessionDirectory, "state.json");
    const running = readPersistedSnapshot(statePath);
    assert.ok(running.handoff);
    assert.equal(running.handoff.status, "running");
    const oldReportPath = join(
      h.dir,
      "sidekick",
      "sessions",
      sessionDirectory,
      running.epoch,
      `${running.handoff.id}.md`,
    );
    await h.command("reset --yes");
    assert.deepEqual(
      h
        .records()
        .filter((record) => ["clear_queue", "abort"].includes(record.type))
        .map((record) => record.type),
      ["clear_queue", "abort"],
    );
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
    assert.equal(existsSync(oldSession), true);
    assert.equal(existsSync(oldReportPath), true);
    const second = await h.call("sidekick", { message: "Run the new reset epoch.", block: false });
    assert.notEqual(second.details.handoff.id, first.details.handoff.id);
    assert.notEqual(second.details.sessionFile, oldSession);
    await h.command("cancel");
    assert.equal(h.messages.filter((message) => message.options.triggerTurn).length, 0);
  } finally {
    await h.cleanup();
  }
});

test("tree reset creates a fresh child while preserving the previous report artifact", async () => {
  const h = await host();
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const oldReportPath = first.details.handoff.reportPath;
    assert.ok(oldReportPath);
    const oldSession = first.details.sessionFile;
    assert.ok(oldSession);
    h.rewind();
    await h.emit("session_tree");
    const second = await h.call("sidekick", { message: "Run the fresh epoch check." });
    assert.notEqual(second.details.sessionFile, oldSession);
    assert.equal(existsSync(oldSession), true);
    assert.equal(existsSync(oldReportPath), true);
  } finally {
    await h.cleanup();
  }
});

test("same-parent restart resumes the child and a new parent gets a separate transcript", async () => {
  const h = await host();
  try {
    const first = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    await h.emit("session_shutdown");
    await h.emit("session_start");
    const resumed = await h.call("sidekick", { message: "Continue after the parent restart." });
    assert.equal(resumed.details.sessionFile, first.details.sessionFile);
    await h.emit("session_shutdown");
    h.changeParent("fork-two");
    await h.emit("session_start");
    const fork = await h.call("sidekick", { message: "Start in the forked parent." });
    assert.notEqual(fork.details.sessionFile, resumed.details.sessionFile);
  } finally {
    await h.cleanup();
  }
});

test("concurrent startup and tree reset preserve the reset intent", async () => {
  const h = await host();
  try {
    await h.emit("session_shutdown");
    await Promise.all([h.emit("session_start"), h.emit("session_tree")]);
    const result = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    assert.equal(result.details.handoff.status, "settled");
  } finally {
    await h.cleanup();
  }
});

test("lead prompt material never enters the child transcript", async () => {
  const h = await host();
  try {
    const [before] = await h.emit("before_agent_start", { systemPrompt: "SENSITIVE_LEAD_SECRET" });
    assert.ok(before);
    assert.ok(before.systemPrompt.includes("SENSITIVE_LEAD_SECRET"));
    const result = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    const [after] = await h.emit("before_agent_start", { systemPrompt: "SENSITIVE_LEAD_SECRET" });
    assert.ok(after);
    assert.equal(after.systemPrompt, before.systemPrompt);
    const sessionFile = result.details.sessionFile;
    assert.ok(sessionFile);
    assert.doesNotMatch(readFileSync(sessionFile, "utf8"), /SENSITIVE_LEAD_SECRET/u);
  } finally {
    await h.cleanup();
  }
});

test("headless reset requires explicit confirmation", async () => {
  const h = await host("normal", true, "print");
  try {
    await h.command("reset");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /reset --yes/u);
    await h.command("reset --yes");
    assert.match(h.notifications.at(-1)?.[0] ?? "", /context reset/u);
  } finally {
    await h.cleanup();
  }
});

test("first-message reminder persists across restart and rearms after branch rewind", async () => {
  const h = await host();
  try {
    const [first] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(first?.message);
    assert.equal(first.message.customType, "pi-sidekick-state");
    assert.ok(first.message.content.trim());
    const [second] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(second);
    assert.equal(second.message, undefined);
    await h.emit("session_shutdown");
    await h.emit("session_start");
    const [restarted] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(restarted);
    assert.equal(restarted.message, undefined);
    await h.command("reset --yes");
    const [reset] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(reset);
    assert.equal(reset.message, undefined);
    h.rewind();
    await h.emit("session_tree");
    const [rewound] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(rewound?.message);
    assert.equal(rewound.message.customType, "pi-sidekick-state");
    assert.ok(rewound.message.content.trim());
  } finally {
    await h.cleanup();
  }
});

test("unresolved handoff state is coalesced into the next lead turn", async () => {
  const h = await host("hang");
  try {
    const handoff = await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE, block: false });
    const [event] = await h.emit("before_agent_start", { systemPrompt: "base" });
    assert.ok(event?.message);
    assert.match(
      event.message.content,
      new RegExp(`Sidekick handoff ${handoff.details.handoff.id} is running`, "u"),
    );
    await h.command("cancel");
  } finally {
    await h.cleanup();
  }
});

test("first-edit reminder retries, persists across restart and reset, and rearms after rewind", async () => {
  const h = await host();
  try {
    await h.emit("before_agent_start", { systemPrompt: "base" });
    h.failReminderDelivery(true);
    await h.emit("tool_result", { toolName: "edit", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      0,
    );
    assert.match(h.notifications.at(-1)?.[0] ?? "", /reminder delivery failed/u);
    h.failReminderDelivery(false);
    await h.emit("tool_result", { toolName: "edit", isError: false });
    await h.emit("tool_result", { toolName: "write", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      1,
    );
    await h.emit("session_shutdown");
    await h.emit("session_start");
    await h.emit("tool_result", { toolName: "edit", isError: false });
    await h.command("reset --yes");
    await h.emit("tool_result", { toolName: "edit", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      1,
    );
    h.rewind();
    await h.emit("session_tree");
    await h.emit("tool_result", { toolName: "MultiEdit", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      2,
    );
  } finally {
    await h.cleanup();
  }
});

test("successful Sidekick admission suppresses the first-edit reminder", async () => {
  const h = await host();
  try {
    await h.emit("before_agent_start", { systemPrompt: "base" });
    await h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE });
    await h.emit("tool_result", { toolName: "edit", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      0,
    );
  } finally {
    await h.cleanup();
  }
});

test("failed Sidekick admission does not suppress the first-edit reminder", async () => {
  const h = await host("missing-tool");
  try {
    await h.emit("before_agent_start", { systemPrompt: "base" });
    await assert.rejects(h.call("sidekick", { message: SIDEKICK_TEST_MESSAGE }), /not delivered/u);
    await h.emit("tool_result", { toolName: "edit", isError: false });
    assert.equal(
      h.messages.filter((message) => message.customType === "pi-sidekick-reminder").length,
      1,
    );
  } finally {
    await h.cleanup();
  }
});
