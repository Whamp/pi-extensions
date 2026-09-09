import { isSafeModelSelector } from "./config.ts";
import {
	PSTACK_LEGACY_ROLE_TARGETS,
	PSTACK_ROLES,
	RETIRED_PSTACK_ROLE_NAME,
	isPstackRoleName,
	type PstackModelSelector,
	type PstackRoleConfig,
	type PstackRoleName,
	type PstackRoleSelections,
} from "./pstack-roles.ts";

const INHERIT_ALIASES = new Set(["inherit-parent", "auto"]);

/** Finite diagnostic codes for pstack role config decode and store. */
export const PSTACK_CONFIG_DIAGNOSTIC_CODES = [
	"invalid-json",
	"unsupported-version",
	"invalid-document",
	"invalid-role-selection",
	"invalid-selector",
	"unknown-role",
	"retired-role",
	"invalid-skills-enabled",
	"ambiguous-legacy-selection",
	"legacy-migrated",
	"not-regular-file",
	"config-too-large",
	"config-read-failed",
	"config-changed",
	"config-write-failed",
] as const;

export type PstackConfigDiagnosticCode = (typeof PSTACK_CONFIG_DIAGNOSTIC_CODES)[number];

/** Structured config diagnostic. Codes are the finite PstackConfigDiagnosticCode union. */
export interface PstackConfigDiagnostic {
	readonly code: PstackConfigDiagnosticCode;
	readonly severity: "info" | "warning" | "error";
	readonly message: string;
	readonly role?: string;
	readonly index?: number;
}

/** Where a loaded pstack config came from. missing is normal. */
export type PstackConfigSource = "missing" | "v1" | "v2" | "markdown" | "invalid";

/** Loader/decoder result. Always includes a usable normalized v2 config. */
export interface PstackConfigReadResult {
	readonly config: PstackRoleConfig;
	readonly source: PstackConfigSource;
	readonly diagnostics: readonly PstackConfigDiagnostic[];
}

/** Typed success or failure of a v2 config write. */
export type PstackConfigWriteResult =
	| { readonly ok: true; readonly path: string; readonly backupPath?: string }
	| { readonly ok: false; readonly diagnostics: readonly PstackConfigDiagnostic[] };

function defaultRoleConfig(): PstackRoleConfig {
	return { version: 2, roles: {}, skillsEnabled: true };
}

/** Empty v2 config. Omitted roles inherit and skills stay enabled. */
export function defaultPstackRoleConfig(): PstackRoleConfig {
	return defaultRoleConfig();
}

/** Build a pstack config diagnostic with a finite code. */
export function pstackConfigDiagnostic(
	code: PstackConfigDiagnosticCode,
	severity: PstackConfigDiagnostic["severity"],
	message: string,
	extra?: { role?: string; index?: number },
): PstackConfigDiagnostic {
	return extra ? { code, severity, message, ...extra } : { code, severity, message };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeConfigPath(path?: string): string {
	return path ?? "pstack models.json";
}

function isInheritAlias(value: string): boolean {
	return INHERIT_ALIASES.has(value);
}

function brandModelSelector(value: string): PstackModelSelector {
	// SAFETY: isSafeModelSelector already accepted this string.
	return value as PstackModelSelector;
}

function isListCardinality(name: PstackRoleName): boolean {
	const cardinality = PSTACK_ROLES[name].cardinality;
	return cardinality === "fanout" || cardinality === "pick-one";
}

function parseSkillsEnabledFlag(
	raw: Record<string, unknown>,
	diagnostics: PstackConfigDiagnostic[],
): boolean {
	if (raw.skillsEnabled === undefined) return true;
	if (raw.skillsEnabled === true || raw.skillsEnabled === false) return raw.skillsEnabled;
	diagnostics.push(
		pstackConfigDiagnostic("invalid-skills-enabled", "warning", "Invalid skillsEnabled flag. Defaulting to true."),
	);
	return true;
}

function retiredRoleDiagnostic(role: string): PstackConfigDiagnostic {
	return pstackConfigDiagnostic(
		"retired-role",
		"warning",
		`Retired role "${role}" has no replacement and has no effect. Left the source unchanged.`,
		{ role },
	);
}

function assignNormalizedRole(
	roles: Record<string, string | readonly string[]>,
	name: PstackRoleName,
	value: string | readonly string[],
): void {
	roles[name] = value;
}

function typedRoleSelections(roles: Record<string, string | readonly string[]>): PstackRoleSelections {
	// SAFETY: keys are registry role names and values passed cardinality checks.
	return roles as PstackRoleSelections;
}

function assignSelectorToLegacyTargets(
	targets: readonly PstackRoleName[],
	selector: PstackModelSelector,
	roles: Record<string, string | readonly string[]>,
): void {
	for (const target of targets) {
		if (isListCardinality(target)) assignNormalizedRole(roles, target, [selector]);
		else assignNormalizedRole(roles, target, selector);
	}
}

function migrateV1RoleValue(
	key: string,
	value: unknown,
	targets: readonly PstackRoleName[],
	roles: Record<string, string | readonly string[]>,
	diagnostics: PstackConfigDiagnostic[],
): void {
	if (typeof value === "string") {
		if (isInheritAlias(value)) return;
		if (!isSafeModelSelector(value)) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"invalid-selector",
					"warning",
					`Invalid selector for "${key}". That role inherits.`,
					{ role: key },
				),
			);
			return;
		}
		assignSelectorToLegacyTargets(targets, brandModelSelector(value), roles);
		return;
	}
	if (!Array.isArray(value)) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"warning",
				`Invalid selection for "${key}". That role inherits.`,
				{ role: key },
			),
		);
		return;
	}

	const real: PstackModelSelector[] = [];
	let inheritCount = 0;
	for (let index = 0; index < value.length; index++) {
		const item = value[index];
		if (typeof item === "string" && isInheritAlias(item)) {
			inheritCount += 1;
			continue;
		}
		if (typeof item === "string" && isSafeModelSelector(item)) {
			real.push(brandModelSelector(item));
			continue;
		}
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-selector",
				"warning",
				`Invalid selector for "${key}" at index ${index}.`,
				{ role: key, index },
			),
		);
	}

	if (inheritCount > 0 && real.length > 0) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"info",
				`Removed inherit-parent/auto from "${key}" because mixed v1 arrays never launched parent-model children.`,
				{ role: key },
			),
		);
	}
	if (real.length === 0) return;

	const firstTarget = targets[0];
	if (firstTarget !== undefined && isListCardinality(firstTarget)) {
		for (const target of targets) assignNormalizedRole(roles, target, real);
		return;
	}

	if (real.length > 1) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"ambiguous-legacy-selection",
				"warning",
				`Ambiguous v1 array for "${key}". Retained 1 selector and discarded ${real.length - 1}. Left the source unchanged.`,
				{ role: key },
			),
		);
	}
	const firstSelector = real[0];
	if (firstSelector === undefined) return;
	assignSelectorToLegacyTargets(targets, firstSelector, roles);
}

function migrateV1Document(raw: Record<string, unknown>, path?: string): PstackConfigReadResult {
	const diagnostics: PstackConfigDiagnostic[] = [];
	const skillsEnabled = parseSkillsEnabledFlag(raw, diagnostics);
	if (!isJsonRecord(raw.roles)) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-document",
				"error",
				`Invalid roles object in ${describeConfigPath(path)}. Roles fell back to inherit-parent.`,
			),
		);
		diagnostics.push(
			pstackConfigDiagnostic(
				"legacy-migrated",
				"info",
				`Migrated v1 config in ${describeConfigPath(path)} in memory. Source bytes were not rewritten.`,
			),
		);
		return { config: { version: 2, roles: {}, skillsEnabled }, source: "v1", diagnostics };
	}

	const roles: Record<string, string | readonly string[]> = {};
	for (const [key, value] of Object.entries(raw.roles)) {
		if (key === RETIRED_PSTACK_ROLE_NAME) {
			diagnostics.push(retiredRoleDiagnostic(key));
			continue;
		}
		const targets = PSTACK_LEGACY_ROLE_TARGETS.get(key);
		if (!targets) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"unknown-role",
					"warning",
					`Unknown role "${key}" has no effect. Left the source unchanged.`,
					{ role: key },
				),
			);
			continue;
		}
		migrateV1RoleValue(key, value, targets, roles, diagnostics);
	}
	diagnostics.push(
		pstackConfigDiagnostic(
			"legacy-migrated",
			"info",
			`Migrated v1 config in ${describeConfigPath(path)} in memory. Source bytes were not rewritten.`,
		),
	);
	return {
		config: { version: 2, roles: typedRoleSelections(roles), skillsEnabled },
		source: "v1",
		diagnostics,
	};
}

function decodeV2RoleValue(
	role: PstackRoleName,
	value: unknown,
	diagnostics: PstackConfigDiagnostic[],
): string | readonly string[] | undefined {
	const list = isListCardinality(role);
	const cardinality = PSTACK_ROLES[role].cardinality;

	if (typeof value === "string") {
		if (isInheritAlias(value)) return undefined;
		if (!isSafeModelSelector(value)) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"invalid-selector",
					"error",
					`Invalid selector for "${role}". That role inherits.`,
					{ role },
				),
			);
			return undefined;
		}
		if (!list) return brandModelSelector(value);
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"error",
				`Role "${role}" is ${cardinality} and requires a non-empty selector array. That role inherits.`,
				{ role },
			),
		);
		return undefined;
	}

	if (!Array.isArray(value)) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"error",
				`Invalid selection for "${role}". That role inherits.`,
				{ role },
			),
		);
		return undefined;
	}

	if (!list) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"error",
				`Role "${role}" is ${cardinality} and requires one selector. That role inherits.`,
				{ role },
			),
		);
		return undefined;
	}

	if (value.length === 0) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-role-selection",
				"error",
				`Role "${role}" requires a non-empty selector array. That role inherits.`,
				{ role },
			),
		);
		return undefined;
	}

	const selectors: PstackModelSelector[] = [];
	for (let index = 0; index < value.length; index++) {
		const item = value[index];
		if (typeof item === "string" && isInheritAlias(item)) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"invalid-role-selection",
					"error",
					`Inheritance aliases inside arrays are invalid for "${role}". That role inherits.`,
					{ role, index },
				),
			);
			return undefined;
		}
		if (typeof item !== "string" || !isSafeModelSelector(item)) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"invalid-selector",
					"error",
					`Invalid selector for "${role}" at index ${index}. That role inherits.`,
					{ role, index },
				),
			);
			return undefined;
		}
		selectors.push(brandModelSelector(item));
	}
	return selectors;
}

function decodeV2Document(raw: Record<string, unknown>, path?: string): PstackConfigReadResult {
	const diagnostics: PstackConfigDiagnostic[] = [];
	const skillsEnabled = parseSkillsEnabledFlag(raw, diagnostics);
	if (!isJsonRecord(raw.roles)) {
		diagnostics.push(
			pstackConfigDiagnostic(
				"invalid-document",
				"error",
				`Invalid roles object in ${describeConfigPath(path)}. Roles fell back to inherit-parent.`,
			),
		);
		return { config: { version: 2, roles: {}, skillsEnabled }, source: "v2", diagnostics };
	}

	const roles: Record<string, string | readonly string[]> = {};
	for (const [key, value] of Object.entries(raw.roles)) {
		if (key === RETIRED_PSTACK_ROLE_NAME) {
			diagnostics.push(retiredRoleDiagnostic(key));
			continue;
		}
		if (!isPstackRoleName(key)) {
			diagnostics.push(
				pstackConfigDiagnostic(
					"unknown-role",
					"warning",
					`Unknown role "${key}" has no effect.`,
					{ role: key },
				),
			);
			continue;
		}
		const decoded = decodeV2RoleValue(key, value, diagnostics);
		if (decoded !== undefined) assignNormalizedRole(roles, key, decoded);
	}
	return {
		config: { version: 2, roles: typedRoleSelections(roles), skillsEnabled },
		source: "v2",
		diagnostics,
	};
}

function decodePstackConfigValue(raw: unknown, path?: string): PstackConfigReadResult {
	if (!isJsonRecord(raw)) {
		return {
			config: defaultRoleConfig(),
			source: "invalid",
			diagnostics: [
				pstackConfigDiagnostic(
					"invalid-document",
					"error",
					`Invalid document in ${describeConfigPath(path)}. Using default inherited roles.`,
				),
			],
		};
	}
	if (raw.version === 1) return migrateV1Document(raw, path);
	if (raw.version === 2) return decodeV2Document(raw, path);
	if (raw.version === undefined) {
		return {
			config: defaultRoleConfig(),
			source: "invalid",
			diagnostics: [
				pstackConfigDiagnostic(
					"invalid-document",
					"error",
					`Invalid document in ${describeConfigPath(path)}. Using default inherited roles.`,
				),
			],
		};
	}
	return {
		config: defaultRoleConfig(),
		source: "invalid",
		diagnostics: [
			pstackConfigDiagnostic(
				"unsupported-version",
				"error",
				`Unsupported version in ${describeConfigPath(path)}. Using default inherited roles.`,
			),
		],
	};
}

/** Decode pstack JSON text into a normalized v2 config. Never throws. */
export function decodePstackConfigText(text: string, path?: string): PstackConfigReadResult {
	try {
		return decodePstackConfigValue(JSON.parse(text), path);
	} catch {
		return {
			config: defaultRoleConfig(),
			source: "invalid",
			diagnostics: [
				pstackConfigDiagnostic(
					"invalid-json",
					"error",
					`Invalid JSON in ${describeConfigPath(path)}. Using default inherited roles.`,
				),
			],
		};
	}
}

function parseLegacyMarkdownRoles(text: string): Record<string, unknown> {
	const roles: Record<string, unknown> = Object.create(null);
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon <= 0) continue;
		const name = trimmed.slice(0, colon).trim();
		if (!name) continue;
		const parts = trimmed
			.slice(colon + 1)
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		roles[name] = parts.length <= 1 ? (parts[0] ?? "") : parts;
	}
	return roles;
}

/** Decode legacy markdown role lines through the v1 migration boundary. Never throws. */
export function decodePstackLegacyMarkdownText(text: string, path?: string): PstackConfigReadResult {
	return decodePstackConfigValue({ version: 1, roles: parseLegacyMarkdownRoles(text) }, path);
}
