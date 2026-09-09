import { isSafeModelSelector } from "./config.ts";
import {
	PSTACK_INHERIT_PARENT,
	PSTACK_ROLE_NAMES,
	PSTACK_ROLES,
	type PstackRoleCardinality,
	type PstackRoleConfig,
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
	readonly group: string;
	readonly kind: "scalar" | "list";
	readonly current: string | readonly string[] | undefined;
}

/** Ordered setup plan for every pstack role. */
export interface PstackSetupPlan {
	readonly steps: readonly PstackSetupRoleStep[];
	readonly choices: readonly string[];
}

function uniqueSafeSelectors(selectors: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const selector of selectors) {
		if (selector === PSTACK_INHERIT_PARENT || selector === "auto") continue;
		if (!isSafeModelSelector(selector) || seen.has(selector)) continue;
		seen.add(selector);
		out.push(selector);
	}
	return out;
}

function scopedSelector(entry: PstackScopedModelEntry): string {
	const base = `${entry.model.provider}/${entry.model.id}`;
	return entry.thinkingLevel === undefined || entry.thinkingLevel === "" ? base : `${base}:${entry.thinkingLevel}`;
}

/** Build setup selectors from scoped models, preserving thinkingLevel suffixes. */
export function pstackModelSelectorsFromSession(input: {
	scopedModels?: readonly PstackScopedModelEntry[];
	availableModels?: readonly { readonly provider: string; readonly id: string }[];
}): string[] {
	if (input.scopedModels !== undefined && input.scopedModels.length > 0) {
		return uniqueSafeSelectors(input.scopedModels.map(scopedSelector));
	}
	return uniqueSafeSelectors((input.availableModels ?? []).map((model) => `${model.provider}/${model.id}`));
}

function pstackSetupGroupLabel(role: PstackRoleName): string {
	if (
		role === "feature implementation" ||
		role === "refactoring implementation" ||
		role === "bug-fix" ||
		role === "perf-issue" ||
		role === "hillclimb"
	) {
		return "Implementation";
	}
	if (role === "judgment" || role === "prose" || role === "hardest tasks") return "Judgment and prose";
	if (role.startsWith("how ")) return "How";
	if (role.startsWith("why ")) return "Why";
	if (role.startsWith("reflect ")) return "Reflect";
	if (role.startsWith("arena ")) return "Arena";
	if (role === "swarm workers") return "Swarm";
	if (role === "architect runners") return "Architect";
	if (role === "interrogate reviewers") return "Interrogate";
	const _exhaustive: never = role;
	return _exhaustive;
}

function pstackSetupPickKind(cardinality: PstackRoleCardinality): "scalar" | "list" {
	return cardinality === "fanout" || cardinality === "pick-one" ? "list" : "scalar";
}

function configuredSelectors(config: PstackRoleConfig): string[] {
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
	sessionSelectors: readonly string[];
}): PstackSetupPlan {
	const extras = configuredSelectors(input.config).filter((selector) => !input.sessionSelectors.includes(selector));
	const choices = [PSTACK_INHERIT_PARENT, ...uniqueSafeSelectors(input.sessionSelectors), ...extras];
	const steps: PstackSetupRoleStep[] = PSTACK_ROLE_NAMES.map((role) => {
		const definition = PSTACK_ROLES[role];
		return {
			role,
			cardinality: definition.cardinality,
			purpose: definition.purpose,
			group: pstackSetupGroupLabel(role),
			kind: pstackSetupPickKind(definition.cardinality),
			current: input.config.roles[role],
		};
	});
	return { steps, choices };
}

function stripCurrentMark(choice: string): string {
	return choice.endsWith(" (current)") ? choice.slice(0, -" (current)".length) : choice;
}

function labeledChoices(choices: readonly string[], current: string | readonly string[] | undefined): string[] {
	const currents = new Set(Array.isArray(current) ? current : current ? [current] : []);
	return choices.map((choice) => (currents.has(choice) ? `${choice} (current)` : choice));
}

function rolePromptTitle(step: PstackSetupRoleStep): string {
	return `${step.group}. ${step.role} [${step.cardinality}]. ${step.purpose}`;
}

function isInheritanceSelector(value: string): boolean {
	return value === PSTACK_INHERIT_PARENT || value === "auto";
}

function omitRole(
	roles: Record<string, string | readonly string[]>,
	role: PstackRoleName,
): Record<string, string | readonly string[]> {
	if (!(role in roles)) return roles;
	const next = { ...roles };
	delete next[role];
	return next;
}

function assignRole(
	roles: Record<string, string | readonly string[]>,
	role: PstackRoleName,
	value: string | readonly string[],
): Record<string, string | readonly string[]> {
	return { ...roles, [role]: value };
}

function asRoleSelections(roles: Record<string, string | readonly string[]>): PstackRoleSelections {
	// SAFETY: keys are registry role names and values passed selector safety checks.
	return roles as PstackRoleSelections;
}

/** Collect setup choices into a new config. Cancel returns undefined and does not reuse the loaded object. */
export async function collectPstackSetupSelections(input: {
	config: PstackRoleConfig;
	plan: PstackSetupPlan;
	select: (title: string, options: string[]) => Promise<string | undefined>;
}): Promise<PstackRoleConfig | undefined> {
	let roles: Record<string, string | readonly string[]> = { ...input.config.roles };
	for (const step of input.plan.steps) {
		if (step.kind === "scalar") {
			const choice = await input.select(rolePromptTitle(step), labeledChoices(input.plan.choices, step.current));
			if (choice === undefined) return undefined;
			const value = stripCurrentMark(choice);
			roles = isInheritanceSelector(value) || !isSafeModelSelector(value) ? omitRole(roles, step.role) : assignRole(roles, step.role, value);
			continue;
		}

		const first = await input.select(rolePromptTitle(step), labeledChoices(input.plan.choices, step.current));
		if (first === undefined) return undefined;
		const selected = stripCurrentMark(first);
		if (isInheritanceSelector(selected) || !isSafeModelSelector(selected)) {
			roles = omitRole(roles, step.role);
			continue;
		}

		const picked = [selected];
		const addChoices = ["done", ...input.plan.choices.filter((choice) => choice !== PSTACK_INHERIT_PARENT)];
		while (true) {
			const next = await input.select(`Add another model for ${step.role}? [${step.cardinality}]`, addChoices);
			if (next === undefined) return undefined;
			if (next === "done") break;
			const value = stripCurrentMark(next);
			if (value === "done" || isInheritanceSelector(value) || !isSafeModelSelector(value)) continue;
			picked.push(value);
		}
		roles = assignRole(roles, step.role, picked);
	}
	return {
		version: 2,
		roles: asRoleSelections(roles),
		skillsEnabled: input.config.skillsEnabled,
	};
}
