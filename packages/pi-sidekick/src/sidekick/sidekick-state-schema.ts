import { Type } from "typebox";
import {
  SIDEKICK_CONFIG_PATCH_SCHEMA,
  SIDEKICK_MODEL_SCHEMA,
  SIDEKICK_THINKING_SCHEMA,
} from "../config.ts";
import { Outcome } from "../enums.ts";
import { SIDEKICK_CHILD_SESSION_SCHEMA } from "./session.ts";

const USAGE_SCHEMA = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
    turns: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
const HANDOFF_COMMON_PROPERTIES = {
  id: Type.String({ pattern: "^[a-zA-Z0-9-]+$" }),
  message: Type.String({ minLength: 1, maxLength: 30000, pattern: "\\S" }),
  startedAt: Type.String(),
  report: Type.String(),
  error: Type.Optional(Type.String()),
  usage: USAGE_SCHEMA,
  accounting: Type.Optional(Type.Union([Type.Literal("complete"), Type.Literal("partial")])),
};
const HANDOFF_OUTCOME_SCHEMA = Type.Union([
  Type.Literal(Outcome.COMPLETED),
  Type.Literal(Outcome.FAILED),
  Type.Literal(Outcome.CANCELLED),
  Type.Literal(Outcome.INTERRUPTED),
]);
const RUNNING_HANDOFF_SCHEMA = Type.Object(
  {
    ...HANDOFF_COMMON_PROPERTIES,
    status: Type.Literal("running"),
  },
  { additionalProperties: false },
);
const SETTLED_HANDOFF_SCHEMA = Type.Object(
  {
    ...HANDOFF_COMMON_PROPERTIES,
    status: Type.Literal("settled"),
    outcome: HANDOFF_OUTCOME_SCHEMA,
    finishedAt: Type.String(),
    reportPath: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const HANDOFF_SCHEMA = Type.Union([RUNNING_HANDOFF_SCHEMA, SETTLED_HANDOFF_SCHEMA]);
const FROZEN_PROMPT_SCHEMA = Type.Object(
  {
    profileId: Type.String(),
    // Legacy snapshot metadata only; new epochs do not write it.
    canonicalSha256: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
    effectiveSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    effectiveText: Type.String(),
    activeToolNames: Type.Array(Type.String()),
    model: SIDEKICK_MODEL_SCHEMA,
    thinking: SIDEKICK_THINKING_SCHEMA,
    sidekickExtensions: Type.Array(Type.String()),
    sidekickSkills: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

/** Closed schema for the exact version-3 Sidekick state persisted per parent session. */
export const SIDEKICK_SNAPSHOT_SCHEMA = Type.Object(
  {
    version: Type.Literal(3),
    parentId: Type.String(),
    cwd: Type.String(),
    epoch: Type.String({ pattern: "^[a-zA-Z0-9-]+$" }),
    checkpoint: Type.Optional(Type.String()),
    configOverrides: SIDEKICK_CONFIG_PATCH_SCHEMA,
    frozenSidekickPrompt: Type.Optional(FROZEN_PROMPT_SCHEMA),
    childSession: Type.Optional(SIDEKICK_CHILD_SESSION_SCHEMA),
    handoff: Type.Optional(HANDOFF_SCHEMA),
    totals: USAGE_SCHEMA,
    accountingPartial: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
