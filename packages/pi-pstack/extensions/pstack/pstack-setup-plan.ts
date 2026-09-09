import { isSafeModelSelector } from "./config.ts";
import {
	PSTACK_INHERIT_PARENT,
	PSTACK_ROLE_NAMES,
	PSTACK_ROLES,
	type PstackRoleCardinality,
	type PstackModelSelector,
	type PstackRoleConfig,
	type PstackRoleGroup,
	type PstackRoleName,
	type PstackRoleSelections,
} from "./pstack-roles.ts";

/** Session model used to build setup selectors. thinkingLevel becomes a trailing suffix. */
export interface PstackScopedModelEntry {
	readonly model: {
		readonly provider: string;
		readonly id: string;
	};
	readonly thinkingLevel?: string;
}

/** One registry-driven setup step. kind is scalar for single/repeat and list for fanout/pick-one. */
export interface PstackSetupRoleStep {
	readonly role: PstackRoleName;
	readonly cardinality: PstackRoleCardinality;
	readonly purpose: string;
	readonly group: PstackRoleGroup;
	readonly kind: "scalar" | "list";
	readonly current?: PstackModelSelector | readonly PstackModelSelector[];
}

type PstackSetupChoice = typeof PSTACK_INHERIT_PARENT | PstackModelSelector;
type MutableSetupRoles = Record<string, PstackModelSelector | readonly PstackModelSelector[]>;

/** Ordered setup plan for every pstack role. */
export interface PstackSetupPlan {
	readonly steps: readonly PstackSetupRoleStep[];
	readonly choices: readonly PstackSetupChoice[];
}

function checkedModelSelector(value: string): PstackModelSelector | undefined {
	if (value === PSTACK_INHERIT_PARENT || value === "auto" || !isSafeModelSelector(value)) {
		return undefined;
	}
	// SAFETY: PstackModelSelector is branded only after the shared selector validator accepts it.
	return value as PstackModelSelector;
}

function uniqueSafeSelectors(selectors: readonly string[]): PstackModelSelector[] {
	const out: PstackModelSelector[] = [];
	const seen = new Set<string>();
	for (const value of selectors) {
		const selector = checkedModelSelector(value);
		if (selector === undefined || seen.has(selector)) continue;
		seen.add(selector);
		out.push(selector);
	}
	return out;
}

function scopedSelector(entry: PstackScopedModelEntry): string {
	const base = `${entry.model.provider}/${entry.model.id}`;
	return entry.thinkingLevel === undefined || entry.thinkingLevel === ""
		? base
		: `${base}:${entry.thinkingLevel}`;
}

/** Build setup selectors from scoped models, preserving thinkingLevel suffixes. */
export function pstackModelSelectorsFromSession(input: {
	scopedModels?: readonly PstackScopedModelEntry[];
	availableModels?: readonly { readonly provider: string; readonly id: string }[];
}): PstackModelSelector[] {
	if (input.scopedModels !== undefined && input.scopedModels.length > 0) {
		return uniqueSafeSelectors(input.scopedModels.map(scopedSelector));
	}
	return uniqueSafeSelectors(
		(input.availableModels ?? []).map((model) => `${model.provider}/${model.id}`),
	);
}

function pstackSetupPickKind(cardinality: PstackRoleCardinality): "scalar" | "list" {
	return cardinality === "fanout" || cardinality === "pick-one" ? "list" : "scalar";
}

function configuredSelectors(config: PstackRoleConfig): PstackModelSelector[] {
	const values: string[] = [];
	for (const name of PSTACK_ROLE_NAMES) {
		const value = config.roles[name];
		if (typeof value === "string") values.push(value);
		else if (Array.isArray(value)) values.push(...value);
	}
	return uniqueSafeSelectors(values);
}

/** Build a registry-driven setup plan. Includes configured selectors even when unavailable. */
export function buildPstackSetupPlan(input: {
	config: PstackRoleConfig;
	sessionSelectors: readonly PstackModelSelector[];
}): PstackSetupPlan {
	const extras = configuredSelectors(input.config).filter(
		(selector) => !input.sessionSelectors.includes(selector),
	);
	const choices = [
		PSTACK_INHERIT_PARENT,
		...uniqueSafeSelectors(input.sessionSelectors),
		...extras,
	];
	const steps: PstackSetupRoleStep[] = PSTACK_ROLE_NAMES.map((role) => {
		const definition = PSTACK_ROLES[role];
		const current = input.config.roles[role];
		return {
			role,
			cardinality: definition.cardinality,
			purpose: definition.purpose,
			group: definition.group,
			kind: pstackSetupPickKind(definition.cardinality),
			...(current === undefined || current === PSTACK_INHERIT_PARENT ? {} : { current }),
		};
	});
	return { steps, choices };
}

function stripCurrentMark(choice: string): string {
	return choice.endsWith(" (current)") ? choice.slice(0, -" (current)".length) : choice;
}

function labeledChoices(
	choices: readonly PstackSetupChoice[],
	current: PstackModelSelector | readonly PstackModelSelector[] | undefined,
): string[] {
	const currents = new Set(Array.isArray(current) ? current : current ? [current] : []);
	return choices.map((choice) => (currents.has(choice) ? `${choice} (current)` : choice));
}

function rolePromptTitle(step: PstackSetupRoleStep): string {
	return `${step.group}. ${step.role} [${step.cardinality}]. ${step.purpose}`;
}

function omitRole(roles: MutableSetupRoles, role: PstackRoleName): MutableSetupRoles {
	if (!(role in roles)) return roles;
	const next = { ...roles };
	delete next[role];
	return next;
}

function assignRole(
	roles: MutableSetupRoles,
	role: PstackRoleName,
	value: PstackModelSelector | readonly PstackModelSelector[],
): MutableSetupRoles {
	return { ...roles, [role]: value };
}

function asRoleSelections(roles: MutableSetupRoles): PstackRoleSelections {
	// SAFETY: keys are registry role names and values passed selector safety checks.
	return roles as PstackRoleSelections;
}

function mutableSetupRoles(config: PstackRoleConfig): MutableSetupRoles {
	let roles: MutableSetupRoles = {};
	for (const role of PSTACK_ROLE_NAMES) {
		const value = config.roles[role];
		if (value === undefined || value === PSTACK_INHERIT_PARENT) continue;
		roles = assignRole(roles, role, value);
	}
	return roles;
}

/** Collect setup choices into a new config. Cancel returns undefined and does not reuse the loaded object. */
export async function collectPstackSetupSelections(input: {
	config: PstackRoleConfig;
	plan: PstackSetupPlan;
	select: (title: string, options: string[]) => Promise<string | undefined>;
}): Promise<PstackRoleConfig | undefined> {
	let roles = mutableSetupRoles(input.config);
	for (const step of input.plan.steps) {
		if (step.kind === "scalar") {
			const choice = await input.select(
				rolePromptTitle(step),
				labeledChoices(input.plan.choices, step.current),
			);
			if (choice === undefined) return undefined;
			const value = checkedModelSelector(stripCurrentMark(choice));
			roles =
				value === undefined ? omitRole(roles, step.role) : assignRole(roles, step.role, value);
			continue;
		}

		const first = await input.select(
			rolePromptTitle(step),
			labeledChoices(input.plan.choices, step.current),
		);
		if (first === undefined) return undefined;
		const selected = checkedModelSelector(stripCurrentMark(first));
		if (selected === undefined) {
			roles = omitRole(roles, step.role);
			continue;
		}

		const picked: PstackModelSelector[] = [selected];
		const addChoices = [
			"done",
			...input.plan.choices.filter((choice) => choice !== PSTACK_INHERIT_PARENT),
		];
		while (true) {
			const next = await input.select(
				`Add another model for ${step.role}? [${step.cardinality}]`,
				addChoices,
			);
			if (next === undefined) return undefined;
			if (next === "done") break;
			const value = checkedModelSelector(stripCurrentMark(next));
			if (value !== undefined) picked.push(value);
		}
		roles = assignRole(roles, step.role, picked);
	}
	return {
		version: 2,
		roles: asRoleSelections(roles),
		skillsEnabled: input.config.skillsEnabled,
	};
}
