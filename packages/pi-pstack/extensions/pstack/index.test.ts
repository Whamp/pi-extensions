import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import pstackExtension from "./index.ts";

const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";
const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

type Notify = { message: string; level?: string };

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pstack-extension-"));
}

function withAgentDir<T>(
	fn: (paths: { dir: string; jsonPath: string; markdownPath: string }) => Promise<T>,
): Promise<T> {
	const dir = tempDir();
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	const jsonPath = join(dir, "pstack", "models.json");
	const markdownPath = join(dir, "pstack-models.md");
	return fn({ dir, jsonPath, markdownPath }).finally(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
}

function writeJson(path: string, value: unknown): string {
	mkdirSync(join(path, ".."), { recursive: true });
	const body = `${JSON.stringify(value, null, 2)}\n`;
	writeFileSync(path, body, "utf8");
	return body;
}

function loadExtension() {
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
	>();
	const events = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const tools = new Map<string, { name: string }>();
	const entries: Array<{ name: string; data: unknown }> = [];
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			events.set(event, handler);
		},
		registerCommand(
			name: string,
			options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
		) {
			commands.set(name, options);
		},
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		appendEntry(name: string, data: unknown) {
			entries.push({ name, data });
		},
		sendUserMessage() {},
	};
	pstackExtension(pi as unknown as ExtensionAPI);
	return { commands, events, tools, entries };
}

function makeCtx(options?: {
	hasUI?: boolean;
	mode?: "tui" | "print";
	selects?: Array<string | undefined>;
	confirm?: boolean;
	scopedModels?: Array<{ model: { provider: string; id: string }; thinkingLevel?: string }>;
	available?: Array<{ provider: string; id: string }>;
	sessionEntries?: Array<{ type?: string; customType?: string; data?: { enabled?: unknown } }>;
	onSelect?: (selectionNumber: number) => void;
}) {
	const notifies: Notify[] = [];
	const selectTitles: string[] = [];
	const answers = [...(options?.selects ?? [])];
	let selectCount = 0;
	const ctx = {
		hasUI: options?.hasUI ?? true,
		mode: options?.mode ?? "tui",
		scopedModels: options?.scopedModels ?? [],
		modelRegistry: {
			getAvailable: () => options?.available ?? [],
		},
		sessionManager: {
			getEntries: () => options?.sessionEntries ?? [],
		},
		isIdle: () => true,
		ui: {
			notify(message: string, level?: "info" | "warning" | "error") {
				notifies.push({ message, level });
			},
			setStatus() {},
			async select(title: string) {
				selectTitles.push(title);
				selectCount += 1;
				options?.onSelect?.(selectCount);
				if (answers.length === 0) return undefined;
				return answers.shift();
			},
			async confirm() {
				return options?.confirm ?? false;
			},
		},
	};
	return { ctx: ctx as unknown as ExtensionCommandContext, notifies, selectTitles };
}

describe("pstack extension v2 runtime", () => {
	it("registers ask_user_question on the host extension API", () => {
		const { tools } = loadExtension();
		assert.equal(tools.has("ask_user_question"), true);
	});

	it("enables sticky Poteto Mode for complete inline tokens anywhere in user input", async () => {
		for (const text of [
			"$poteto-mode $teach explain why this skill only inserts one skill",
			"Explain this with $poteto-mode in the middle.",
			"This request ends with $poteto-mode",
		]) {
			const { events, entries } = loadExtension();
			const { ctx } = makeCtx();
			await events.get("input")?.({ type: "input", text, source: "interactive" }, ctx);
			assert.deepEqual(entries, [{ name: "pstack-mode", data: { enabled: true } }]);
		}
	});

	it("does not enable from longer token names or extension-generated input", async () => {
		for (const text of ["$poteto-mode-extra", "foo$poteto-mode", "$poteto-mode.md"]) {
			const { events, entries } = loadExtension();
			const { ctx } = makeCtx();
			await events.get("input")?.({ type: "input", text, source: "interactive" }, ctx);
			assert.deepEqual(entries, []);
		}

		const { events, entries } = loadExtension();
		const { ctx } = makeCtx();
		await events.get("input")?.({
			type: "input",
			text: "$poteto-mode",
			source: "extension",
		}, ctx);
		assert.deepEqual(entries, []);
	});

	it("preserves native Poteto skill activation and the explicit off command", async () => {
		const native = loadExtension();
		const { ctx } = makeCtx();
		await native.events.get("input")?.(
			{ type: "input", text: "/skill:poteto-mode use the workflow", source: "interactive" },
			ctx,
		);
		assert.deepEqual(native.entries, [{ name: "pstack-mode", data: { enabled: true } }]);

		const disabled = loadExtension();
		await disabled.commands.get("poteto-mode")?.handler("off", ctx);
		assert.deepEqual(disabled.entries, [{ name: "pstack-mode", data: { enabled: false } }]);
	});

	it("keeps legacy role selections and diagnostics out of the prompt without rewriting config", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			const original = writeJson(jsonPath, {
				version: 1,
				roles: {
					"feature, refactoring": SELECTOR,
					"how critics": SELECTOR_B,
				},
			});
			const { events } = loadExtension();
			const { ctx } = makeCtx();
			const result = await events.get("before_agent_start")?.(
				{ type: "before_agent_start", prompt: "go", systemPrompt: "BASE" },
				ctx,
			);
			assert.deepEqual(result, { systemPrompt: "BASE" });
			assert.equal(readFileSync(jsonPath, "utf8"), original);
		});
	});

	it("keeps role selections out of every toggle combination while preserving skills and Poteto Mode", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			const roles = {
				"bug-fix": SELECTOR,
				"arena runners": [SELECTOR, SELECTOR_B],
				"arena judge pool": [SELECTOR_B, SELECTOR],
			};
			writeJson(jsonPath, { version: 2, roles, skillsEnabled: true });
			const { events, commands } = loadExtension();
			const { ctx } = makeCtx();
			const location = fileURLToPath(new URL("../../skills/poteto-mode/SKILL.md", import.meta.url));
			const otherSkill =
				"  <skill><name>other</name><location>/other/SKILL.md</location></skill>\n";
			const pstackSkill = `  <skill><name>poteto-mode</name><location>${location}</location></skill>\n`;
			const base = `BASE\n<available_skills>\n${otherSkill}${pstackSkill}</available_skills>`;
			const hidden = `BASE\n<available_skills>\n${otherSkill}</available_skills>`;

			for (const skillsEnabled of [false, true]) {
				await commands.get("pstack")?.handler(skillsEnabled ? "on" : "off", ctx);
				await events.get("input")?.({ text: "/skill:poteto-mode task" }, ctx);
				for (const potetoMode of [true, false]) {
					if (!potetoMode) {
						await commands.get("poteto-mode")?.handler("off", ctx);
					}
					const prompt = skillsEnabled ? base : hidden;
					assert.deepEqual(
						await events.get("before_agent_start")?.({ systemPrompt: base }, ctx),
						{ systemPrompt: potetoMode ? `${prompt}\n\n${POTETO_ONE_LINER}` : prompt },
						`skillsEnabled=${skillsEnabled}, potetoMode=${potetoMode}`,
					);
				}
				assert.deepEqual(JSON.parse(readFileSync(jsonPath, "utf8")), {
					version: 2,
					roles,
					skillsEnabled,
				});
			}
		});
	});

	it("gives one TUI warning for noisy config and none for missing or info-only v1, and does not rewrite on load", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			const original = writeJson(jsonPath, {
				version: 1,
				roles: { "feature, refactoring": [SELECTOR, SELECTOR_B] },
			});
			const { events, commands } = loadExtension();
			const noisy = makeCtx({ mode: "tui" });
			await events.get("session_start")?.({ type: "session_start", reason: "startup" }, noisy.ctx);
			assert.deepEqual(noisy.notifies, [
				{ message: "pstack config needs attention. Run /pstack status.", level: "warning" },
			]);
			assert.equal(readFileSync(jsonPath, "utf8"), original);

			const status = makeCtx();
			await commands.get("pstack")?.handler("status", status.ctx);
			assert.equal(status.notifies[0]?.message.includes("Source: v1."), true);
			assert.equal(status.notifies[0]?.message.includes("Warnings: 1. Errors: 0."), true);
			assert.equal(status.notifies[0]?.level, "info");
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 1, roles: { "bug-fix": SELECTOR } });
			const { events } = loadExtension();
			const quiet = makeCtx({ mode: "tui" });
			await events.get("session_start")?.({ type: "session_start", reason: "startup" }, quiet.ctx);
			assert.deepEqual(quiet.notifies, []);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).version, 1);
		});

		await withAgentDir(async () => {
			const { events } = loadExtension();
			const missing = makeCtx({ mode: "tui" });
			await events.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				missing.ctx,
			);
			assert.deepEqual(missing.notifies, []);
		});
	});

	it("persists /pstack off only for a clean v2 document and refuses v1", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, {
				version: 2,
				roles: { "bug-fix": SELECTOR },
				skillsEnabled: true,
			});
			const { commands } = loadExtension();
			const ctx = makeCtx();
			await commands.get("pstack")?.handler("off", ctx.ctx);
			assert.equal(
				ctx.notifies[0]?.message,
				"pstack skills off. Hidden from the model; /skill:<name> still works.",
			);
			const saved = JSON.parse(readFileSync(jsonPath, "utf8")) as {
				version: number;
				skillsEnabled: boolean;
				roles: Record<string, string>;
			};
			assert.equal(saved.version, 2);
			assert.equal(saved.skillsEnabled, false);
			assert.equal(saved.roles["bug-fix"], SELECTOR);
		});

		await withAgentDir(async ({ jsonPath }) => {
			const original = writeJson(jsonPath, { version: 1, roles: { "bug-fix": SELECTOR } });
			const { commands } = loadExtension();
			const ctx = makeCtx();
			await commands.get("pstack")?.handler("off", ctx.ctx);
			assert.equal(readFileSync(jsonPath, "utf8"), original);
			assert.equal(ctx.notifies[0]?.level, "error");
			assert.equal(ctx.notifies[0]?.message.includes("/setup-pstack"), true);
		});
	});

	it("keeps scoped thinkingLevel suffixes, writes nothing on cancel, and skips headless setup", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			const original = writeJson(jsonPath, {
				version: 2,
				roles: { "bug-fix": SELECTOR_B },
				skillsEnabled: true,
			});
			const { commands } = loadExtension();
			const cancelled = makeCtx({
				scopedModels: [
					{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "high" },
				],
				selects: [undefined],
			});
			await commands.get("setup-pstack")?.handler("", cancelled.ctx);
			assert.equal(readFileSync(jsonPath, "utf8"), original);
			assert.equal(
				cancelled.notifies.some((note) => note.message.includes("Nothing was written")),
				true,
			);
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 2, roles: {}, skillsEnabled: true });
			const { commands } = loadExtension();
			const selects = [SELECTOR, ...Array.from({ length: 21 }, () => "inherit-parent")];
			const ctx = makeCtx({
				scopedModels: [
					{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "high" },
				],
				selects,
			});
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			const saved = JSON.parse(readFileSync(jsonPath, "utf8")) as {
				version: number;
				roles: Record<string, string>;
			};
			assert.equal(saved.version, 2);
			assert.equal(saved.roles["feature implementation"], SELECTOR);
			assert.equal(saved.roles["bug-fix"], undefined);
			assert.equal(JSON.stringify(saved).includes("auto"), false);
		});

		await withAgentDir(async ({ jsonPath }) => {
			const { commands } = loadExtension();
			const ctx = makeCtx({ hasUI: false });
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			assert.equal(existsSync(jsonPath), false);
			assert.equal(ctx.notifies[0]?.message.includes("needs a UI"), true);
		});
	});

	it("backs up v1 bytes on setup save and refuses a stale source", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			const original = writeJson(jsonPath, { version: 1, roles: { "bug-fix": SELECTOR } });
			const { commands } = loadExtension();
			const ctx = makeCtx({
				available: [{ provider: "openai-codex", id: "gpt-5.6-sol" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
			});
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			assert.equal(readFileSync(`${jsonPath}.bak`, "utf8"), original);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).version, 2);
			assert.equal(ctx.notifies[0]?.message.includes("Backup:"), true);
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 1, roles: { "bug-fix": SELECTOR } });
			const { commands } = loadExtension();
			const ctx = makeCtx({
				available: [{ provider: "xai", id: "grok-4.6" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
				onSelect(selectionNumber) {
					if (selectionNumber !== 1) return;
					writeJson(jsonPath, { version: 1, roles: { "bug-fix": SELECTOR_B } });
				},
			});
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			assert.equal(existsSync(`${jsonPath}.bak`), false);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).roles["bug-fix"], SELECTOR_B);
			assert.equal(
				ctx.notifies.some((note) => note.level === "error"),
				true,
			);
			assert.equal(
				ctx.notifies.some((note) => note.message.includes("changed after it was loaded")),
				true,
			);
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 2, roles: { "bug-fix": SELECTOR }, skillsEnabled: true });
			const { commands } = loadExtension();
			const ctx = makeCtx({
				available: [{ provider: "xai", id: "grok-4.6" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
				onSelect(selectionNumber) {
					if (selectionNumber !== 1) return;
					writeJson(jsonPath, {
						version: 2,
						roles: { "bug-fix": SELECTOR_B },
						skillsEnabled: true,
					});
				},
			});
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			assert.equal(existsSync(`${jsonPath}.bak`), false);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).roles["bug-fix"], SELECTOR_B);
			assert.equal(
				ctx.notifies.some((note) => note.message.includes("changed after it was loaded")),
				true,
			);
		});
	});

	it("backs up legacy markdown at the markdown source path", async () => {
		await withAgentDir(async ({ jsonPath, markdownPath }) => {
			const original = `bug-fix: ${SELECTOR}\n`;
			writeFileSync(markdownPath, original, "utf8");
			const { commands } = loadExtension();
			const ctx = makeCtx({
				available: [{ provider: "xai", id: "grok-4.6" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
			});
			await commands.get("setup-pstack")?.handler("", ctx.ctx);
			assert.equal(readFileSync(`${markdownPath}.bak`, "utf8"), original);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).version, 2);
			assert.equal(readFileSync(markdownPath, "utf8"), original);
			assert.equal(existsSync(`${jsonPath}.bak`), false);
		});
	});

	it("requires confirmation before replacing invalid config and cancels without writing", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			mkdirSync(join(jsonPath, ".."), { recursive: true });
			writeFileSync(jsonPath, "{not json", "utf8");
			const { commands } = loadExtension();
			const cancelled = makeCtx({
				available: [{ provider: "xai", id: "grok-4.6" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
				confirm: false,
			});
			await commands.get("setup-pstack")?.handler("", cancelled.ctx);
			assert.equal(readFileSync(jsonPath, "utf8"), "{not json");
			assert.equal(existsSync(`${jsonPath}.bak`), false);
		});

		await withAgentDir(async ({ jsonPath }) => {
			mkdirSync(join(jsonPath, ".."), { recursive: true });
			writeFileSync(jsonPath, "{not json", "utf8");
			const { commands } = loadExtension();
			const replaced = makeCtx({
				available: [{ provider: "xai", id: "grok-4.6" }],
				selects: Array.from({ length: 22 }, () => "inherit-parent"),
				confirm: true,
			});
			await commands.get("setup-pstack")?.handler("", replaced.ctx);
			assert.equal(readFileSync(`${jsonPath}.bak`, "utf8"), "{not json");
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).version, 2);
		});
	});
});
