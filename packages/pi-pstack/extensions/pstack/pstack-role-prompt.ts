import {
	PSTACK_INHERIT_PARENT,
	PSTACK_ROLE_NAMES,
	PSTACK_ROLES,
	type PstackRoleConfig,
} from "./pstack-roles.ts";

const POTETO_PROMPT =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const ADVISORY =
	"Pstack model roles. These are advisory model selections; tools and authority are separate.";

/** Render configured pstack role lines with cardinality. Inherit-all is empty. */
export function formatPstackRoleTable(config: PstackRoleConfig): string {
	const lines: string[] = [];
	for (const role of PSTACK_ROLE_NAMES) {
		const value = config.roles[role];
		if (value === undefined || value === PSTACK_INHERIT_PARENT) continue;
		lines.push(`${role} [${PSTACK_ROLES[role].cardinality}]: ${JSON.stringify(value)}`);
	}
	if (lines.length === 0) return "";
	return [ADVISORY, ...lines].join("\n");
}

/** Assemble the extra system prompt from role table and optional Poteto Mode. */
export function systemPromptInjection(config: PstackRoleConfig, potetoMode: boolean): string {
	const parts: string[] = [];
	const table = formatPstackRoleTable(config);
	if (table) parts.push(table);
	if (potetoMode) parts.push(POTETO_PROMPT);
	return parts.join("\n\n");
}
