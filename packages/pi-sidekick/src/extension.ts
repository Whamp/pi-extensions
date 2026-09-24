import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type as SchemaType } from "typebox";
import type { Static, TObject, Type as TypeNamespace } from "typebox";
import { Check, Parse } from "typebox/value";
import { hasSidekickBrowserSkill } from "./browser-capability.ts";
import {
  agentDirectory,
  loadConfig,
  modelLabel,
  parseModel,
  validateConfig,
  type SidekickConfig,
} from "./config.ts";
import { LeadProfileMode, LeadReminderEventKind, Outcome } from "./enums.ts";
import { errorMessage, normalizeError } from "./errors.ts";
import { composePiLeadSystemPrompt, freezePiSidekickPrompt } from "./prompt-profiles/pi-prompts.ts";
import {
  reduceLeadReminderState,
  selectLeadPromptProfile,
  selectSidekickPromptProfile,
} from "./prompt-profiles/selectors.ts";
import type { LeadReminderEvent, LeadReminderState } from "./prompt-profiles/types.ts";
import {
  cleanDisplay,
  handoffAdmissionSummary,
  handoffSummary,
  handoffWaitWindowSummary,
} from "./prompts.ts";
import { SidekickStore, atomicJson } from "./store.ts";
import type { FrozenSidekickPrompt, Handoff, SettledHandoff, Snapshot } from "./types.ts";
import { SidekickRunner } from "./sidekick/runner.ts";
import type { HandoffDispatch } from "./sidekick/runner.ts";
import { isSidekickChildSession, sidekickParentSessionDirectory } from "./sidekick/session.ts";
import type { ParentSessionManagerLike } from "./sidekick/session.ts";

const DEFAULT_SIDEKICK_OBSERVATION_TIMEOUT_MS = 30 * 1000;

interface SidekickUi {
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(key: string, value: string | undefined): void;
  select(title: string, choices: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
}
interface SidekickSessionManager extends ParentSessionManagerLike {
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}
interface SidekickModelReference {
  provider: string;
  id: string;
}
interface SidekickModelRegistry {
  getAvailable(): SidekickModelReference[];
  find(provider: string, id: string): SidekickModelReference | undefined;
}
interface SidekickContext {
  cwd: string;
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  model: SidekickModelReference | undefined;
  ui: SidekickUi;
  sessionManager: SidekickSessionManager;
  modelRegistry: SidekickModelRegistry;
  isProjectTrusted(): boolean;
  signal: AbortSignal | undefined;
}
interface SidekickEvent {
  type: string;
}
interface SidekickBeforeAgentStartEvent extends SidekickEvent {
  systemPrompt: string;
}
interface SidekickToolResultEvent extends SidekickEvent {
  toolName: string;
  isError: boolean;
}
interface SidekickCommand {
  description?: string;
  handler(args: string, ctx: SidekickContext): Promise<void>;
}
interface SidekickTextContent {
  type: "text";
  text: string;
}
interface SidekickProgressDetails {
  kind: "progress";
}
interface SettledCompactHandoff extends CompactHandoff {
  status: "settled";
  outcome: SettledHandoff["outcome"];
}
interface SidekickWaitCompletedDetails {
  kind: "wait_completed";
  handoff: SettledCompactHandoff;
  sessionFile?: string;
}
interface SidekickWaitWindowDetails {
  kind: "window_elapsed";
  handoffId: string;
  timeoutMs: number;
}
type SidekickWaitToolDetails = SidekickWaitCompletedDetails | SidekickWaitWindowDetails;
type SidekickToolDetails = SidekickProgressDetails | HandoffToolDetails | SidekickWaitToolDetails;
interface SidekickToolUpdate {
  content: SidekickTextContent[];
  details: SidekickToolDetails;
}
interface SidekickToolResult {
  content: SidekickTextContent[];
  details: HandoffToolDetails | SidekickWaitToolDetails;
}
interface SidekickToolDefinition<ParameterSchema extends TObject> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: ParameterSchema;
  executionMode?: "sequential" | "parallel";
  execute(
    toolCallId: string,
    params: Static<ParameterSchema>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: SidekickToolUpdate) => void) | undefined,
    ctx: SidekickContext,
  ): Promise<SidekickToolResult>;
}
interface SidekickInjectedMessage {
  customType: string;
  content: string;
  display: boolean;
}
interface SidekickMessageDeliveryOptions {
  triggerTurn?: boolean;
  deliverAs?: "steer" | "followUp" | "nextTurn";
}
interface SidekickBeforeAgentStartResult {
  systemPrompt: string;
  message?: SidekickInjectedMessage;
}
interface SidekickLifecycleEventHandler {
  (event: SidekickEvent, ctx: SidekickContext): Promise<void> | void;
}
interface SidekickBeforeAgentStartEventHandler {
  (
    event: SidekickBeforeAgentStartEvent,
    ctx: SidekickContext,
  ):
    | Promise<SidekickBeforeAgentStartResult | undefined>
    | SidekickBeforeAgentStartResult
    | undefined;
}
interface SidekickToolResultEventHandler {
  (event: SidekickToolResultEvent, ctx: SidekickContext): Promise<void> | void;
}
interface SidekickExtensionApi {
  on(
    event: "session_start" | "session_shutdown" | "session_tree" | "agent_settled",
    handler: SidekickLifecycleEventHandler,
  ): void;
  on(event: "before_agent_start", handler: SidekickBeforeAgentStartEventHandler): void;
  on(event: "tool_result", handler: SidekickToolResultEventHandler): void;
  registerCommand(name: string, command: SidekickCommand): void;
  registerTool<ParameterSchema extends TObject>(
    tool: SidekickToolDefinition<ParameterSchema>,
  ): void;
  appendEntry<EntryType extends keyof SidekickParentLedgerData>(
    customType: EntryType,
    data: SidekickParentLedgerData[EntryType],
  ): void;
  sendMessage(message: SidekickInjectedMessage, options?: SidekickMessageDeliveryOptions): void;
  getActiveTools(): string[];
}
interface SidekickTestHooks {
  defaultObservationTimeoutMs?: number;
  onCompletionRegistrySize?(size: number): void;
  onObservationTimeoutScheduled?: (timeoutMs: number) => void;
  onPassiveWaitClaimCount?(count: number): void;
}
interface RetryableCompletion {
  parentKey: string;
  completion: Promise<SettledHandoff>;
  childSessionPath?: string;
}
interface SidekickWaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onTimeoutScheduled?: (timeoutMs: number) => void;
}
type SidekickWaitObservation =
  | { kind: "settled"; handoff: SettledHandoff }
  | { kind: "window_elapsed" };
interface SidekickPassiveObservation {
  kind: "observing";
  handoffId: string;
  completion: Promise<SettledHandoff>;
  childSessionPath?: string;
}
interface SidekickSettledReplay {
  kind: "settled_replay";
  handoff: SettledHandoff;
  childSessionPath?: string;
}
type SidekickWaitLease = SidekickPassiveObservation | SidekickSettledReplay;
interface ActiveSession {
  key: string;
  ctx: SidekickContext;
  runner: SidekickRunner;
  live: boolean;
  checkpointSignature: string;
  reminderState: LeadReminderState;
  notificationRequested: Set<string>;
  notificationPending: Set<string>;
  notificationDelivered: Set<string>;
  notificationSuppressed: Set<string>;
  blockingWaiters: Set<string>;
  completions: Map<string, Promise<SettledHandoff>>;
  completionSessionPaths: Map<string, string | undefined>;
}
const LEAD_REMINDER_EVENT_SCHEMA = SchemaType.Union([
  SchemaType.Object({ kind: SchemaType.Literal(LeadReminderEventKind.DELEGATION_ADMITTED) }),
  SchemaType.Object({
    kind: SchemaType.Literal(LeadReminderEventKind.LEAD_TURN_STARTED),
    broadExploration: SchemaType.Boolean(),
    renderedBrowser: SchemaType.Boolean(),
  }),
  SchemaType.Object({
    kind: SchemaType.Literal(LeadReminderEventKind.LEAD_MUTATOR_OBSERVED),
    toolName: SchemaType.String(),
    broadExploration: SchemaType.Boolean(),
    renderedBrowser: SchemaType.Boolean(),
  }),
]);
const REMINDER_LEDGER_DATA_SCHEMA = SchemaType.Object({ event: LEAD_REMINDER_EVENT_SCHEMA });
const CHILD_LINK_LEDGER_DATA_SCHEMA = SchemaType.Object(
  {
    handoffId: SchemaType.String({ minLength: 1 }),
    epoch: SchemaType.String({ minLength: 1 }),
    childSession: SchemaType.Optional(SchemaType.String({ minLength: 1 })),
    review: SchemaType.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const COMPLETION_LEDGER_DATA_SCHEMA = SchemaType.Object(
  {
    handoffId: SchemaType.String({ minLength: 1 }),
    outcome: SchemaType.Union([
      SchemaType.Literal(Outcome.COMPLETED),
      SchemaType.Literal(Outcome.FAILED),
      SchemaType.Literal(Outcome.CANCELLED),
      SchemaType.Literal(Outcome.INTERRUPTED),
    ]),
    epoch: SchemaType.String({ minLength: 1 }),
    childSession: SchemaType.Optional(SchemaType.String({ minLength: 1 })),
    reportPath: SchemaType.Optional(SchemaType.String({ minLength: 1 })),
    review: SchemaType.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const CHECKPOINT_LEDGER_DATA_SCHEMA = SchemaType.Object(
  {
    epoch: SchemaType.String({ minLength: 1 }),
    handoffId: SchemaType.Optional(SchemaType.String({ minLength: 1 })),
    status: SchemaType.Optional(
      SchemaType.Union([SchemaType.Literal("running"), SchemaType.Literal("settled")]),
    ),
    outcome: SchemaType.Optional(
      SchemaType.Union([
        SchemaType.Literal(Outcome.COMPLETED),
        SchemaType.Literal(Outcome.FAILED),
        SchemaType.Literal(Outcome.CANCELLED),
        SchemaType.Literal(Outcome.INTERRUPTED),
      ]),
    ),
    signature: SchemaType.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
type ReminderLedgerData = Static<typeof REMINDER_LEDGER_DATA_SCHEMA>;
type ChildLinkLedgerData = Static<typeof CHILD_LINK_LEDGER_DATA_SCHEMA>;
type CompletionLedgerData = Static<typeof COMPLETION_LEDGER_DATA_SCHEMA>;
type CheckpointLedgerData = Static<typeof CHECKPOINT_LEDGER_DATA_SCHEMA>;
interface SidekickParentLedgerData {
  "pi-sidekick-reminder-event": ReminderLedgerData;
  "pi-sidekick-child-link": ChildLinkLedgerData;
  "pi-sidekick-completion": CompletionLedgerData;
  "pi-sidekick-checkpoint": CheckpointLedgerData;
}
type SessionBranch = ReturnType<SidekickSessionManager["getBranch"]>;

const HELP = `pi-sidekick — persistent lead + sidekick
/sidekick model [provider/model-id]     Choose an exact model or open the picker
/sidekick thinking off|minimal|low|medium|high|xhigh|max  Set the sidekick thinking level
/sidekick on                          Enable delegation for this session
/sidekick off                         Stop execution and disable Sidekick
/sidekick status                      Show pairing, handoff, usage, and file locations
The model-facing sidekick_wait tool observes one exact handoff without steering it.
/sidekick cancel                      Stop the Sidekick; keep partial edits for review
/sidekick reset [--yes]                Start fresh Sidekick context (does not undo edits)
/sidekick lead auto|standard|strict   Select the lead policy
/sidekick broad-exploration on|off    Toggle delegated fan-out search guidance
/sidekick rendered-browser on|off     Toggle lead-owned rendered-browser guidance
/sidekick file-strategy builtin-first|shell-first
                                      Choose the Sidekick file strategy
/sidekick save                        Save current settings to ~/.pi/agent/sidekick.json
Use Pi's /model to choose the lead. Global config honors PI_CODING_AGENT_DIR.
The Sidekick child runs locally with your permissions. Parent approval extensions are NOT inherited.`;

/** Compact terminal or admission metadata returned by Sidekick. */
export interface CompactHandoff {
  id: string;
  status: Handoff["status"];
  outcome?: SettledHandoff["outcome"];
  reportPath?: string;
  turns: number;
  cost: number;
  accounting?: SettledHandoff["accounting"];
}
/** Compact metadata returned by the model-facing Sidekick tool. */
export interface HandoffToolDetails {
  kind: "started" | "steered";
  handoff: CompactHandoff;
  sessionFile?: string;
}

function compactHandoff(handoff: Handoff): CompactHandoff {
  const compact: CompactHandoff = {
    id: handoff.id,
    status: handoff.status,
    turns: handoff.usage.turns,
    cost: handoff.usage.cost,
    accounting: handoff.accounting,
  };
  if (handoff.status === "settled") {
    compact.outcome = handoff.outcome;
    if (handoff.reportPath !== undefined) {
      compact.reportPath = handoff.reportPath;
    }
  }
  return compact;
}

function compactSettledHandoff(handoff: SettledHandoff): SettledCompactHandoff {
  return {
    ...compactHandoff(handoff),
    status: "settled",
    outcome: handoff.outcome,
  };
}

function sidekickProgressResult(text: string): SidekickToolUpdate {
  return {
    content: [{ type: "text", text }],
    details: { kind: "progress" },
  };
}

function sidekickHandoffResult(text: string, details: HandoffToolDetails): SidekickToolResult {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function sidekickWaitResult(text: string, details: SidekickWaitToolDetails): SidekickToolResult {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function sidekickWaitWindowDetails(
  handoffId: string,
  timeoutMs: number,
): SidekickWaitWindowDetails {
  return { kind: "window_elapsed", handoffId, timeoutMs };
}

function freshReminderState(): LeadReminderState {
  return { delivered: [], delegationAdmitted: false };
}

function restoreReminderState(branch: SessionBranch): LeadReminderState {
  let state = freshReminderState();
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== "pi-sidekick-reminder-event") {
      continue;
    }
    const data: ReminderLedgerData = Parse(REMINDER_LEDGER_DATA_SCHEMA, entry.data);
    state = reduceLeadReminderState(state, data.event).nextState;
  }
  return state;
}

function sameFrozenPrompt(left: FrozenSidekickPrompt, right: FrozenSidekickPrompt): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function desiredSidekickPrompt(config: SidekickConfig): FrozenSidekickPrompt | undefined {
  if (!config.sidekick) {
    return undefined;
  }
  return freezePiSidekickPrompt(
    selectSidekickPromptProfile({
      activeToolNames: config.tools,
      preferExec: config.sidekickPreferExec,
      browserAvailable: hasSidekickBrowserSkill(config.sidekickSkills),
    }),
    config,
  );
}

function hasUnresolvedHandoff(snapshot: Snapshot): boolean {
  return snapshot.handoff?.status === "running";
}

function sidekickEpochNeedsRefresh(snapshot: Snapshot, config: SidekickConfig): boolean {
  const desiredPrompt = desiredSidekickPrompt(config);
  return Boolean(
    desiredPrompt &&
    (!snapshot.frozenSidekickPrompt ||
      !sameFrozenPrompt(snapshot.frozenSidekickPrompt, desiredPrompt)),
  );
}

function assertNotAborted(operation: string, signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(`${operation} was cancelled before starting.`);
  }
}

/** Observes one retained completion for a bounded window without stopping the worker. */
async function observeSidekickCompletion(
  completion: Promise<SettledHandoff>,
  options: SidekickWaitOptions,
): Promise<SidekickWaitObservation> {
  const { signal, timeoutMs, onTimeoutScheduled } = options;
  assertNotAborted("Sidekick wait", signal);
  return await new Promise<SidekickWaitObservation>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    };
    const resolveObservation = (observation: SidekickWaitObservation): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(observation);
    };
    const rejectObservation = (cause: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(normalizeError(cause));
    };
    const onAbort = (): void => {
      rejectObservation(new Error("Sidekick wait was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      onTimeoutScheduled?.(timeoutMs);
      timer = setTimeout(() => resolveObservation({ kind: "window_elapsed" }), timeoutMs);
    }
    void completion.then(
      (handoff) => resolveObservation({ kind: "settled", handoff }),
      rejectObservation,
    );
    if (signal?.aborted) {
      onAbort();
    }
  });
}

/** Detaches an admission waiter while preserving the dispatch promise for notification. */
async function waitForSidekickAdmission(
  dispatch: Promise<HandoffDispatch>,
  signal?: AbortSignal,
): Promise<HandoffDispatch> {
  assertNotAborted("Sidekick dispatch", signal);
  if (!signal) {
    return await dispatch;
  }
  return await new Promise<HandoffDispatch>((resolve, reject) => {
    let settled = false;
    const detach = (): void => signal.removeEventListener("abort", onAbort);
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      detach();
      reject(new Error("Sidekick dispatch was cancelled."));
    };
    const resolveDispatch = (value: HandoffDispatch): void => {
      if (settled) {
        return;
      }
      settled = true;
      detach();
      resolve(value);
    };
    const rejectDispatch = (cause: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      detach();
      reject(normalizeError(cause));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void dispatch.then(resolveDispatch, rejectDispatch);
    if (signal.aborted) {
      onAbort();
    }
  });
}

/** TypeBox is injected so all host logic can be tested without installing Pi. */
export function registerSidekick(
  pi: SidekickExtensionApi,
  Type: typeof TypeNamespace,
  testHooks?: SidekickTestHooks,
): void {
  let current: ActiveSession | undefined;
  let initializing: Promise<ActiveSession> | undefined;
  let blockedChildSessionKey: string | undefined;
  let generation = 0;
  let retryableCompletions = new Map<string, RetryableCompletion>();
  const defaultObservationTimeoutMs =
    testHooks?.defaultObservationTimeoutMs ?? DEFAULT_SIDEKICK_OBSERVATION_TIMEOUT_MS;

  function notify(
    ctx: SidekickContext,
    message: string,
    level: "info" | "warning" | "error" = "info",
  ): void {
    ctx.ui.notify(cleanDisplay(message), level);
  }
  function notifySafely(
    ctx: SidekickContext,
    message: string,
    level: "info" | "warning" | "error" = "info",
  ): void {
    try {
      notify(ctx, message, level);
    } catch {
      // Diagnostics must not escape observer, promise-rejection, or shutdown paths.
    }
  }
  function reportExtensionListenerFailure(
    active: ActiveSession,
    operation: string,
    cause: unknown,
  ): void {
    if (active.live && current === active) {
      notifySafely(active.ctx, `Sidekick ${operation} failed: ${errorMessage(cause)}`, "error");
    }
  }
  async function send(text: string, triggerTurn = false): Promise<boolean> {
    try {
      await Promise.resolve(
        pi.sendMessage(
          { customType: "pi-sidekick", content: text, display: true },
          { triggerTurn, deliverAs: "followUp" },
        ),
      );
      return true;
    } catch (cause) {
      if (current?.live) {
        notifySafely(
          current.ctx,
          `Sidekick message delivery failed: ${errorMessage(cause)}`,
          "error",
        );
      }
      return false;
    }
  }
  async function sendHiddenReminder(text: string): Promise<void> {
    await Promise.resolve(
      pi.sendMessage(
        { customType: "pi-sidekick-reminder", content: text, display: false },
        { triggerTurn: false, deliverAs: "steer" },
      ),
    );
  }
  function hasParentLedgerEntry(
    active: ActiveSession,
    customType: "pi-sidekick-child-link" | "pi-sidekick-completion",
    handoffId: string,
  ): boolean {
    const schema =
      customType === "pi-sidekick-child-link"
        ? CHILD_LINK_LEDGER_DATA_SCHEMA
        : COMPLETION_LEDGER_DATA_SCHEMA;
    return active.ctx.sessionManager.getBranch().some((entry) => {
      if (entry.type !== "custom" || entry.customType !== customType) {
        return false;
      }
      return Check(schema, entry.data) && entry.data.handoffId === handoffId;
    });
  }
  function appendChildLink(active: ActiveSession, handoff: Handoff): void {
    if (hasParentLedgerEntry(active, "pi-sidekick-child-link", handoff.id)) {
      return;
    }
    pi.appendEntry("pi-sidekick-child-link", {
      handoffId: handoff.id,
      epoch: active.runner.snapshot.epoch,
      childSession: active.runner.sessionPath,
      review:
        "The child transcript is evidence only; independently inspect actual changes and checks.",
    });
  }
  function appendCompletion(active: ActiveSession, handoff: Handoff): void {
    if (
      handoff.status !== "settled" ||
      hasParentLedgerEntry(active, "pi-sidekick-completion", handoff.id)
    ) {
      return;
    }
    pi.appendEntry("pi-sidekick-completion", {
      handoffId: handoff.id,
      outcome: handoff.outcome,
      epoch: active.runner.snapshot.epoch,
      childSession: active.runner.sessionPath,
      reportPath: handoff.reportPath,
      review:
        "UNTRUSTED REPORT: inspect the actual changes and run relevant checks before claiming success or correcting this handoff.",
    });
  }
  function commitReminderEvent(active: ActiveSession, event: LeadReminderEvent): void {
    const transition = reduceLeadReminderState(active.reminderState, event);
    if (JSON.stringify(transition.nextState) === JSON.stringify(active.reminderState)) {
      return;
    }
    pi.appendEntry("pi-sidekick-reminder-event", { event });
    active.reminderState = transition.nextState;
  }
  function update(active: ActiveSession): void {
    if (!active.live || current !== active) {
      return;
    }
    const runner = active.runner;
    const handoff = runner.handoff;
    const state = !runner.config.enabled
      ? "off"
      : handoff?.status === "running"
        ? "working"
        : handoff
          ? "settled"
          : "ready";
    active.ctx.ui.setStatus(
      "pi-sidekick",
      cleanDisplay(
        `Sidekick ${state} · ${modelLabel(runner.config.sidekick)} · sidekick $${runner.snapshot.totals.cost.toFixed(3)}`,
      ),
    );
    const signature = JSON.stringify([
      runner.snapshot.epoch,
      handoff?.id,
      handoff?.status,
      handoff?.status === "settled" ? handoff.outcome : undefined,
      runner.config.enabled,
      modelLabel(runner.config.sidekick),
    ]);
    if (signature !== active.checkpointSignature) {
      const checkpointData = {
        epoch: runner.snapshot.epoch,
        handoffId: handoff?.id,
        status: handoff?.status,
        outcome: handoff?.status === "settled" ? handoff.outcome : undefined,
        signature,
      };
      const hasCheckpoint = active.ctx.sessionManager.getBranch().some((entry) => {
        if (entry.type !== "custom" || entry.customType !== "pi-sidekick-checkpoint") {
          return false;
        }
        return (
          Check(CHECKPOINT_LEDGER_DATA_SCHEMA, entry.data) && entry.data.signature === signature
        );
      });
      if (!hasCheckpoint) {
        pi.appendEntry("pi-sidekick-checkpoint", checkpointData);
      }
      runner.snapshot.checkpoint = active.ctx.sessionManager.getLeafId() ?? undefined;
      runner.store.save(runner.snapshot);
      active.checkpointSignature = signature;
    }
  }
  function forgetCompletion(active: ActiveSession, handoffId: string): void {
    active.completions.delete(handoffId);
    active.completionSessionPaths.delete(handoffId);
    testHooks?.onCompletionRegistrySize?.(active.completions.size);
  }
  function claimSidekickWait(active: ActiveSession, handoffId: string): SidekickWaitLease {
    if (active.notificationPending.has(handoffId)) {
      throw new Error(
        `Sidekick wait target ${handoffId} is already owned by an in-progress notification delivery.`,
      );
    }
    if (active.blockingWaiters.has(handoffId)) {
      throw new Error(`Sidekick wait target ${handoffId} is already being observed.`);
    }
    const completion = active.completions.get(handoffId);
    if (completion) {
      active.blockingWaiters.add(handoffId);
      testHooks?.onPassiveWaitClaimCount?.(active.blockingWaiters.size);
      return {
        kind: "observing",
        handoffId,
        completion,
        childSessionPath: active.completionSessionPaths.get(handoffId),
      };
    }
    const handoff = active.runner.handoff;
    if (handoff?.id === handoffId && handoff.status === "settled") {
      return {
        kind: "settled_replay",
        handoff,
        childSessionPath: active.runner.sessionPath,
      };
    }
    throw new Error(
      `Sidekick wait target unavailable: ${handoffId}. Only a retained current completion or the latest settled handoff can be observed.`,
    );
  }
  function releaseSidekickWait(
    active: ActiveSession,
    observation: SidekickPassiveObservation,
    delivered: boolean,
  ): void {
    active.blockingWaiters.delete(observation.handoffId);
    testHooks?.onPassiveWaitClaimCount?.(active.blockingWaiters.size);
    if (delivered) {
      active.notificationDelivered.add(observation.handoffId);
      forgetCompletion(active, observation.handoffId);
      return;
    }
    if (
      active.notificationRequested.has(observation.handoffId) &&
      !active.notificationSuppressed.has(observation.handoffId) &&
      !active.notificationDelivered.has(observation.handoffId)
    ) {
      const completion = active.completions.get(observation.handoffId);
      if (completion) {
        retryCompletionNotification(
          active,
          observation.handoffId,
          completion,
          observation.childSessionPath,
        );
      }
    }
  }
  function suppressPendingCompletionNotifications(active: ActiveSession): void {
    for (const handoffId of active.notificationRequested) {
      active.notificationSuppressed.add(handoffId);
      forgetCompletion(active, handoffId);
    }
  }
  function captureRetryableCompletionNotifications(active: ActiveSession): void {
    for (const handoffId of active.notificationRequested) {
      const completion = active.completions.get(handoffId);
      if (
        completion &&
        !active.notificationDelivered.has(handoffId) &&
        !active.notificationSuppressed.has(handoffId)
      ) {
        retryableCompletions.set(handoffId, {
          parentKey: active.key,
          completion,
          childSessionPath: active.completionSessionPaths.get(handoffId),
        });
      }
    }
    active.completions.clear();
    active.completionSessionPaths.clear();
    testHooks?.onCompletionRegistrySize?.(active.completions.size);
  }
  function restoreRetryableCompletionNotifications(active: ActiveSession): void {
    if (!active.runner.config.enabled || !active.runner.config.sidekick) {
      retryableCompletions.clear();
      return;
    }
    const pending = retryableCompletions;
    retryableCompletions = new Map();
    for (const [handoffId, retryable] of pending) {
      if (retryable.parentKey === active.key) {
        requestCompletionNotification(
          active,
          handoffId,
          retryable.completion,
          retryable.childSessionPath,
        );
      }
    }
  }

  async function deliverCompletionNotification(
    active: ActiveSession,
    handoff: Handoff,
    childSessionPath: string | undefined,
  ): Promise<void> {
    if (!active.live || current !== active) {
      return;
    }
    if (!active.runner.config.enabled || handoff.status !== "settled") {
      forgetCompletion(active, handoff.id);
      return;
    }
    if (
      active.notificationDelivered.has(handoff.id) ||
      active.notificationSuppressed.has(handoff.id)
    ) {
      forgetCompletion(active, handoff.id);
      return;
    }
    if (active.notificationPending.has(handoff.id) || active.blockingWaiters.has(handoff.id)) {
      return;
    }
    if (handoff.outcome === Outcome.CANCELLED || handoff.outcome === Outcome.INTERRUPTED) {
      forgetCompletion(active, handoff.id);
      return;
    }
    active.notificationPending.add(handoff.id);
    try {
      if (await send(handoffSummary(handoff, childSessionPath), true)) {
        active.notificationDelivered.add(handoff.id);
        forgetCompletion(active, handoff.id);
      }
    } finally {
      active.notificationPending.delete(handoff.id);
    }
  }
  function requestCompletionNotification(
    active: ActiveSession,
    handoffId: string,
    completion: Promise<SettledHandoff>,
    childSessionPath = active.runner.sessionPath,
  ): void {
    if (
      active.notificationDelivered.has(handoffId) ||
      active.notificationSuppressed.has(handoffId)
    ) {
      forgetCompletion(active, handoffId);
      return;
    }
    active.notificationRequested.add(handoffId);
    active.completions.set(handoffId, completion);
    active.completionSessionPaths.set(handoffId, childSessionPath);
    testHooks?.onCompletionRegistrySize?.(active.completions.size);
    void completion.then(
      (handoff) => {
        if (!active.blockingWaiters.has(handoff.id)) {
          void deliverCompletionNotification(active, handoff, childSessionPath);
        }
      },
      (cause) => {
        forgetCompletion(active, handoffId);
        if (active.live) {
          notifySafely(
            active.ctx,
            `Sidekick handoff failed before completion: ${errorMessage(cause)}`,
            "error",
          );
        }
      },
    );
  }
  function retryCompletionNotification(
    active: ActiveSession,
    handoffId: string,
    completion: Promise<SettledHandoff>,
    childSessionPath = active.completionSessionPaths.get(handoffId),
  ): void {
    void completion.then(
      (handoff) => deliverCompletionNotification(active, handoff, childSessionPath),
      (cause) => {
        forgetCompletion(active, handoffId);
        notifySafely(
          active.ctx,
          `Sidekick handoff failed before completion: ${errorMessage(cause)}`,
          "error",
        );
      },
    );
  }
  function retryCompletionNotifications(active: ActiveSession): void {
    for (const handoffId of active.notificationRequested) {
      const completion = active.completions.get(handoffId);
      if (
        completion &&
        !active.blockingWaiters.has(handoffId) &&
        !active.notificationSuppressed.has(handoffId)
      ) {
        retryCompletionNotification(active, handoffId, completion);
      }
    }
  }
  async function dispose(preserveRetryable = false): Promise<void> {
    generation++;
    const active = current;
    if (!active) {
      if (!preserveRetryable) {
        retryableCompletions.clear();
      }
      return;
    }
    if (preserveRetryable) {
      captureRetryableCompletionNotifications(active);
    } else {
      retryableCompletions.clear();
      suppressPendingCompletionNotifications(active);
    }
    active.live = false;
    try {
      active.ctx.ui.setStatus("pi-sidekick", undefined);
    } catch (cause) {
      notifySafely(
        active.ctx,
        `Sidekick shutdown status update failed: ${errorMessage(cause)}`,
        "error",
      );
    }
    try {
      await active.runner.close();
    } finally {
      current = undefined;
    }
  }
  async function disableMarkedChildSession(ctx: SidekickContext): Promise<boolean> {
    const key = `${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`;
    if (!isSidekickChildSession(ctx.sessionManager)) {
      if (blockedChildSessionKey === key) {
        blockedChildSessionKey = undefined;
        ctx.ui.setStatus("pi-sidekick", undefined);
      }
      return false;
    }
    if (current) {
      await dispose();
    }
    if (blockedChildSessionKey !== key) {
      blockedChildSessionKey = key;
      notify(
        ctx,
        "Marked Sidekick child session detected without PI_SIDEKICK_CHILD=1; Sidekick is disabled for this session.",
        "warning",
      );
    }
    ctx.ui.setStatus("pi-sidekick", "Sidekick disabled (marked child session)");
    return true;
  }
  async function ensure(
    ctx: SidekickContext,
    reset = false,
    preserveRetryable = false,
  ): Promise<ActiveSession> {
    if (await disableMarkedChildSession(ctx)) {
      throw new Error("Sidekick operations are disabled in a marked child session.");
    }
    const key = `${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`;
    if (current?.key === key && !reset) {
      current.ctx = ctx;
      return current;
    }
    if (initializing) {
      await Promise.allSettled([initializing]);
      return ensure(ctx, reset, preserveRetryable);
    }
    initializing = (async () => {
      await dispose(preserveRetryable);
      const token = generation;
      const dir = agentDirectory();
      const store = new SidekickStore(dir, ctx.cwd, ctx.sessionManager.getSessionId(), {
        sessionDir: sidekickParentSessionDirectory(ctx.sessionManager, ctx.cwd),
        parentSessionFile: ctx.sessionManager.getSessionFile() || undefined,
      });
      store.acquire();
      let initializingActive: ActiveSession | undefined;
      try {
        let snapshot = store.load();
        const branch = ctx.sessionManager.getBranch();
        const wrongBranch =
          !!snapshot.checkpoint && !branch.some((entry) => entry.id === snapshot.checkpoint);
        const startFresh = (): void => {
          atomicJson(join(store.epochDir(snapshot), `archived-${randomUUID()}.json`), snapshot);
          const old = snapshot;
          snapshot = store.fresh();
          snapshot.configOverrides = structuredClone(old.configOverrides);
          snapshot.totals = old.totals;
          snapshot.accountingPartial = old.accountingPartial;
        };
        if (reset || wrongBranch) {
          startFresh();
          if (wrongBranch) {
            notify(
              ctx,
              "Sidekick context reset: the parent session is on a different branch.",
              "warning",
            );
          }
        }
        const config = loadConfig(ctx.cwd, ctx.isProjectTrusted(), dir, snapshot.configOverrides);
        const desiredPrompt = desiredSidekickPrompt(config);
        if (!snapshot.frozenSidekickPrompt && desiredPrompt) {
          snapshot.frozenSidekickPrompt = desiredPrompt;
        } else if (
          snapshot.frozenSidekickPrompt &&
          desiredPrompt &&
          !sameFrozenPrompt(snapshot.frozenSidekickPrompt, desiredPrompt)
        ) {
          if (hasUnresolvedHandoff(snapshot)) {
            notify(
              ctx,
              "Sidekick configuration changed, but the running handoff retains its frozen epoch. Wait for it to settle before starting with the new configuration.",
              "warning",
            );
          } else {
            startFresh();
            snapshot.frozenSidekickPrompt = desiredPrompt;
          }
        }
        store.save(snapshot);
        if (token !== generation) {
          throw new Error("Sidekick initialization superseded by a session change.");
        }
        const runner = new SidekickRunner({
          store,
          snapshot,
          config,
          trusted: ctx.isProjectTrusted(),
          parentSessionManager: ctx.sessionManager,
        });
        const active: ActiveSession = {
          key,
          ctx,
          runner,
          live: true,
          checkpointSignature: "",
          reminderState: restoreReminderState(branch),
          notificationRequested: new Set(),
          notificationPending: new Set(),
          notificationDelivered: new Set(),
          notificationSuppressed: new Set(),
          blockingWaiters: new Set(),
          completions: new Map(),
          completionSessionPaths: new Map(),
        };
        initializingActive = active;
        current = active;
        runner.on("change", () => {
          try {
            update(active);
          } catch (cause) {
            reportExtensionListenerFailure(active, "checkpoint update", cause);
          }
        });
        runner.on("admitted", (handoff: Handoff) => {
          if (!active.live || current !== active) {
            return;
          }
          try {
            appendChildLink(active, handoff);
            commitReminderEvent(active, { kind: LeadReminderEventKind.DELEGATION_ADMITTED });
          } catch (cause) {
            reportExtensionListenerFailure(active, "admission ledger update", cause);
          }
        });
        runner.on("diagnostic", (cause) => {
          if (active.live && current === active) {
            notifySafely(active.ctx, `Sidekick: ${errorMessage(normalizeError(cause))}`, "error");
          }
        });
        runner.on("progress", (event: { tool: string }) => {
          try {
            if (active.live && current === active) {
              active.ctx.ui.setStatus(
                "pi-sidekick",
                cleanDisplay(`Sidekick working · ${event.tool}`),
              );
            }
          } catch (cause) {
            reportExtensionListenerFailure(active, "progress update", cause);
          }
        });
        runner.on("complete", (handoff: Handoff) => {
          if (!active.live || current !== active) {
            return;
          }
          try {
            appendCompletion(active, handoff);
          } catch (cause) {
            reportExtensionListenerFailure(active, "completion ledger update", cause);
          }
          try {
            update(active);
          } catch (cause) {
            reportExtensionListenerFailure(active, "completion checkpoint update", cause);
          }
          if (active.notificationRequested.has(handoff.id)) {
            void deliverCompletionNotification(
              active,
              handoff,
              active.completionSessionPaths.get(handoff.id),
            );
          }
        });
        if (snapshot.handoff) {
          try {
            if (snapshot.childSession) {
              appendChildLink(active, snapshot.handoff);
            }
            if (snapshot.handoff.status === "settled") {
              appendCompletion(active, snapshot.handoff);
            }
          } catch (cause) {
            reportExtensionListenerFailure(active, "recovery ledger update", cause);
          }
        }
        try {
          update(active);
        } catch (cause) {
          reportExtensionListenerFailure(active, "initial checkpoint update", cause);
        }
        restoreRetryableCompletionNotifications(active);
        return active;
      } catch (cause) {
        if (current === initializingActive) {
          current = undefined;
        }
        if (initializingActive) {
          initializingActive.live = false;
        }
        store.release();
        throw normalizeError(cause);
      }
    })().finally(() => {
      initializing = undefined;
    });
    return await initializing;
  }
  async function configure(
    active: ActiveSession,
    patch: Partial<SidekickConfig>,
    restartSidekick: boolean,
  ): Promise<void> {
    const runner = active.runner;
    if (restartSidekick && runner.running) {
      throw new Error(
        "Wait for the running Sidekick handoff to settle before changing its configuration.",
      );
    }
    const overrides = { ...runner.snapshot.configOverrides, ...validateConfig(patch) };
    const config = loadConfig(
      active.ctx.cwd,
      active.ctx.isProjectTrusted(),
      agentDirectory(),
      overrides,
    );
    runner.snapshot.configOverrides = overrides;
    runner.store.save(runner.snapshot);
    if (restartSidekick) {
      await ensure(active.ctx, true, true);
      return;
    }
    runner.config = config;
    update(active);
  }
  function describe(active: ActiveSession): string {
    const runner = active.runner;
    const frozen = runner.snapshot.frozenSidekickPrompt;
    const handoff = runner.handoff;
    return `${HELP}\n\nEnabled: ${runner.config.enabled}\nLead: ${active.ctx.model ? `${active.ctx.model.provider}/${active.ctx.model.id}` : "not selected"} (${runner.config.leadProfile}; ${runner.config.broadExploration ? "broad exploration" : "direct exploration"})\nConfigured sidekick: ${modelLabel(runner.config.sidekick)} (${runner.config.thinking})\nFile strategy: ${runner.config.sidekickPreferExec ? "shell-first" : "builtin-first"}\nFrozen epoch: ${frozen ? `${modelLabel(frozen.model)} (${frozen.thinking}; ${frozen.profileId}; ${frozen.effectiveSha256})` : "not created"}\nSidekick totals: ${JSON.stringify(runner.snapshot.totals)} (${runner.snapshot.accountingPartial ? "contains partial accounting" : "reconciled when available"})\nState: ${runner.store.dir}\nSidekick transcript: ${runner.sessionPath ?? "not created until dispatch"}\nCosts are provider-reported estimates; unknown or subscription prices may appear as zero.\n${handoff ? `\n${handoffSummary(handoff, runner.sessionPath)}` : "\nNo handoff yet."}`;
  }

  pi.on("session_start", async (...[, ctx]) => {
    if (await disableMarkedChildSession(ctx)) {
      return;
    }
    try {
      await ensure(ctx);
    } catch (cause) {
      notifySafely(ctx, `Sidekick disabled: ${errorMessage(cause)}`, "error");
    }
  });
  pi.on("session_shutdown", async (...[, ctx]) => {
    await dispose();
    blockedChildSessionKey = undefined;
    try {
      ctx?.ui.setStatus("pi-sidekick", undefined);
    } catch (cause) {
      if (ctx) {
        notifySafely(
          ctx,
          `Sidekick shutdown status update failed: ${errorMessage(cause)}`,
          "error",
        );
      }
    }
  });
  pi.on("session_tree", async (...[, ctx]) => {
    if (await disableMarkedChildSession(ctx)) {
      return;
    }
    try {
      await ensure(ctx, true);
    } catch (cause) {
      notifySafely(ctx, `Sidekick reset failed: ${errorMessage(cause)}`, "error");
    }
  });
  pi.on("before_agent_start", async (event, ctx) => {
    if (await disableMarkedChildSession(ctx)) {
      return;
    }
    const active = await ensure(ctx);
    if (!active.runner.config.enabled || !active.runner.config.sidekick) {
      return;
    }
    const config = active.runner.config;
    const leadProfile = selectLeadPromptProfile({
      modelId: ctx.model?.id ?? "",
      activeToolNames: pi.getActiveTools(),
      leadProfile: config.leadProfile,
      broadExploration: config.broadExploration,
      renderedBrowser: config.leadRenderedBrowser,
    });
    const reminderEvent: LeadReminderEvent = {
      kind: LeadReminderEventKind.LEAD_TURN_STARTED,
      broadExploration: config.broadExploration,
      renderedBrowser: config.leadRenderedBrowser,
    };
    const transition = reduceLeadReminderState(active.reminderState, reminderEvent);
    const hiddenContent: string[] = [];
    if (transition.reminder) {
      hiddenContent.push(transition.reminder.text);
    }
    const handoff = active.runner.handoff;
    if (handoff) {
      const outcome = handoff.status === "settled" ? ` (${handoff.outcome})` : "";
      hiddenContent.push(
        `<pi-sidekick-state>Sidekick handoff ${handoff.id} is ${handoff.status}${outcome}. ${handoff.status === "running" ? "Use sidekick_wait to observe this exact handoff without steering it, or use sidekick with a nonblank message to steer this same handoff; inspect only after it settles." : "Inspect the working tree and verification evidence independently before claiming success or sending another correction."}</pi-sidekick-state>`,
      );
    }
    if (transition.reminder) {
      commitReminderEvent(active, reminderEvent);
    }
    const result: {
      systemPrompt: string;
      message?: { customType: string; display: boolean; content: string };
    } = {
      systemPrompt: event.systemPrompt + composePiLeadSystemPrompt(leadProfile),
    };
    if (hiddenContent.length > 0) {
      result.message = {
        customType: "pi-sidekick-state",
        display: false,
        content: hiddenContent.join("\n\n"),
      };
    }
    return result;
  });
  pi.on("tool_result", async (event, ctx) => {
    const active = current;
    if (!active?.live || !active.runner.config.enabled || event.isError) {
      return;
    }
    const config = active.runner.config;
    const reminderEvent: LeadReminderEvent = {
      kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED,
      toolName: event.toolName,
      broadExploration: config.broadExploration,
      renderedBrowser: config.leadRenderedBrowser,
    };
    const transition = reduceLeadReminderState(active.reminderState, reminderEvent);
    if (!transition.reminder) {
      return;
    }
    try {
      await sendHiddenReminder(transition.reminder.text);
      commitReminderEvent(active, reminderEvent);
    } catch (cause) {
      notifySafely(ctx, `Sidekick reminder delivery failed: ${errorMessage(cause)}`, "error");
    }
  });
  pi.on("agent_settled", async (...[, ctx]) => {
    const active = current;
    if (!active?.live || ctx.signal?.aborted) {
      return;
    }
    retryCompletionNotifications(active);
  });

  pi.registerCommand("sidekick", {
    description: "Configure or inspect the persistent lead/sidekick workflow",
    handler: async (args, ctx) => {
      try {
        const [command = "status", ...rest] = args.trim().split(/\s+/u).filter(Boolean);
        const value = rest.join(" ");
        const active = await ensure(ctx);
        const runner = active.runner;
        if (["status", "help"].includes(command)) {
          await send(describe(active));
          return;
        }
        if (command === "on") {
          if (!runner.config.sidekick) {
            throw new Error("Choose a model first: /sidekick model provider/model-id");
          }
          runner.config.enabled = true;
          runner.snapshot.configOverrides.enabled = true;
          runner.store.save(runner.snapshot);
          update(active);
          notify(
            ctx,
            "Sidekick enabled. The child can run local tools with your permissions; parent approval extensions are not inherited.",
            "warning",
          );
        } else if (command === "off") {
          suppressPendingCompletionNotifications(active);
          runner.config.enabled = false;
          runner.snapshot.configOverrides.enabled = false;
          await runner.cancel("Sidekick disabled by the user.");
          runner.store.save(runner.snapshot);
          update(active);
          notify(ctx, "Sidekick off. Existing edits were not reverted.");
        } else if (command === "cancel") {
          suppressPendingCompletionNotifications(active);
          await runner.cancel("Cancelled by the lead.");
          notify(ctx, "Sidekick stopped. Inspect partial changes before proceeding.");
        } else if (command === "reset") {
          if (value !== "--yes") {
            if (!ctx.hasUI) {
              throw new Error(
                "Use /sidekick reset --yes to reset Sidekick memory without undoing files.",
              );
            }
            if (
              !(await ctx.ui.confirm(
                "Reset Sidekick context?",
                "This stops the Sidekick and archives its context. Existing edits are NOT reverted.",
              ))
            ) {
              return;
            }
          }
          await ensure(ctx, true);
          notify(ctx, "Sidekick context reset; existing workspace edits preserved.");
        } else if (command === "model") {
          let selected = value;
          if (!selected) {
            if (!ctx.hasUI) {
              throw new Error("Supply an exact provider/model-id.");
            }
            const models = ctx.modelRegistry.getAvailable();
            selected =
              (await ctx.ui.select(
                "Sidekick model",
                models
                  .map((model) => `${model.provider}/${model.id}`)
                  .sort((left, right) => left.localeCompare(right)),
              )) ?? "";
            if (!selected) {
              return;
            }
          }
          const model = parseModel(selected);
          if (!ctx.modelRegistry.find(model.provider, model.id)) {
            throw new Error(
              "That exact model is not in Pi's model registry. Configure it in Pi first.",
            );
          }
          await configure(active, { sidekick: model }, true);
          notify(ctx, `Sidekick set to ${selected}. Use /sidekick on to enable delegation.`);
        } else if (command === "thinking") {
          if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) {
            throw new Error("Use /sidekick thinking off|minimal|low|medium|high|xhigh|max");
          }
          const patch = validateConfig({ thinking: value });
          await configure(active, patch, true);
          notify(ctx, `Sidekick thinking: ${value}`);
        } else if (command === "lead") {
          const leadProfile = Object.values(LeadProfileMode).find((mode) => mode === value);
          if (!leadProfile) {
            throw new Error("Use /sidekick lead auto|standard|strict");
          }
          await configure(active, { leadProfile }, false);
          notify(ctx, `Sidekick lead profile: ${value}`);
        } else if (command === "broad-exploration") {
          if (value !== "on" && value !== "off") {
            throw new Error("Use /sidekick broad-exploration on|off");
          }
          await configure(active, { broadExploration: value === "on" }, false);
          notify(ctx, `Sidekick broad exploration: ${value}`);
        } else if (command === "rendered-browser") {
          if (value !== "on" && value !== "off") {
            throw new Error("Use /sidekick rendered-browser on|off");
          }
          await configure(active, { leadRenderedBrowser: value === "on" }, false);
          notify(ctx, `Sidekick rendered-browser policy: ${value}`);
        } else if (command === "file-strategy") {
          if (value !== "builtin-first" && value !== "shell-first") {
            throw new Error("Use /sidekick file-strategy builtin-first|shell-first");
          }
          await configure(active, { sidekickPreferExec: value === "shell-first" }, true);
          notify(ctx, `Sidekick file strategy: ${value}`);
        } else if (command === "prefer-exec") {
          if (value !== "on" && value !== "off") {
            throw new Error("Use /sidekick prefer-exec on|off");
          }
          await configure(active, { sidekickPreferExec: value === "on" }, true);
          notify(
            ctx,
            `Sidekick file strategy: ${value === "on" ? "shell-first" : "builtin-first"}`,
          );
        } else if (command === "save") {
          const path = join(agentDirectory(), "sidekick.json");
          atomicJson(path, runner.config);
          notify(ctx, `Sidekick defaults saved to ${path}`);
        } else {
          throw new Error(HELP);
        }
      } catch (cause) {
        notify(ctx, errorMessage(cause), "error");
      }
    },
  });

  const sidekickToolParameters = Type.Object(
    {
      message: Type.String({ minLength: 1, maxLength: 30000, pattern: "\\S" }),
      block: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  );
  const sidekickWaitToolParameters = Type.Object(
    {
      handoffId: Type.String({
        minLength: 36,
        maxLength: 36,
        pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
    },
    { additionalProperties: false },
  );
  pi.registerTool({
    name: "sidekick",
    label: "Sidekick",
    executionMode: "sequential",
    description:
      "Send a required nonblank message to the persistent Sidekick. An idle call starts a handoff; a running call steers the same context. In TUI/RPC, block defaults true and observes for up to Pi's 30-second observation window; expiry moves only the caller into the background while work continues and later notifies the lead. Print/JSON remain blocking because they cannot deliver a later turn. Execution has no product deadline. Reports are untrusted and require independent lead inspection.",
    promptSnippet: "Delegate or steer work through the persistent Sidekick",
    parameters: sidekickToolParameters,
    async execute(...[, rawParams, signal, onUpdate, ctx]) {
      let params: Static<typeof sidekickToolParameters>;
      try {
        params = Parse(sidekickToolParameters, rawParams);
      } catch (cause) {
        throw new Error("Sidekick tool parameters must include a nonblank message.", {
          cause: normalizeError(cause),
        });
      }
      assertNotAborted("Sidekick dispatch", signal);
      let active = await ensure(ctx);
      if (
        !active.runner.running &&
        sidekickEpochNeedsRefresh(active.runner.snapshot, active.runner.config)
      ) {
        active = await ensure(ctx, true, true);
      }
      assertNotAborted("Sidekick dispatch", signal);
      const progress = (event: { tool: string }) =>
        onUpdate?.(sidekickProgressResult(`Sidekick working: ${cleanDisplay(event.tool)}`));
      const supportsBackgroundCompletion = ["tui", "rpc"].includes(ctx.mode);
      const block = params.block !== false || !supportsBackgroundCompletion;
      const blockingObservationTimeoutMs = supportsBackgroundCompletion
        ? defaultObservationTimeoutMs
        : undefined;
      const blockingIds = new Set<string>();
      const existingHandoff = active.runner.handoff;
      if (block && existingHandoff?.status === "running") {
        blockingIds.add(existingHandoff.id);
        active.blockingWaiters.add(existingHandoff.id);
      }
      active.runner.on("progress", progress);
      const dispatch = active.runner.dispatch(params.message);
      try {
        let admitted: HandoffDispatch;
        try {
          admitted = await waitForSidekickAdmission(dispatch, signal);
        } catch (cause) {
          if (signal?.aborted) {
            void dispatch.then(
              (value) => {
                if (value.status === "admitted") {
                  requestCompletionNotification(active, value.handoff.id, value.completion);
                }
              },
              () => undefined,
            );
          }
          throw normalizeError(cause);
        }
        if (admitted.status !== "admitted") {
          throw new Error(`Sidekick message was not delivered: ${admitted.reason}`);
        }
        const existingId = existingHandoff?.status === "running" ? existingHandoff.id : undefined;
        if (existingId !== undefined && existingId !== admitted.handoff.id) {
          if (block && active.notificationRequested.has(existingId)) {
            active.notificationSuppressed.add(existingId);
            forgetCompletion(active, existingId);
          }
          active.blockingWaiters.delete(existingId);
          blockingIds.delete(existingId);
          if (block) {
            blockingIds.add(admitted.handoff.id);
            active.blockingWaiters.add(admitted.handoff.id);
          }
        }
        if (!block) {
          requestCompletionNotification(active, admitted.handoff.id, admitted.completion);
          return sidekickHandoffResult(handoffAdmissionSummary(admitted.kind, admitted.handoff), {
            kind: admitted.kind,
            handoff: compactHandoff(admitted.handoff),
            sessionFile: active.runner.sessionPath,
          });
        }
        blockingIds.add(admitted.handoff.id);
        active.blockingWaiters.add(admitted.handoff.id);
        try {
          const observation = await observeSidekickCompletion(admitted.completion, {
            signal,
            timeoutMs: blockingObservationTimeoutMs,
            onTimeoutScheduled: testHooks?.onObservationTimeoutScheduled,
          });
          if (observation.kind === "window_elapsed") {
            if (blockingObservationTimeoutMs === undefined) {
              throw new Error("Sidekick observation elapsed without a configured window.");
            }
            requestCompletionNotification(active, admitted.handoff.id, admitted.completion);
            return sidekickHandoffResult(
              handoffWaitWindowSummary(admitted.handoff.id, blockingObservationTimeoutMs),
              {
                kind: admitted.kind,
                handoff: compactHandoff(admitted.handoff),
                sessionFile: active.runner.sessionPath,
              },
            );
          }
          active.notificationDelivered.add(observation.handoff.id);
          return sidekickHandoffResult(
            handoffSummary(observation.handoff, active.runner.sessionPath),
            {
              kind: admitted.kind,
              handoff: compactHandoff(observation.handoff),
              sessionFile: active.runner.sessionPath,
            },
          );
        } catch (cause) {
          if (signal?.aborted) {
            requestCompletionNotification(active, admitted.handoff.id, admitted.completion);
          }
          throw normalizeError(cause);
        }
      } finally {
        for (const handoffId of blockingIds) {
          active.blockingWaiters.delete(handoffId);
          if (active.notificationRequested.has(handoffId)) {
            const completion = active.completions.get(handoffId);
            if (completion) {
              retryCompletionNotification(active, handoffId, completion);
            }
          }
        }
        active.runner.off("progress", progress);
      }
    },
  });
  pi.registerTool({
    name: "sidekick_wait",
    label: "Sidekick wait",
    executionMode: "sequential",
    description:
      "Passively observe one exact retained Sidekick handoff without sending a message. timeoutMs overrides Pi's 30-second default observation window. Window expiry never stops execution and preserves a later completion notification.",
    promptSnippet: "Wait for one exact Sidekick handoff without steering it",
    parameters: sidekickWaitToolParameters,
    async execute(...[, rawParams, signal, onUpdate, ctx]) {
      if (!Check(sidekickWaitToolParameters, rawParams)) {
        throw new Error("Sidekick wait parameters must include one exact handoff UUID.");
      }
      const params = Parse(sidekickWaitToolParameters, rawParams);
      assertNotAborted("Sidekick wait", signal);
      const active = await ensure(ctx);
      assertNotAborted("Sidekick wait", signal);
      const progress = (event: { tool: string }) =>
        onUpdate?.(sidekickProgressResult(`Sidekick working: ${cleanDisplay(event.tool)}`));
      let lease: SidekickWaitLease | undefined;
      active.runner.on("progress", progress);
      try {
        lease = claimSidekickWait(active, params.handoffId);
        if (lease.kind === "settled_replay") {
          return sidekickWaitResult(handoffSummary(lease.handoff, lease.childSessionPath), {
            kind: "wait_completed",
            handoff: compactSettledHandoff(lease.handoff),
            sessionFile: lease.childSessionPath,
          });
        }
        const timeoutMs = params.timeoutMs ?? defaultObservationTimeoutMs;
        const observation = await observeSidekickCompletion(lease.completion, {
          signal,
          timeoutMs,
          onTimeoutScheduled: testHooks?.onObservationTimeoutScheduled,
        });
        if (observation.kind === "window_elapsed") {
          releaseSidekickWait(active, lease, false);
          lease = undefined;
          return sidekickWaitResult(
            handoffWaitWindowSummary(params.handoffId, timeoutMs),
            sidekickWaitWindowDetails(params.handoffId, timeoutMs),
          );
        }
        const result = sidekickWaitResult(
          handoffSummary(observation.handoff, lease.childSessionPath),
          {
            kind: "wait_completed",
            handoff: compactSettledHandoff(observation.handoff),
            sessionFile: lease.childSessionPath,
          },
        );
        releaseSidekickWait(active, lease, true);
        lease = undefined;
        return result;
      } catch (cause) {
        if (lease?.kind === "observing") {
          releaseSidekickWait(active, lease, false);
          lease = undefined;
        }
        throw normalizeError(cause);
      } finally {
        active.runner.off("progress", progress);
      }
    },
  });
}
