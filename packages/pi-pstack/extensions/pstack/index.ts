import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPath, legacyMarkdownPath } from "./config.ts";
import {
	canPersistPstackSkillsToggle,
	formatPstackStatus,
	pstackSessionStartWarning,
	pstackSetupSaveKind,
} from "./pstack-config-status.ts";
import type { PstackConfigReadResult, PstackConfigWriteResult } from "./pstack-role-config.ts";
import {
	backupPstackConfigThenSave,
	loadPstackRoleConfig,
	savePstackRoleConfig,
	savePstackRoleConfigIfUnchanged,
} from "./pstack-role-config-store.ts";
import type { PstackRoleConfig } from "./pstack-roles.ts";
import { systemPromptInjection } from "./pstack-role-prompt.ts";
import {
	buildPstackSetupPlan,
	collectPstackSetupSelections,
	pstackModelSelectorsFromSession,
	type PstackScopedModelEntry,
} from "./pstack-setup-plan.ts";
import { stripSkillsByLocationPrefix } from "./skill-strip.ts";

export { systemPromptInjection };

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

const POTETO_SKILL = "/skill:poteto-mode";

type ModeEntry = {
	type?: string;
	customType?: string;
	data?: { enabled?: unknown };
};

function sessionEntries(ctx: ExtensionContext): ModeEntry[] {
	const sm = ctx.sessionManager as {
		getBranch?: () => ModeEntry[];
		getEntries: () => ModeEntry[];
	};
	return typeof sm.getBranch === "function" ? sm.getBranch() : sm.getEntries();
}

function lastPotetoEnabled(entries: ModeEntry[]): boolean {
	let enabled = false;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "pstack-mode") {
			enabled = Boolean(entry.data?.enabled);
		}
	}
	return enabled;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function readExactSourceBytes(path: string): { ok: true; bytes: string } | { ok: false; message?: string } {
	try {
		const st = lstatSync(path);
		if (!st.isFile()) return { ok: false, message: `${path} is not a regular file.` };
		return { ok: true, bytes: readFileSync(path, "utf8") };
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return { ok: false };
		return { ok: false, message: `Failed to read ${path}.` };
	}
}

function notifyWriteResult(ctx: ExtensionCommandContext, result: PstackConfigWriteResult): void {
	if (result.ok) {
		const backup = result.backupPath ? ` Backup: ${result.backupPath}.` : "";
		ctx.ui.notify(`Wrote ${result.path}.${backup}`, "info");
		return;
	}
	ctx.ui.notify(result.diagnostics.map((diagnostic) => diagnostic.message).join(" "), "error");
}

function commandScopedModels(ctx: ExtensionCommandContext): readonly PstackScopedModelEntry[] | undefined {
	if (!("scopedModels" in ctx)) return undefined;
	const value: unknown = Reflect.get(ctx, "scopedModels");
	return Array.isArray(value) ? value : undefined;
}

function sourcePathFor(result: PstackConfigReadResult, jsonPath: string, markdownPath: string): string {
	return result.source === "markdown" ? markdownPath : jsonPath;
}

async function persistSetupConfig(input: {
	ctx: ExtensionCommandContext;
	loaded: PstackConfigReadResult;
	config: PstackRoleConfig;
	jsonPath: string;
	markdownPath: string;
	originalBytes?: string;
	originalReadError?: string;
}): Promise<void> {
	const kind = pstackSetupSaveKind(input.loaded);
	if (kind === "confirm-replace") {
		const confirmed = await input.ctx.ui.confirm(
			"Replace pstack config?",
			"Replace this pstack config? Current warnings and errors will be dropped. A backup is created when a source file exists.",
		);
		if (!confirmed) {
			input.ctx.ui.notify("Setup cancelled. Nothing was written.", "info");
			return;
		}
	}
	if (kind === "backup-legacy" || kind === "confirm-replace") {
		if (input.originalBytes === undefined) {
			input.ctx.ui.notify(input.originalReadError ?? "The source config disappeared. Nothing was written.", "error");
			return;
		}
		notifyWriteResult(
			input.ctx,
			backupPstackConfigThenSave({
				originalBytes: input.originalBytes,
				config: input.config,
				path: input.jsonPath,
				sourcePath: sourcePathFor(input.loaded, input.jsonPath, input.markdownPath),
			}),
		);
		return;
	}
	if (kind === "atomic-v2" && input.originalBytes === undefined) {
		input.ctx.ui.notify(input.originalReadError ?? "The source config disappeared. Nothing was written.", "error");
		return;
	}
	notifyWriteResult(
		input.ctx,
		savePstackRoleConfigIfUnchanged({
			config: input.config,
			path: input.jsonPath,
			originalBytes: kind === "atomic-v2" ? input.originalBytes : undefined,
		}),
	);
}

export default function pstackExtension(pi: ExtensionAPI): void {
	let potetoMode = false;

	function setStatus(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setStatus("pstack-mode", potetoMode ? "pstack: poteto mode" : undefined);
	}

	function persistMode(enabled: boolean, ctx?: ExtensionContext): void {
		potetoMode = enabled;
		pi.appendEntry("pstack-mode", { enabled });
		if (ctx) setStatus(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		potetoMode = false;
		potetoMode = lastPotetoEnabled(sessionEntries(ctx));
		setStatus(ctx);
		const loaded = loadPstackRoleConfig();
		if (ctx.mode !== "tui") return;
		const warning = pstackSessionStartWarning(loaded);
		if (warning) ctx.ui.notify(warning, "warning");
	});

	pi.on("input", async (event, ctx) => {
		if (/^\/skill:poteto-mode(?:\s|$)/.test(event.text)) {
			persistMode(true, ctx);
		}
		return { action: "continue" as const };
	});

	pi.on("before_agent_start", async (event) => {
		const loaded = loadPstackRoleConfig();
		const base = loaded.config.skillsEnabled
			? event.systemPrompt
			: stripSkillsByLocationPrefix(event.systemPrompt, SKILLS_DIR).prompt;
		const extra = systemPromptInjection(loaded.config, potetoMode);
		return {
			systemPrompt: extra ? `${base}\n\n${extra}` : base,
		};
	});

	pi.registerCommand("poteto-mode", {
		description: "Enable or disable sticky pstack Poteto Mode. Usage: /poteto-mode [task] | /poteto-mode off",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			if (!token || "off".startsWith(token)) {
				return [{ value: "off", label: "off" }];
			}
			return null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const token = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
			if (token === "off" || token === "disable" || token === "stop") {
				persistMode(false, ctx);
				ctx.ui.notify("Poteto Mode off.", "info");
				return;
			}
			persistMode(true, ctx);
			ctx.ui.notify("Poteto Mode on. Stays on until /poteto-mode off.", "info");
			const payload = `${POTETO_SKILL}${raw ? ` ${raw}` : ""}`;
			pi.sendUserMessage(
				payload,
				ctx.isIdle()
					? { expandPromptTemplates: true }
					: { expandPromptTemplates: true, deliverAs: "followUp" },
			);
		},
	});

	pi.registerCommand("setup-pstack", {
		description: "Map pstack delegation roles to models available in this Pi session.",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("pstack setup needs a UI. Nothing was written.", "error");
				return;
			}
			const jsonPath = configPath();
			const markdownPath = legacyMarkdownPath();
			const loaded = loadPstackRoleConfig(jsonPath, markdownPath);
			const sourcePath = sourcePathFor(loaded, jsonPath, markdownPath);
			const original = loaded.source === "missing" ? undefined : readExactSourceBytes(sourcePath);
			const plan = buildPstackSetupPlan({
				config: loaded.config,
				sessionSelectors: pstackModelSelectorsFromSession({
					scopedModels: commandScopedModels(ctx),
					availableModels: ctx.modelRegistry.getAvailable(),
				}),
			});
			const next = await collectPstackSetupSelections({
				config: loaded.config,
				plan,
				select: (title, options) => ctx.ui.select(title, options),
			});
			if (!next) {
				ctx.ui.notify("Setup cancelled. Nothing was written.", "info");
				return;
			}
			await persistSetupConfig({
				ctx,
				loaded,
				config: next,
				jsonPath,
				markdownPath,
				originalBytes: original?.ok === true ? original.bytes : undefined,
				originalReadError: original && original.ok === false ? original.message : undefined,
			});
		},
	});

	pi.registerCommand("pstack", {
		description: "Show or toggle whether pstack skills are listed in the system prompt. Usage: /pstack [on|off|status]",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			const options = ["on", "off", "status"].filter((value) => value.startsWith(token));
			if (options.length === 0) return null;
			return options.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const token = args.trim().toLowerCase();
			const jsonPath = configPath();
			const loaded = loadPstackRoleConfig(jsonPath, legacyMarkdownPath());
			if (token === "" || token === "status") {
				ctx.ui.notify(formatPstackStatus(loaded), "info");
				return;
			}
			const enabled = token === "on" || token === "enable";
			if (!enabled && token !== "off" && token !== "disable") {
				ctx.ui.notify("Usage: /pstack [on|off|status]", "error");
				return;
			}
			if (!canPersistPstackSkillsToggle(loaded)) {
				ctx.ui.notify("pstack config is not a clean v2 document. Run /setup-pstack to save changes.", "error");
				return;
			}
			if (enabled === loaded.config.skillsEnabled) {
				ctx.ui.notify(
					enabled ? "pstack skills on." : "pstack skills off. Hidden from the model; /skill:<name> still works.",
					"info",
				);
				return;
			}
			const saved = savePstackRoleConfig({ ...loaded.config, skillsEnabled: enabled }, jsonPath);
			if (!saved.ok) {
				notifyWriteResult(ctx, saved);
				return;
			}
			ctx.ui.notify(
				enabled ? "pstack skills on." : "pstack skills off. Hidden from the model; /skill:<name> still works.",
				"info",
			);
		},
	});
}
