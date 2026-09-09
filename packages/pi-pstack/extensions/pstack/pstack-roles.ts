/** Cardinality of a pstack model role. single, repeat, fanout, or pick-one. */
export const ROLE_CARDINALITIES = {
	SINGLE: "single",
	REPEAT: "repeat",
	FANOUT: "fanout",
	PICK_ONE: "pick-one",
} as const;

/** Cardinality controlling whether a role stores one selector or a model list. */
export type PstackRoleCardinality = (typeof ROLE_CARDINALITIES)[keyof typeof ROLE_CARDINALITIES];

/** Setup section containing a related group of pstack roles. */
export type PstackRoleGroup =
	| "Implementation"
	| "Judgment and prose"
	| "How"
	| "Why"
	| "Reflect"
	| "Arena"
	| "Swarm"
	| "Architect"
	| "Interrogate";

/** One pstack role's cardinality, setup group, purpose, and v1 legacy name. */
export interface PstackRoleDefinition {
	readonly cardinality: PstackRoleCardinality;
	readonly group: PstackRoleGroup;
	readonly purpose: string;
	readonly legacyName: string;
}

/** Registry of pstack model roles. Single source for role names and cardinality. */
export const PSTACK_ROLES = {
	"feature implementation": {
		cardinality: "single",
		group: "Implementation",
		purpose: "Implement the scoped feature after design.",
		legacyName: "feature, refactoring",
	},
	"refactoring implementation": {
		cardinality: "single",
		group: "Implementation",
		purpose: "Make behavior-preserving structural edits.",
		legacyName: "feature, refactoring",
	},
	"bug-fix": {
		cardinality: "single",
		group: "Implementation",
		purpose: "Implement the diagnosed fix.",
		legacyName: "bug-fix",
	},
	"perf-issue": {
		cardinality: "single",
		group: "Implementation",
		purpose: "Implement a measured performance change.",
		legacyName: "perf-issue",
	},
	hillclimb: {
		cardinality: "repeat",
		group: "Implementation",
		purpose: "Implement each bounded metric experiment.",
		legacyName: "hillclimb",
	},
	judgment: {
		cardinality: "single",
		group: "Judgment and prose",
		purpose: "Give a general decision or second opinion.",
		legacyName: "judgment and prose",
	},
	prose: {
		cardinality: "single",
		group: "Judgment and prose",
		purpose: "Draft or revise user-facing writing.",
		legacyName: "judgment and prose",
	},
	"hardest tasks": {
		cardinality: "single",
		group: "Judgment and prose",
		purpose: "Handle an explicitly escalated difficult task.",
		legacyName: "hardest tasks",
	},
	"how explorers": {
		cardinality: "repeat",
		group: "How",
		purpose: "Investigate each architecture slice.",
		legacyName: "how explorer",
	},
	"how explainer": {
		cardinality: "single",
		group: "How",
		purpose: "Investigate and explain a simple question.",
		legacyName: "how explainer",
	},
	"how synthesizer": {
		cardinality: "single",
		group: "How",
		purpose: "Combine completed architecture findings.",
		legacyName: "how explainer",
	},
	"why investigators": {
		cardinality: "repeat",
		group: "Why",
		purpose: "Investigate each evidence source.",
		legacyName: "why investigators",
	},
	"why synthesizer": {
		cardinality: "single",
		group: "Why",
		purpose: "Reconcile historical evidence and uncertainty.",
		legacyName: "why synthesizer",
	},
	"reflect judgment reviewer": {
		cardinality: "single",
		group: "Reflect",
		purpose: "Review decisions made in the session.",
		legacyName: "reflect judgment, divergent, synthesizer",
	},
	"reflect tooling reviewer": {
		cardinality: "single",
		group: "Reflect",
		purpose: "Review tool choice and verification.",
		legacyName: "reflect tooling",
	},
	"reflect divergent reviewer": {
		cardinality: "single",
		group: "Reflect",
		purpose: "Challenge the session's shared assumptions.",
		legacyName: "reflect judgment, divergent, synthesizer",
	},
	"reflect synthesizer": {
		cardinality: "single",
		group: "Reflect",
		purpose: "Reconcile the three reflection reports.",
		legacyName: "reflect judgment, divergent, synthesizer",
	},
	"arena runners": {
		cardinality: "fanout",
		group: "Arena",
		purpose: "Produce one complete candidate per list entry.",
		legacyName: "arena runners",
	},
	"arena judge pool": {
		cardinality: "pick-one",
		group: "Arena",
		purpose: "Choose one model to judge all completed candidates.",
		legacyName: "arena cross-judge pool",
	},
	"swarm workers": {
		cardinality: "repeat",
		group: "Swarm",
		purpose: "Use one model across N bounded worker tasks.",
		legacyName: "swarm workers",
	},
	"architect runners": {
		cardinality: "fanout",
		group: "Architect",
		purpose: "Produce at least two distinct design candidates.",
		legacyName: "architect runners",
	},
	"interrogate reviewers": {
		cardinality: "fanout",
		group: "Interrogate",
		purpose: "Review the same artifact once per list entry.",
		legacyName: "interrogate reviewers",
	},
} as const satisfies Record<string, PstackRoleDefinition>;

/** Exact key for one atomic model-selection job. */
export type PstackRoleName = keyof typeof PSTACK_ROLES;

declare const PSTACK_MODEL_SELECTOR_BRAND: unique symbol;

/** Branded model selector. Constructed only after selector safety checks. */
export type PstackModelSelector = string & {
	readonly [PSTACK_MODEL_SELECTOR_BRAND]: true;
};

/** Canonical explicit inheritance value. auto normalizes to this. */
export const PSTACK_INHERIT_PARENT = "inherit-parent" as const;

type ModelList = readonly [PstackModelSelector, ...PstackModelSelector[]];

type ExplicitRoleSelection<R extends PstackRoleName> =
	(typeof PSTACK_ROLES)[R]["cardinality"] extends "single" | "repeat"
		? PstackModelSelector
		: ModelList;

/** Valid normalized selection for a role's declared cardinality. */
export type PstackRoleSelection<R extends PstackRoleName> =
	| typeof PSTACK_INHERIT_PARENT
	| ExplicitRoleSelection<R>;

/** Normalized v2 role map. Omitted roles inherit the parent model. */
export type PstackRoleSelections = {
	readonly [R in PstackRoleName]?: PstackRoleSelection<R>;
};

/** Normalized v2 pstack role configuration. */
export interface PstackRoleConfig {
	readonly version: 2;
	readonly roles: PstackRoleSelections;
	readonly skillsEnabled: boolean;
}

/** Retired v1 role with no replacement. */
export const RETIRED_PSTACK_ROLE_NAME = "how critics";

/** True when value is a v2 pstack role name. */
export function isPstackRoleName(value: string): value is PstackRoleName {
	return Object.hasOwn(PSTACK_ROLES, value);
}

/** v2 pstack role names in registry order. */
export const PSTACK_ROLE_NAMES: readonly PstackRoleName[] =
	Object.keys(PSTACK_ROLES).filter(isPstackRoleName);

/** Markdown role reference generated from the registry. */
export function formatPstackRoleReferenceMarkdown(): string {
	const lines = [
		"# Pstack model roles",
		"",
		"Generated from `extensions/pstack/pstack-roles.ts`. Edit the registry, not this file.",
		"",
		"Cardinality:",
		"",
		"- `single`: one job, one selector.",
		"- `repeat`: one selector, reused for N children the workflow chooses.",
		"- `fanout`: one child per list entry.",
		"- `pick-one`: a candidate list, then one child.",
		"",
		"| Role | Cardinality | Purpose |",
		"| --- | --- | --- |",
	];
	for (const name of PSTACK_ROLE_NAMES) {
		const definition = PSTACK_ROLES[name];
		lines.push(`| \`${name}\` | \`${definition.cardinality}\` | ${definition.purpose} |`);
	}
	lines.push("");
	return lines.join("\n");
}

/** v1 role name to v2 targets, derived from registry legacyName fields. */
export const PSTACK_LEGACY_ROLE_TARGETS: ReadonlyMap<string, readonly PstackRoleName[]> = (() => {
	const map = new Map<string, PstackRoleName[]>();
	for (const name of PSTACK_ROLE_NAMES) {
		const legacyName = PSTACK_ROLES[name].legacyName;
		const group = map.get(legacyName);
		if (group) group.push(name);
		else map.set(legacyName, [name]);
	}
	return map;
})();
