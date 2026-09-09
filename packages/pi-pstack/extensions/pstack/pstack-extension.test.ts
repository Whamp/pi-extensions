import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
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

function withAgentDir<T>(fn: (paths: { dir: string; jsonPath: string; markdownPath: string }) => Promise<T>): Promise<T> {
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
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			events.set(event, handler);
		},
		registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) {
			commands.set(name, options);
		},
		appendEntry() {},
		sendUserMessage() {},
	};
	pstackExtension(pi as unknown as ExtensionAPI);
	return { commands, events };
}

function makeCtx(options?: {
	hasUI?: boolean;
	mode?: "tui" | "print";
	selects?: Array<string | undefined>;
	confirm?: boolean;
	scopedModels?: Array<{ model: { provider: string; id: string }; thinkingLevel?: string }>;
	available?: Array<{ provider: string; id: string }>;
	sessionEntries?: Array<{ type?: string; customType?: string; data?: { enabled?: unknown } }>;
}) {
	const notifies: Notify[] = [];
	const selectTitles: string[] = [];
	const answers = [...(options?.selects ?? [])];
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
			async select(title: string, _choices: string[]) {
				selectTitles.push(title);
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
	it("injects atomic role lines with cardinality and never puts diagnostics in the prompt", async () => {
		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, {
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
			assert.equal(typeof result, "object");
			assert.ok(result && typeof result === "object" && "systemPrompt" in result);
			const prompt = (result as { systemPrompt: string }).systemPrompt;
			assert.equal(prompt.includes("BASE"), true);
			assert.equal(
				prompt.includes(`feature implementation [single]: "${SELECTOR}"`),
				true,
			);
			assert.equal(
				prompt.includes(`refactoring implementation [single]: "${SELECTOR}"`),
				true,
			);
			assert.equal(prompt.includes("feature, refactoring"), false);
			assert.equal(prompt.includes("how critics"), false);
			assert.equal(prompt.includes("legacy-migrated"), false);
			assert.equal(prompt.includes("retired-role"), false);
			assert.equal(prompt.includes(POTETO_ONE_LINER), false);
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
			await events.get("session_start")?.({ type: "session_start", reason: "startup" }, missing.ctx);
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
			assert.equal(ctx.notifies[0]?.message, "pstack skills off. Hidden from the model; /skill:<name> still works.");
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
				scopedModels: [{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "high" }],
				selects: [undefined],
			});
			await commands.get("setup-pstack")?.handler("", cancelled.ctx);
			assert.equal(readFileSync(jsonPath, "utf8"), original);
			assert.equal(cancelled.notifies.some((note) => note.message.includes("Nothing was written")), true);
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 2, roles: {}, skillsEnabled: true });
			const { commands } = loadExtension();
			const selects = [
				SELECTOR,
				...Array.from({ length: 21 }, () => "inherit-parent"),
			];
			const ctx = makeCtx({
				scopedModels: [{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "high" }],
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
			let selectCount = 0;
			const notifies: Notify[] = [];
			const ctx = {
				hasUI: true,
				mode: "tui",
				scopedModels: [],
				modelRegistry: { getAvailable: () => [{ provider: "xai", id: "grok-4.6" }] },
				sessionManager: { getEntries: () => [] },
				isIdle: () => true,
				ui: {
					notify(message: string, level?: "info" | "warning" | "error") {
						notifies.push({ message, level });
					},
					setStatus() {},
					async select() {
						selectCount += 1;
						if (selectCount === 1) {
							writeFileSync(
								jsonPath,
								`${JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR_B } }, null, 2)}\n`,
								"utf8",
							);
						}
						return "inherit-parent";
					},
					async confirm() {
						return false;
					},
				},
			};
			await commands.get("setup-pstack")?.handler("", ctx as unknown as ExtensionCommandContext);
			assert.equal(existsSync(`${jsonPath}.bak`), false);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).roles["bug-fix"], SELECTOR_B);
			assert.equal(notifies.some((note) => note.level === "error"), true);
			assert.equal(notifies.some((note) => note.message.includes("changed after it was loaded")), true);
		});

		await withAgentDir(async ({ jsonPath }) => {
			writeJson(jsonPath, { version: 2, roles: { "bug-fix": SELECTOR }, skillsEnabled: true });
			const { commands } = loadExtension();
			let selectCount = 0;
			const notifies: Notify[] = [];
			const ctx = {
				hasUI: true,
				mode: "tui",
				scopedModels: [],
				modelRegistry: { getAvailable: () => [{ provider: "xai", id: "grok-4.6" }] },
				sessionManager: { getEntries: () => [] },
				isIdle: () => true,
				ui: {
					notify(message: string, level?: "info" | "warning" | "error") {
						notifies.push({ message, level });
					},
					setStatus() {},
					async select() {
						selectCount += 1;
						if (selectCount === 1) {
							writeJson(jsonPath, { version: 2, roles: { "bug-fix": SELECTOR_B }, skillsEnabled: true });
						}
						return "inherit-parent";
					},
					async confirm() {
						return false;
					},
				},
			};
			await commands.get("setup-pstack")?.handler("", ctx as unknown as ExtensionCommandContext);
			assert.equal(existsSync(`${jsonPath}.bak`), false);
			assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).roles["bug-fix"], SELECTOR_B);
			assert.equal(notifies.some((note) => note.message.includes("changed after it was loaded")), true);
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
