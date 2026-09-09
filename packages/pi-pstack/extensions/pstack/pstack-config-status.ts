import type { PstackConfigDiagnostic, PstackConfigReadResult } from "./pstack-role-config.ts";

/** How /setup-pstack may persist the completed wizard. */
export type PstackSetupSaveKind = "create" | "atomic-v2" | "backup-legacy" | "confirm-replace";

function attentionDiagnostics(diagnostics: readonly PstackConfigDiagnostic[]): PstackConfigDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.severity === "warning" || diagnostic.severity === "error");
}

function formatSourceState(source: PstackConfigReadResult["source"]): string {
	switch (source) {
		case "v2":
			return "Source: v2.";
		case "v1":
			return "Source: v1. Migrated in memory. Run /setup-pstack to save v2.";
		case "markdown":
			return "Source: markdown. Migrated in memory. Run /setup-pstack to save v2.";
		case "invalid":
			return "Source: invalid. Using inherited defaults.";
		case "missing":
			return "Source: missing.";
		default: {
			const _exhaustive: never = source;
			return _exhaustive;
		}
	}
}

function formatDiagnosticLine(diagnostic: PstackConfigDiagnostic): string {
	const role = diagnostic.role ? ` [${diagnostic.role}]` : "";
	return `${diagnostic.code}${role}: ${diagnostic.message}`;
}

/** Human status for /pstack status. Skills, source, and warning/error counts. */
export function formatPstackStatus(result: PstackConfigReadResult): string {
	const skills = result.config.skillsEnabled
		? "pstack skills on."
		: "pstack skills off. Hidden from the model; /skill:<name> still works.";
	const noisy = attentionDiagnostics(result.diagnostics);
	const warnings = noisy.filter((diagnostic) => diagnostic.severity === "warning").length;
	const errors = noisy.filter((diagnostic) => diagnostic.severity === "error").length;
	const lines = [
		skills,
		formatSourceState(result.source),
		`Warnings: ${warnings}. Errors: ${errors}.`,
		...noisy.map(formatDiagnosticLine),
	];
	return lines.join("\n");
}

/** One TUI warning when config has warnings or errors. Silent for missing and info-only. */
export function pstackSessionStartWarning(result: PstackConfigReadResult): string | undefined {
	if (attentionDiagnostics(result.diagnostics).length === 0) return undefined;
	return "pstack config needs attention. Run /pstack status.";
}

/** True when /pstack on|off may write. Only missing or clean v2. */
export function canPersistPstackSkillsToggle(result: PstackConfigReadResult): boolean {
	return result.source === "missing" || (result.source === "v2" && result.diagnostics.length === 0);
}

/** Persistence path for a completed /setup-pstack run. */
export function pstackSetupSaveKind(result: PstackConfigReadResult): PstackSetupSaveKind {
	if (result.source === "missing") return "create";
	if (result.source === "v1" || result.source === "markdown") return "backup-legacy";
	if (result.source === "v2" && result.diagnostics.length === 0) return "atomic-v2";
	return "confirm-replace";
}
