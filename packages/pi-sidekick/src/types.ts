import type { Static } from "typebox";
import type { SIDEKICK_SNAPSHOT_SCHEMA } from "./sidekick/sidekick-state-schema.ts";

/** Persisted Sidekick state for one parent session and epoch. */
export type Snapshot = Static<typeof SIDEKICK_SNAPSHOT_SCHEMA>;
/** Frozen prompt contract persisted with a Sidekick epoch. */
export type FrozenSidekickPrompt = NonNullable<Snapshot["frozenSidekickPrompt"]>;
/** Latest persisted conversational handoff for a Sidekick epoch. */
export type Handoff = NonNullable<Snapshot["handoff"]>;
/** A handoff that is admitted and still running in the persistent child. */
export type RunningHandoff = Extract<Handoff, { status: "running" }>;
/** A handoff that has settled and includes terminal outcome evidence. */
export type SettledHandoff = Extract<Handoff, { status: "settled" }>;
/** Persisted provider usage totals for Sidekick accounting. */
export type Usage = Snapshot["totals"];
/** Permitted payload fields for Sidekick RPC requests. */
export interface RpcRequestBody {
  message?: string;
  x?: number;
}
/** Permitted fields for records written to the Pi RPC child. */
export interface RpcOutboundRecord extends RpcRequestBody {
  type: string;
  id: string;
  confirmed?: boolean;
  cancelled?: boolean;
}
/** Process command and arguments used to launch a Pi child. */
export interface Launch {
  command: string;
  args: string[];
}
/** Creates an empty usage accumulator. */
export function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
  };
}
/** Adds two usage accumulators without imposing an execution limit. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cost: a.cost + b.cost,
    turns: a.turns + b.turns,
  };
}
