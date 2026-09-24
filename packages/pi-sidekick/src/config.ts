import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Parse } from "typebox/value";
import { LeadProfileMode } from "./enums.ts";
import { errorMessage, hasErrorCode } from "./errors.ts";

/** Default opt-in Sidekick configuration. */
export const DEFAULT_CONFIG: SidekickConfig = {
  version: 2,
  sidekick: null,
  thinking: "medium",
  leadProfile: LeadProfileMode.AUTO,
  broadExploration: false,
  leadRenderedBrowser: false,
  sidekickPreferExec: false,
  enabled: false,
  sidekickExtensions: [],
  sidekickSkills: [],
  tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
};

const TOOL_NAME_PATTERN = "^[A-Za-z][A-Za-z0-9_.-]{0,127}$";
/** Closed model reference schema shared by configuration and persisted state. */
export const SIDEKICK_MODEL_SCHEMA = Type.Object(
  {
    provider: Type.String({ minLength: 1, pattern: "^[^/]+$" }),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
/** Closed thinking-level schema shared by configuration and persisted state. */
export const SIDEKICK_THINKING_SCHEMA = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);
const LEAD_PROFILE_SCHEMA = Type.Union([
  Type.Literal(LeadProfileMode.AUTO),
  Type.Literal(LeadProfileMode.STANDARD),
  Type.Literal(LeadProfileMode.STRICT),
]);
const CONFIG_COMMON_PROPERTIES = {
  sidekick: Type.Optional(Type.Union([SIDEKICK_MODEL_SCHEMA, Type.Null()])),
  thinking: Type.Optional(SIDEKICK_THINKING_SCHEMA),
  leadProfile: Type.Optional(LEAD_PROFILE_SCHEMA),
  broadExploration: Type.Optional(Type.Boolean()),
  leadRenderedBrowser: Type.Optional(Type.Boolean()),
  sidekickPreferExec: Type.Optional(Type.Boolean()),
  enabled: Type.Optional(Type.Boolean()),
  sidekickExtensions: Type.Optional(Type.Array(Type.String())),
  sidekickSkills: Type.Optional(Type.Array(Type.String())),
  tools: Type.Optional(
    Type.Array(Type.String({ pattern: TOOL_NAME_PATTERN }), { minItems: 1, uniqueItems: true }),
  ),
};

/** Rejects undeclared keys at every configuration and persisted-override boundary. */
export const SIDEKICK_CONFIG_PATCH_SCHEMA = Type.Object(
  {
    ...CONFIG_COMMON_PROPERTIES,
    version: Type.Optional(Type.Literal(2)),
  },
  { additionalProperties: false },
);

/** Model reference derived from the authoritative configuration schema. */
export type ModelRef = Static<typeof SIDEKICK_MODEL_SCHEMA>;
/** Thinking level derived from the authoritative configuration schema. */
export type Thinking = Static<typeof SIDEKICK_THINKING_SCHEMA>;
/** Fully resolved configuration derived from the closed patch schema. */
export type SidekickConfig = Required<Static<typeof SIDEKICK_CONFIG_PATCH_SCHEMA>>;

/** Resolves Pi's agent directory while honoring the supported environment override. */
export function agentDirectory(env = process.env): string {
  return resolve(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
}

/** Parses an exact provider/model ID without shell or fuzzy matching. */
export function parseModel(value: string): ModelRef {
  const split = value.indexOf("/");
  // oxlint-disable-next-line no-control-regex -- Model IDs must reject whitespace and ASCII controls before entering process arguments.
  if (split < 1 || split === value.length - 1 || /[\s\x00-\x1f]/u.test(value)) {
    throw new Error("Use an exact provider/model-id (model IDs may contain additional slashes).");
  }
  return { provider: value.slice(0, split), id: value.slice(split + 1) };
}

/** Formats one configured model for user-facing status. */
export function modelLabel(model: ModelRef | null): string {
  return model ? `${model.provider}/${model.id}` : "not configured";
}

/** Rejects unknown keys before a patch can participate in configuration precedence. */
export function validateConfig(raw: unknown): Partial<SidekickConfig> {
  const values = Parse(SIDEKICK_CONFIG_PATCH_SCHEMA, raw);
  if (values.sidekick) {
    parseModel(`${values.sidekick.provider}/${values.sidekick.id}`);
  }
  if (values.sidekickExtensions?.some((path) => !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("sidekickExtensions must be an array of absolute, trusted local paths.");
  }
  if (values.sidekickSkills?.some((path) => !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("sidekickSkills must be an array of absolute, trusted local paths.");
  }
  return values;
}

function readConfigLayer(path: string): Partial<SidekickConfig> {
  try {
    return validateConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (cause) {
    if (hasErrorCode(cause, "ENOENT")) {
      return {};
    }
    throw new Error(`Cannot load ${path}: ${errorMessage(cause)}`);
  }
}

function validateResolvedConfig(config: SidekickConfig): SidekickConfig {
  if (
    config.sidekickPreferExec &&
    !config.tools.includes("bash") &&
    !config.tools.includes("exec")
  ) {
    throw new Error("Shell-first file strategy requires bash or exec in tools.");
  }
  return config;
}

/** Validates each layer before precedence and never reads untrusted project configuration. */
export function loadConfig(
  cwd: string,
  trusted: boolean,
  agentDir = agentDirectory(),
  overrides: Partial<SidekickConfig> = {},
): SidekickConfig {
  const global = readConfigLayer(join(agentDir, "sidekick.json"));
  const local = trusted ? readConfigLayer(join(cwd, ".pi", "sidekick.json")) : {};
  const session = validateConfig(overrides);
  return validateResolvedConfig({
    ...structuredClone(DEFAULT_CONFIG),
    ...global,
    ...local,
    ...session,
  });
}
