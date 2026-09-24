import { LeadProfileMode, LeadReminderEventKind, LeadReminderKind } from "../enums.ts";
import {
  LEAD_PROMPT_PROFILES,
  REMINDER_PROMPT_PROFILES,
  SIDEKICK_PROMPT_PROFILES,
} from "./prompt-catalog.ts";
import type {
  LeadPromptSelection,
  LeadReminderEvent,
  LeadReminderState,
  LeadReminderTransition,
  RenderedPromptProfile,
  SidekickPromptSelection,
} from "./types.ts";

const LEAD_PROFILES = new Map(LEAD_PROMPT_PROFILES.map((profile) => [profile.id, profile]));
const SIDEKICK_PROFILES = new Map(SIDEKICK_PROMPT_PROFILES.map((profile) => [profile.id, profile]));
const REMINDER_PROFILES = new Map(REMINDER_PROMPT_PROFILES.map((profile) => [profile.id, profile]));
const LEAD_MUTATOR_TOOLS = new Set(["edit", "write", "MultiEdit", "apply_patch", "notebook_edit"]);

function requireProfile(
  registry: ReadonlyMap<string, RenderedPromptProfile>,
  id: string,
): RenderedPromptProfile {
  const profile = registry.get(id);
  if (!profile) {
    throw new Error(`Pi Sidekick prompt profile is missing: ${id}`);
  }
  return profile;
}

function usesStrictLeadPolicy(modelId: string, mode: LeadProfileMode): boolean {
  if (mode === LeadProfileMode.STRICT) {
    return true;
  }
  if (mode === LeadProfileMode.STANDARD) {
    return false;
  }
  return (
    modelId === "fusion" ||
    modelId.startsWith("fusion-gpt-6-astra") ||
    modelId.startsWith("fusion-gpt-5-6-sol") ||
    modelId.startsWith("gpt-6-astra") ||
    modelId.startsWith("gpt-5.6-sol") ||
    modelId.startsWith("gpt-5-6-sol")
  );
}

/** Selects one complete final lead profile for the current parent turn. */
export function selectLeadPromptProfile(input: LeadPromptSelection): RenderedPromptProfile {
  const strict = usesStrictLeadPolicy(input.modelId, input.leadProfile);
  const id = `lead/${strict ? "strict" : "standard"}/${input.broadExploration ? "broad" : "direct"}/github/${input.renderedBrowser ? "browser" : "no-browser"}`;
  return requireProfile(LEAD_PROFILES, id);
}

/** Selects one complete final sidekick profile from exact child tool names. */
export function selectSidekickPromptProfile(input: SidekickPromptSelection): RenderedPromptProfile {
  const tools = new Set(input.activeToolNames);
  if (input.preferExec && !tools.has("bash") && !tools.has("exec")) {
    throw new Error("Shell-first file strategy requires bash or exec in tools.");
  }
  const browser = input.browserAvailable === true || tools.has("browser");
  const todo = tools.has("todo");
  const persistent = tools.has("exec");
  const fileTools = tools.has("grep") && tools.has("read") && tools.has("edit");
  const preference = !fileTools ? "none" : input.preferExec ? "exec" : "builtin";
  const id = `sidekick/${browser ? "browser" : "no-browser"}/${todo ? "todo" : "simple"}/${persistent ? "persistent" : "ephemeral"}/${preference}`;
  return requireProfile(SIDEKICK_PROFILES, id);
}

function withDeliveredReminder(
  state: LeadReminderState,
  kind: LeadReminderKind,
): LeadReminderState {
  if (state.delivered.includes(kind)) {
    return state;
  }
  return { ...state, delivered: [...state.delivered, kind] };
}

/** Reduces one lead event and selects an eligible one-shot final reminder. */
export function reduceLeadReminderState(
  state: LeadReminderState,
  event: LeadReminderEvent,
): LeadReminderTransition {
  switch (event.kind) {
    case LeadReminderEventKind.LEAD_TURN_STARTED: {
      if (state.delivered.includes(LeadReminderKind.FIRST_MESSAGE)) {
        return { nextState: state };
      }
      const id = `reminder/first-message/${event.broadExploration ? "broad" : "direct"}/${event.renderedBrowser ? "browser" : "no-browser"}`;
      return {
        nextState: withDeliveredReminder(state, LeadReminderKind.FIRST_MESSAGE),
        reminder: requireProfile(REMINDER_PROFILES, id),
      };
    }
    case LeadReminderEventKind.LEAD_MUTATOR_OBSERVED: {
      if (
        state.delegationAdmitted ||
        state.delivered.includes(LeadReminderKind.FIRST_EDIT) ||
        !LEAD_MUTATOR_TOOLS.has(event.toolName)
      ) {
        return { nextState: state };
      }
      const id = `reminder/first-edit/${event.renderedBrowser ? "browser" : "no-browser"}`;
      return {
        nextState: withDeliveredReminder(state, LeadReminderKind.FIRST_EDIT),
        reminder: requireProfile(REMINDER_PROFILES, id),
      };
    }
    case LeadReminderEventKind.DELEGATION_ADMITTED: {
      if (state.delegationAdmitted) {
        return { nextState: state };
      }
      return { nextState: { ...state, delegationAdmitted: true } };
    }
    default: {
      const exhaustive: never = event;
      throw new Error(`Unsupported lead reminder event: ${String(exhaustive)}`);
    }
  }
}
