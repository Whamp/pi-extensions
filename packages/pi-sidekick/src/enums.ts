/** Selects how the lead-family policy is chosen. */
export enum LeadProfileMode {
  AUTO = "auto",
  STANDARD = "standard",
  STRICT = "strict",
}

/** Identifies one of the three prompt profile roles. */
export enum PromptProfileFamily {
  LEAD = "lead",
  SIDEKICK = "sidekick",
  REMINDER = "reminder",
}

/** Identifies a one-shot lead reminder. */
export enum LeadReminderKind {
  FIRST_MESSAGE = "first-message",
  FIRST_EDIT = "first-edit",
}

/** Drives the lead reminder state machine. */
export enum LeadReminderEventKind {
  LEAD_TURN_STARTED = "lead-turn-started",
  LEAD_MUTATOR_OBSERVED = "lead-mutator-observed",
  DELEGATION_ADMITTED = "delegation-admitted",
}

/** Classifies terminal Sidekick handoff results independently of status. */
export enum Outcome {
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  INTERRUPTED = "interrupted",
}
