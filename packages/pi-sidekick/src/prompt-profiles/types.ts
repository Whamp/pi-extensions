import type {
  LeadProfileMode,
  LeadReminderEventKind,
  LeadReminderKind,
  PromptProfileFamily,
} from "../enums.ts";

/** One final placeholder-free prompt selected by the Pi Sidekick runtime. */
export interface RenderedPromptProfile {
  id: string;
  family: PromptProfileFamily;
  text: string;
}

/** Inputs that select a complete lead prompt for one parent turn. */
export interface LeadPromptSelection {
  modelId: string;
  activeToolNames: readonly string[];
  leadProfile: LeadProfileMode;
  broadExploration: boolean;
  renderedBrowser: boolean;
}

/** Inputs that select a complete sidekick prompt for one persistent child epoch. */
export interface SidekickPromptSelection {
  activeToolNames: readonly string[];
  preferExec: boolean;
  browserAvailable?: boolean;
}

/** Branch-local state for the one-shot lead reminders. */
export interface LeadReminderState {
  delivered: LeadReminderKind[];
  delegationAdmitted: boolean;
}

/** Starts a lead turn that may need the first-message reminder. */
export interface LeadTurnStartedEvent {
  kind: LeadReminderEventKind.LEAD_TURN_STARTED;
  broadExploration: boolean;
  renderedBrowser: boolean;
}

/** Observes a lead tool call that may need the first-edit reminder. */
export interface LeadMutatorObservedEvent {
  kind: LeadReminderEventKind.LEAD_MUTATOR_OBSERVED;
  toolName: string;
  broadExploration: boolean;
  renderedBrowser: boolean;
}

/** Records the first delegation admitted in this parent branch. */
export interface DelegationAdmittedEvent {
  kind: LeadReminderEventKind.DELEGATION_ADMITTED;
}

/** One event accepted by the lead reminder state machine. */
export type LeadReminderEvent =
  | LeadTurnStartedEvent
  | LeadMutatorObservedEvent
  | DelegationAdmittedEvent;

/** Proposed reminder transition; persist `nextState` only after Pi accepts the reminder message. */
export interface LeadReminderTransition {
  nextState: LeadReminderState;
  reminder?: RenderedPromptProfile;
}
