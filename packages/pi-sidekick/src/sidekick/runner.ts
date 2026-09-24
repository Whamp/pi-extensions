import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Parse } from "typebox/value";
import type { SidekickConfig } from "../config.ts";
import { Outcome } from "../enums.ts";
import { errorMessage, hasErrorCode, normalizeError } from "../errors.ts";
import { SidekickStore } from "../store.ts";
import type { Handoff, Launch, RunningHandoff, SettledHandoff, Snapshot, Usage } from "../types.ts";
import { addUsage, zeroUsage } from "../types.ts";
import { PiRpc, resolveLaunch } from "./rpc.ts";
import type { RpcEvent } from "./rpc.ts";
import {
  assertSidekickChildSession,
  createSidekickChildSession,
  sidekickParentSessionDirectory,
} from "./session.ts";
import { SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA } from "./child-capability-observer.ts";
import type { ParentSessionManagerLike } from "./session.ts";

const MESSAGE_CONTENT_PART_SCHEMA = Type.Object(
  {
    type: Type.String(),
    text: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const MESSAGE_USAGE_SCHEMA = Type.Object(
  {
    input: Type.Optional(Type.Number()),
    output: Type.Optional(Type.Number()),
    cacheRead: Type.Optional(Type.Number()),
    cacheWrite: Type.Optional(Type.Number()),
    cost: Type.Optional(Type.Object({ total: Type.Optional(Type.Number()) })),
  },
  { additionalProperties: true },
);
const RPC_MESSAGE_SCHEMA = Type.Object(
  {
    role: Type.String(),
    stopReason: Type.Optional(Type.String()),
    errorMessage: Type.Optional(Type.String()),
    content: Type.Optional(Type.Array(MESSAGE_CONTENT_PART_SCHEMA)),
    usage: Type.Optional(MESSAGE_USAGE_SCHEMA),
  },
  { additionalProperties: true },
);
const RPC_STATE_SCHEMA = Type.Object(
  { model: Type.Object({ provider: Type.String(), id: Type.String() }) },
  { additionalProperties: true },
);
const SESSION_STATS_SCHEMA = Type.Object(
  {
    tokens: Type.Object({
      input: Type.Optional(Type.Number()),
      output: Type.Optional(Type.Number()),
      cacheRead: Type.Optional(Type.Number()),
      cacheWrite: Type.Optional(Type.Number()),
    }),
    cost: Type.Number(),
  },
  { additionalProperties: true },
);
type CapabilityHandshake = Static<typeof SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA>;
type RpcMessage = Static<typeof RPC_MESSAGE_SCHEMA>;
type SessionStats = Static<typeof SESSION_STATS_SCHEMA>;

const CHILD_EXTENSION_ENTRYPOINT = fileURLToPath(new URL("../../index.ts", import.meta.url));

/** Result of a message that reached the persistent Sidekick child. */
export interface AdmittedHandoffDispatch {
  status: "admitted";
  kind: "started" | "steered";
  handoff: Handoff;
  completion: Promise<SettledHandoff>;
}
/** Result of a message that was not delivered before the child settled or stopped. */
export interface NotDeliveredHandoffDispatch {
  status: "not-delivered";
  kind: "not-delivered";
  handoff: SettledHandoff;
  completion: Promise<SettledHandoff>;
  reason: string;
}
/** Result of one initial message or same-context steering message. */
export type HandoffDispatch = AdmittedHandoffDispatch | NotDeliveredHandoffDispatch;

/** Supplies the persisted epoch and process seam for one Sidekick runner. */
export interface RunnerOptions {
  store: SidekickStore;
  snapshot: Snapshot;
  config: SidekickConfig;
  trusted: boolean;
  /** Parent manager used to create and revalidate the epoch's child file. */
  parentSessionManager: ParentSessionManagerLike;
  launch?: Launch;
  rpcFactory?: (args: string[], env: NodeJS.ProcessEnv) => PiRpc;
}
interface Stop {
  outcome: Exclude<Outcome, Outcome.COMPLETED>;
  reason: string;
}
interface Active {
  settle: () => void;
  ready: Promise<boolean>;
  settled: boolean;
  stop?: Stop;
  aborting?: Promise<void>;
}

/** Rejects Sidekick messages that are blank or exceed the host's input bound. */
export function validateSidekickMessage(message: string): void {
  try {
    Parse(Type.String({ minLength: 1, maxLength: 30000 }), message);
  } catch (cause) {
    throw new Error("Sidekick message must contain 1–30000 characters.", {
      cause: normalizeError(cause),
    });
  }
  if (!message.trim()) {
    throw new Error("Sidekick message must not be blank.");
  }
}

function positiveNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}
function nonnegativeNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}
function usageOf(message: RpcMessage): Usage {
  return {
    input: positiveNumber(message.usage?.input),
    output: positiveNumber(message.usage?.output),
    cacheRead: positiveNumber(message.usage?.cacheRead),
    cacheWrite: positiveNumber(message.usage?.cacheWrite),
    cost: positiveNumber(message.usage?.cost?.total),
    turns: 0,
  };
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function readCapabilityHandshake(
  path: string,
  nonce: string,
  pid: number | undefined,
): Promise<string[]> {
  const deadline = Date.now() + 2000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(path)) {
    throw new Error("Sidekick capability admission timed out before the first message.");
  }
  const record: CapabilityHandshake = Parse(
    SIDEKICK_CAPABILITY_HANDSHAKE_SCHEMA,
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (record.nonce !== nonce || record.pid !== pid) {
    throw new Error(
      "Sidekick capability handshake nonce, PID, or tool list did not match the launched child.",
    );
  }
  return [...new Set(record.activeToolNames)].sort((left, right) => left.localeCompare(right));
}

/** Deep Sidekick lifecycle module with one persistent child and one latest handoff. */
export class SidekickRunner extends EventEmitter {
  readonly store: SidekickStore;
  readonly snapshot: Snapshot;
  config: SidekickConfig;
  private options: RunnerOptions;
  private worker?: PiRpc;
  private starting?: Promise<PiRpc>;
  private active?: Active;
  private completion?: Promise<SettledHandoff>;
  private closing?: Promise<void>;
  private disposed = false;

  constructor(options: RunnerOptions) {
    super();
    this.options = options;
    this.store = options.store;
    this.snapshot = options.snapshot;
    this.config = options.config;
  }
  /** Returns the latest persisted handoff without exposing mutable state. */
  get handoff(): Handoff | undefined {
    return this.snapshot.handoff ? structuredClone(this.snapshot.handoff) : undefined;
  }
  /** Reports whether the latest handoff is currently executing. */
  get running(): boolean {
    return this.snapshot.handoff?.status === "running";
  }
  /** Returns the native persistent child transcript path when materialized. */
  get sessionPath(): string | undefined {
    return this.snapshot.childSession?.sessionFile;
  }
  private persist(): void {
    this.store.save(this.snapshot);
    this.emit("change", this.handoff);
  }
  /** Admits a new message or steers the current handoff in place. */
  async dispatch(message: string): Promise<HandoffDispatch> {
    if (this.disposed) throw new Error("Sidekick runner has been closed.");
    validateSidekickMessage(message);
    if (!this.config.enabled) {
      throw new Error("Sidekick is off. The user must enable it with /sidekick on.");
    }
    if (!this.config.sidekick) {
      throw new Error("Choose a sidekick with /sidekick model provider/model-id.");
    }
    if (this.running) {
      return await this.dispatchSteer(message);
    }
    const handoff: RunningHandoff = {
      id: randomUUID(),
      message,
      status: "running",
      startedAt: new Date().toISOString(),
      report: "",
      usage: zeroUsage(),
    };
    const previous = this.snapshot.handoff;
    this.snapshot.handoff = handoff;
    try {
      this.persist();
    } catch (cause) {
      this.snapshot.handoff = previous;
      throw normalizeError(cause);
    }
    this.launchRun(handoff, message);
    const active = this.active;
    const completion = this.completion;
    if (!active || !completion) {
      throw new Error("Sidekick handoff failed to initialize its completion.");
    }
    const accepted = await active.ready;
    if (!accepted) {
      const terminal = await completion;
      return {
        status: "not-delivered",
        kind: "not-delivered",
        handoff: terminal,
        completion,
        reason: terminal.error ?? "Sidekick message was not admitted before the child stopped.",
      };
    }
    return {
      status: "admitted",
      kind: "started",
      handoff: structuredClone(this.snapshot.handoff ?? handoff),
      completion,
    };
  }
  private async dispatchSteer(message: string): Promise<HandoffDispatch> {
    const active = this.active;
    const completion = this.completion;
    const handoff = this.snapshot.handoff;
    if (!active || !completion || !handoff) {
      throw new Error("Sidekick is running without an active handoff.");
    }
    const accepted = await active.ready;
    if (!accepted) {
      const terminal = await completion;
      return {
        status: "not-delivered",
        kind: "not-delivered",
        handoff: terminal,
        completion,
        reason: terminal.error ?? "Sidekick message was not admitted before the child stopped.",
      };
    }
    if (!this.running || this.active !== active || active.stop || active.settled) {
      return await this.dispatchAfterSteerRace(active, completion, message);
    }
    const worker = this.worker;
    if (!worker?.alive) {
      throw new Error("Sidekick child is no longer running.");
    }
    try {
      await worker.request("steer", { message });
    } catch (cause) {
      if (active.settled || !this.running || this.active !== active) {
        return await this.dispatchAfterSteerRace(active, completion, message);
      }
      throw normalizeError(cause);
    }
    if (active.settled || !this.running || this.active !== active) {
      return await this.dispatchAfterSteerRace(active, completion, message);
    }
    return {
      status: "admitted",
      kind: "steered",
      handoff: structuredClone(this.snapshot.handoff ?? handoff),
      completion,
    };
  }
  private async dispatchAfterSteerRace(
    active: Active,
    completion: Promise<SettledHandoff>,
    message: string,
  ): Promise<HandoffDispatch> {
    const terminal = await completion;
    if (terminal.outcome !== Outcome.COMPLETED) {
      return {
        status: "not-delivered",
        kind: "not-delivered",
        handoff: terminal,
        completion,
        reason:
          terminal.error ??
          `Sidekick correction was not delivered before the child stopped (${terminal.outcome}).`,
      };
    }
    return await this.dispatch(message);
  }
  private launchRun(handoff: RunningHandoff, message: string): void {
    // execute() sets active synchronously before its first await.
    this.completion = this.execute(handoff, message);
    // Detached consumers must never create unhandled promise rejections.
    void this.completion.catch((cause) => this.emit("diagnostic", normalizeError(cause)));
  }
  /** Explicitly cancels the active handoff and returns its terminal view. */
  cancel(reason = "Cancelled by user."): Promise<SettledHandoff | undefined> {
    return this.stop(Outcome.CANCELLED, reason);
  }
  private async stop(
    outcome: Exclude<Outcome, Outcome.COMPLETED>,
    reason: string,
  ): Promise<SettledHandoff | undefined> {
    const active = this.active;
    if (!active) {
      const handoff = this.handoff;
      return handoff?.status === "settled" ? handoff : undefined;
    }
    if (!active.stop) active.stop = { outcome, reason };
    if (!active.aborting) {
      active.aborting = (async () => {
        const worker = this.worker;
        if (worker) await worker.abort();
        active.settle();
      })();
    }
    await active.aborting;
    if (this.completion) {
      return structuredClone(await this.completion);
    }
    const handoff = this.handoff;
    return handoff?.status === "settled" ? handoff : undefined;
  }
  private async ensureWorker(): Promise<PiRpc> {
    if (this.starting) return await this.starting;
    if (this.worker?.alive) return this.worker;
    this.starting = (async () => {
      if (this.worker) await this.worker.close();
      const frozenPrompt = this.snapshot.frozenSidekickPrompt;
      if (!frozenPrompt) {
        throw new Error(
          "Sidekick epoch has no frozen system prompt. Reset Sidekick before dispatching a message.",
        );
      }
      const model = frozenPrompt.model;
      const parentSessionManager = this.options.parentSessionManager;
      let childSession = this.snapshot.childSession;
      if (childSession) {
        assertSidekickChildSession(childSession, {
          parentId: this.snapshot.parentId,
          epoch: this.snapshot.epoch,
          admission: {
            sessionDir: sidekickParentSessionDirectory(parentSessionManager, this.snapshot.cwd),
            parentSessionFile: parentSessionManager.getSessionFile() || undefined,
          },
          cwd: this.snapshot.cwd,
        });
      } else {
        childSession = createSidekickChildSession(
          parentSessionManager,
          this.snapshot.cwd,
          this.snapshot.epoch,
        );
        this.snapshot.childSession = childSession;
        try {
          this.store.save(this.snapshot);
        } catch (cause) {
          this.snapshot.childSession = undefined;
          try {
            unlinkSync(childSession.sessionFile);
          } catch (cleanupError) {
            if (!hasErrorCode(cleanupError, "ENOENT")) {
              this.emit("diagnostic", normalizeError(cleanupError));
            }
          }
          throw normalizeError(cause);
        }
      }
      const sessionFile = childSession.sessionFile;
      const intendedTools = [...frozenPrompt.activeToolNames].sort((left, right) =>
        left.localeCompare(right),
      );
      const nonce = randomUUID();
      const handshakePath = `${this.store.epochDir(this.snapshot)}/capabilities-${nonce}.json`;
      try {
        unlinkSync(handshakePath);
      } catch (cause) {
        if (!hasErrorCode(cause, "ENOENT")) throw normalizeError(cause);
      }
      const args = [
        "--mode",
        "rpc",
        "--provider",
        model.provider,
        "--model",
        model.id,
        "--thinking",
        frozenPrompt.thinking,
        "--session",
        sessionFile,
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        this.options.trusted ? "--approve" : "--no-approve",
        "--tools",
        intendedTools.join(","),
        "--append-system-prompt",
        frozenPrompt.effectiveText,
      ];
      for (const path of frozenPrompt.sidekickExtensions) args.push("--extension", path);
      for (const path of frozenPrompt.sidekickSkills) args.push("--skill", path);
      args.push("--extension", CHILD_EXTENSION_ENTRYPOINT);
      const env = {
        PI_SIDEKICK_CAPABILITY_HANDSHAKE: handshakePath,
        PI_SIDEKICK_CAPABILITY_NONCE: nonce,
      };
      const worker =
        this.options.rpcFactory?.(args, env) ??
        new PiRpc({
          launch: this.options.launch ?? resolveLaunch(),
          args,
          cwd: this.snapshot.cwd,
          env,
        });
      this.worker = worker;
      try {
        const state = Parse(RPC_STATE_SCHEMA, await worker.start());
        const actual = state.model;
        if (actual.provider !== model.provider || actual.id !== model.id) {
          throw new Error(
            `Sidekick selected ${actual.provider}/${actual.id}, not the exact configured ${model.provider}/${model.id}. Check /sidekick model and Pi's model catalog.`,
          );
        }
        const admittedTools = await readCapabilityHandshake(handshakePath, nonce, worker.pid);
        if (!equalStrings(admittedTools, intendedTools)) {
          throw new Error(
            `Sidekick capability admission rejected active tools [${admittedTools.join(", ")}]; expected [${intendedTools.join(", ")}]. Missing or extra extension tools cannot silently change the frozen prompt.`,
          );
        }
        return worker;
      } catch (cause) {
        await worker.close();
        throw normalizeError(cause);
      } finally {
        try {
          unlinkSync(handshakePath);
        } catch (cause) {
          if (!hasErrorCode(cause, "ENOENT")) this.emit("diagnostic", normalizeError(cause));
        }
      }
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async execute(handoff: RunningHandoff, message: string): Promise<SettledHandoff> {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let readyResolve!: (accepted: boolean) => void;
    const ready = new Promise<boolean>((resolve) => {
      readyResolve = resolve;
    });
    const active: Active = {
      settle,
      ready,
      settled: false,
    };
    this.active = active;
    let worker: PiRpc | undefined;
    let finalStopReason: string | undefined;
    let failure: Error | undefined;
    let outcome: Outcome = Outcome.FAILED;
    let terminalError: string | undefined;
    let lastText = "";
    let sawAssistant = false;
    let baseline: Usage | undefined;
    let observed = zeroUsage();
    handoff.accounting = "partial";
    const handleEvent = (event: RpcEvent): void => {
      if (event.type === "message_end") {
        if (
          event.message?.role === "system" ||
          event.message?.role === "user" ||
          event.message?.role === "custom"
        ) {
          return;
        }
        const messageData: RpcMessage = Parse(RPC_MESSAGE_SCHEMA, event.message);
        if (messageData.role === "assistant") {
          sawAssistant = true;
          finalStopReason = messageData.stopReason;
          const parts = messageData.content ?? [];
          lastText = parts
            .filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("\n");
          handoff.report = lastText;
          if (finalStopReason === "error") {
            handoff.error = errorMessage(
              messageData.errorMessage ?? new Error("Sidekick model returned an error."),
            );
          } else {
            handoff.error = undefined;
          }
          const usage = usageOf(messageData);
          observed = addUsage(observed, usage);
          handoff.usage = addUsage(handoff.usage, usage);
          this.snapshot.totals = addUsage(this.snapshot.totals, usage);
          this.persist();
        }
      } else if (event.type === "turn_end") {
        handoff.usage.turns++;
        this.snapshot.totals.turns++;
        this.persist();
      } else if (event.type === "tool_execution_start") {
        this.emit("progress", {
          handoffId: handoff.id,
          tool: Parse(Type.String(), event.toolName),
        });
      } else if (event.type === "agent_settled") {
        active.settled = true;
        settle();
      }
      // agent_end is deliberately ignored: automatic retries/compaction may follow.
    };
    const onFailure = (cause: unknown): void => {
      failure = normalizeError(cause);
      active.settled = true;
      settle();
    };
    const onEvent = (event: RpcEvent): void => {
      try {
        handleEvent(event);
      } catch (cause) {
        failure = normalizeError(cause);
        active.stop ??= {
          outcome: Outcome.FAILED,
          reason: `Sidekick state/observer error: ${failure.message}`,
        };
        active.aborting ??= (async () => {
          try {
            await worker?.close();
          } finally {
            settle();
          }
        })();
        void active.aborting.catch(onFailure);
      }
    };
    const readAccounting = async (rpc: PiRpc): Promise<Usage | undefined> => {
      try {
        const stats: SessionStats = Parse(
          SESSION_STATS_SCHEMA,
          await rpc.request("get_session_stats", {}, 3000),
        );
        if (!Number.isFinite(stats.cost)) return undefined;
        return {
          input: nonnegativeNumber(stats.tokens.input),
          output: nonnegativeNumber(stats.tokens.output),
          cacheRead: nonnegativeNumber(stats.tokens.cacheRead),
          cacheWrite: nonnegativeNumber(stats.tokens.cacheWrite),
          cost: nonnegativeNumber(stats.cost),
          turns: 0,
        };
      } catch {
        return undefined;
      }
    };
    try {
      worker = await this.ensureWorker();
      if (active.stop) {
        await worker.close();
      } else {
        baseline = await readAccounting(worker);
        if (!active.stop) {
          worker.on("event", onEvent);
          worker.on("failure", onFailure);
          await worker.request("prompt", { message });
          this.emit("admitted", structuredClone(handoff));
          readyResolve(true);
          await settled;
          if (active.aborting) {
            await active.aborting;
          }
          const after = worker.alive && baseline ? await readAccounting(worker) : undefined;
          if (after && baseline) {
            const extra = zeroUsage();
            for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost"] as const) {
              extra[key] = Math.max(0, after[key] - baseline[key] - observed[key]);
            }
            handoff.usage = addUsage(handoff.usage, extra);
            this.snapshot.totals = addUsage(this.snapshot.totals, extra);
            handoff.accounting = "complete";
          }
        }
      }
      if (active.stop) {
        outcome = active.stop.outcome;
        terminalError = active.stop.reason;
      } else if (failure) {
        outcome = Outcome.FAILED;
        terminalError = failure.message;
      } else if (!sawAssistant || finalStopReason === "error" || finalStopReason === "aborted") {
        outcome = finalStopReason === "aborted" ? Outcome.CANCELLED : Outcome.FAILED;
        terminalError =
          handoff.error ?? "Sidekick settled without a successful assistant response.";
      } else if (finalStopReason !== "stop" || !lastText.trim()) {
        outcome = Outcome.FAILED;
        terminalError = "Sidekick did not produce a complete text report.";
      } else {
        outcome = Outcome.COMPLETED;
      }
    } catch (cause) {
      outcome = active.stop?.outcome ?? Outcome.FAILED;
      terminalError = active.stop?.reason ?? errorMessage(cause);
      if (worker) {
        await worker.close();
      } else if (this.worker) {
        await this.worker.close();
      }
    } finally {
      readyResolve(false);
      worker?.off("event", onEvent);
      worker?.off("failure", onFailure);
    }
    if (handoff.accounting !== "complete") {
      this.snapshot.accountingPartial = true;
    }
    const report =
      lastText || "No final report was produced. Inspect the working tree for partial changes.";
    let reportPath: string | undefined;
    let error = terminalError ?? handoff.error;
    try {
      reportPath = this.store.saveReport(this.snapshot, handoff.id, report);
    } catch (cause) {
      error = `${error ? `${error} ` : ""}Could not save report: ${errorMessage(cause)}`;
      outcome = Outcome.FAILED;
    }
    const terminalBase = {
      ...handoff,
      status: "settled" as const,
      outcome,
      finishedAt: new Date().toISOString(),
      report,
    };
    let terminal: SettledHandoff;
    if (error === undefined) {
      terminal = terminalBase;
    } else {
      terminal = { ...terminalBase, error };
    }
    if (reportPath !== undefined) {
      terminal = { ...terminal, reportPath };
    }
    this.snapshot.handoff = terminal;
    this.active = undefined;
    this.persist();
    this.emit("complete", structuredClone(terminal));
    return structuredClone(terminal);
  }
  /** Closes the child and persists interrupted state without replaying the message. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        this.disposed = true;
        try {
          await this.stop(
            Outcome.INTERRUPTED,
            "Sidekick session closed; inspect any partial changes before proceeding.",
          );
        } finally {
          try {
            if (this.worker) await this.worker.close();
          } finally {
            this.store.release();
          }
        }
      })();
    }
    return this.closing;
  }
}
