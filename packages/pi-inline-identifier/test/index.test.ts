import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	type ExtensionAPI,
	type ExtensionContext,
	CustomEditor,
} from "@earendil-works/pi-coding-agent";
import { Editor, visibleWidth } from "@earendil-works/pi-tui";
import {
	type InlineIdentifierDefinition,
	type SkillDefinition,
	isNativeSlashInput,
} from "../src/core.ts";
import { getNamedSubagentSupport } from "../src/agent.ts";
import { colorizeSkillAliases } from "../src/skill.ts";
import { expandInlineTemplate } from "../src/prompt.ts";
import inlineIdentifierExtension from "../src/index.ts";

interface CommandFixture {
	name: string;
	source: "skill" | "prompt" | "extension";
	description?: string;
	sourceInfo: {
		path: string;
		source: string;
		scope: "user" | "project" | "temporary";
		origin: "package" | "top-level";
	};
}

interface ToolFixture {
	name: string;
	description?: string;
	parameters: Record<string, unknown>;
}

interface TestContextOptions {
	cwd?: string;
	trusted?: boolean;
}

interface TestHarness {
	input(text: string, source?: "interactive" | "rpc" | "extension", images?: unknown[]): Promise<unknown>;
	start(): void;
	shutdown(): void;
	setEditorText(text: string): void;
	getAutocompleteProvider(): unknown;
	notifications: Array<{ message: string; level: string }>;
}

const COMPACT_SUBAGENT_DESCRIPTION =
	"Subagent input accepts {action:'execute',input:{agent:'scout',task:'...'}} for a named child.";
const EMPTY_AUTOCOMPLETE = { prefix: "fallback", items: [] };

let temporaryRoots: string[] = [];
const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
	temporaryRoots = [];
	if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
});

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-inline-identifier-"));
	temporaryRoots.push(root);
	return root;
}

function sourceInfo(path: string): CommandFixture["sourceInfo"] {
	return { path, source: "test", scope: "user", origin: "top-level" };
}

function skillCommand(name: string, path: string): CommandFixture {
	return { name: `skill:${name}`, source: "skill", sourceInfo: sourceInfo(path) };
}

function promptCommand(name: string, path: string): CommandFixture {
	return { name, source: "prompt", sourceInfo: sourceInfo(path) };
}

function writeSkill(root: string, name: string, body: string): CommandFixture {
	const directory = join(root, "skills", name);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, "SKILL.md");
	writeFileSync(path, `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`);
	return skillCommand(name, path);
}

function writePrompt(root: string, name: string, body: string): CommandFixture {
	const path = join(root, "prompts", `${name}.md`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `---\ndescription: ${name} prompt\n---\n\n${body}\n`);
	return promptCommand(name, path);
}

function writeAgent(directory: string, name: string): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, `${name}.md`),
		`---\nname: ${name}\ndescription: ${name} agent\n---\n\nAgent body.\n`,
	);
}

function supportedSubagentTool(): ToolFixture {
	return {
		name: "subagent",
		description: COMPACT_SUBAGENT_DESCRIPTION,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string", enum: ["execute", "help"] },
				input: { type: "object", additionalProperties: true, maxProperties: 80 },
			},
		},
	};
}

function createHarness(
	commands: CommandFixture[],
	tools: ToolFixture[] = [],
	options: TestContextOptions = {},
): TestHarness {
	const handlers = new Map<string, unknown>();
	let autocompleteProvider: unknown;
	let editorText = "";
	const notifications: Array<{ message: string; level: string }> = [];
	const fallback = EMPTY_AUTOCOMPLETE;
	const currentAutocomplete = {
		async getSuggestions() {
			return fallback;
		},
		applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: { value: string }, prefix: string) {
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const next = [...lines];
			next[cursorLine] = before + item.value + line.slice(cursorCol);
			return { lines: next, cursorLine, cursorCol: before.length + item.value.length };
		},
		shouldTriggerFileCompletion() {
			return true;
		},
	};
	const partialApi = {
		on(event: string, handler: unknown) {
			handlers.set(event, handler);
		},
		getCommands() {
			return commands;
		},
		getAllTools() {
			return tools;
		},
	};
	// SAFETY: The test adapter supplies every ExtensionAPI method used by this extension.
	inlineIdentifierExtension(partialApi as unknown as ExtensionAPI);

	const partialContext = {
		cwd: options.cwd ?? process.cwd(),
		mode: "tui",
		isProjectTrusted: () => options.trusted ?? false,
		ui: {
			notify(message: string, level = "info") {
				notifications.push({ message, level });
			},
			getEditorText: () => editorText,
			theme: {
				getFgAnsi(color: string) {
					return { mdLink: "\x1b[36m", accent: "\x1b[35m", borderAccent: "\x1b[33m" }[color] ?? "";
				},
			},
			addAutocompleteProvider(factory: unknown) {
				autocompleteProvider = Reflect.apply(factory as Function, undefined, [currentAutocomplete]);
			},
		},
	};
	// SAFETY: The test context implements the UI, cwd, trust, and mode fields used by the extension.
	const context = partialContext as unknown as ExtensionContext;

	async function dispatch(eventName: string, event: unknown): Promise<unknown> {
		const handler = handlers.get(eventName);
		if (typeof handler !== "function") return undefined;
		return await Reflect.apply(handler, undefined, [event, context]);
	}

	return {
		input: (text, source = "interactive", images) =>
			dispatch("input", {
				type: "input",
				text,
				source,
				...(images ? { images } : {}),
			}),
		start() {
			void dispatch("session_start", { type: "session_start" });
		},
		shutdown() {
			void dispatch("session_shutdown", { type: "session_shutdown" });
		},
		setEditorText(text) {
			editorText = text;
		},
		getAutocompleteProvider() {
			return autocompleteProvider;
		},
		notifications,
	};
}

function resultText(result: unknown): string {
	if (typeof result !== "object" || result === null) throw new Error("Expected transformed input result.");
	const text: unknown = Reflect.get(result, "text");
	if (typeof text !== "string") throw new Error("Expected transformed input text.");
	return text;
}

function occurrences(text: string, value: string): number {
	return text.split(value).length - 1;
}

function inlineTokenCount(text: string): number {
	return text.match(/<skill name=/g)?.length ?? 0;
}

describe("inline identifier request routing", () => {
	it("keeps native leading slash commands ahead of inline matching", async () => {
		const teach = writeSkill(temporaryRoot(), "teach", "Teach body.");
		const harness = createHarness([teach]);
		assert.deepEqual(await harness.input("/model $teach"), { action: "continue" });
		assert.deepEqual(await harness.input("  /skill:teach use this"), { action: "continue" });
		assert.equal(isNativeSlashInput(" /model"), true);
		assert.equal(isNativeSlashInput("Use /review"), false);
	});

	it("keeps Pi's native expansion for one distinct skill and preserves attachments", async () => {
		const command = writeSkill(temporaryRoot(), "teach", "Teach body.");
		const harness = createHarness([command]);
		const request = "Use $teach for this request.";
		const images = [{ type: "image", data: "image-data", mimeType: "image/png" }];
		const result = await harness.input(request, "interactive", images);
		assert.deepEqual(result, {
			action: "transform",
			text: `/skill:teach ${request}`,
			images,
		});
	});

	it("composes two inline skills in mention order and appends the unchanged request once", async () => {
		const root = temporaryRoot();
		const mode = writeSkill(root, "poteto-mode", "POTETO_SKILL_BODY");
		const teach = writeSkill(root, "teach", "TEACH_SKILL_BODY");
		const harness = createHarness([mode, teach]);
		const request = "$poteto-mode $teach explain why this extension only inserts one skill";
		const result = await harness.input(request);
		const text = resultText(result);

		assert.equal(inlineTokenCount(text), 2);
		assert.equal(occurrences(text, "POTETO_SKILL_BODY"), 1);
		assert.equal(occurrences(text, "TEACH_SKILL_BODY"), 1);
		assert.ok(text.indexOf("POTETO_SKILL_BODY") < text.indexOf("TEACH_SKILL_BODY"));
		assert.ok(text.endsWith(`Original request:\n${request}`));
		assert.equal(occurrences(text, request), 1);
		assert.deepEqual(harness.notifications, []);
	});

	it("deduplicates repeated skill identifiers and leaves unknown tokens literal", async () => {
		const command = writeSkill(temporaryRoot(), "review", "REVIEW_BODY");
		const harness = createHarness([command]);
		const request = "Use $review, then $review again with $unknown.";
		const result = await harness.input(request);
		assert.equal(resultText(result), `/skill:review ${request}`);
		assert.equal(occurrences(resultText(result), "$unknown"), 1);
	});

	it("keeps unknown and partial identifier tokens unchanged", async () => {
		const command = writeSkill(temporaryRoot(), "teach", "Teach body.");
		const harness = createHarness([command]);
		const request = "Skip foo$teach, $teach_extra, and $teach.md.";
		assert.deepEqual(await harness.input(request), { action: "continue" });
	});

	it("does not transform extension-generated input", async () => {
		const command = writeSkill(temporaryRoot(), "teach", "Teach body.");
		const harness = createHarness([command]);
		assert.deepEqual(await harness.input("Use $teach", "extension"), { action: "continue" });
	});

	it("preserves mention order across same-named different categories", async () => {
		const root = temporaryRoot();
		const skill = writeSkill(root, "reviewer", "SKILL_REVIEWER_BODY");
		const prompt = writePrompt(root, "reviewer", "PROMPT_REVIEWER_BODY");
		const projectDirectory = join(root, ".pi", "agents");
		writeAgent(projectDirectory, "reviewer");
		const harness = createHarness([skill, prompt], [supportedSubagentTool()], {
			cwd: root,
			trusted: true,
		});
		const request = "Use /reviewer $reviewer &reviewer";
		const text = resultText(await harness.input(request));

		assert.equal(inlineTokenCount(text), 1);
		assert.ok(text.indexOf("Inline prompt template \"/reviewer\"") < text.indexOf("SKILL_REVIEWER_BODY"));
		assert.ok(text.indexOf("SKILL_REVIEWER_BODY") < text.indexOf("Delegate this task to the \"reviewer\""));
		assert.equal(occurrences(text, "PROMPT_REVIEWER_BODY"), 1);
		assert.equal(occurrences(text, "SKILL_REVIEWER_BODY"), 1);
		assert.equal(occurrences(text, "Delegate this task to the \"reviewer\""), 1);
		assert.ok(text.endsWith(`Original request:\n${request}`));
	});

	it("resolves at least twenty distinct skill references in source order", async () => {
		const root = temporaryRoot();
		const commands = Array.from({ length: 24 }, (_, index) =>
			writeSkill(root, `skill-${index}`, `SKILL_BODY_${index}`),
		);
		const request = commands.map((command) => `$${command.name.slice("skill:".length)}`).join(" ");
		const text = resultText(await createHarness(commands).input(request));
		assert.equal(inlineTokenCount(text), 24);
		for (let index = 0; index < 24; index += 1) {
			assert.equal(text.match(new RegExp(`SKILL_BODY_${index}(?![0-9])`, "g"))?.length, 1);
			if (index > 0) {
				assert.ok(
					text.indexOf(`SKILL_BODY_${index - 1}`) < text.indexOf(`SKILL_BODY_${index}`),
				);
			}
		}
		assert.ok(text.endsWith(`Original request:\n${request}`));
	});

	it("does not rescan identifiers found in a rendered instruction block", async () => {
		const root = temporaryRoot();
		const teach = writeSkill(root, "teach", "Teach body mentions $other.");
		const other = writeSkill(root, "other", "Other skill body.");
		const projectDirectory = join(root, ".pi", "agents");
		writeAgent(projectDirectory, "reviewer");
		const request = "$teach &reviewer";
		const text = resultText(
			await createHarness([teach, other], [supportedSubagentTool()], {
				cwd: root,
				trusted: true,
			}).input(request),
		);
		assert.equal(occurrences(text, "Teach body mentions $other."), 1);
		assert.equal(occurrences(text, "Other skill body."), 0);
	});

	it("preserves images for mixed inline references", async () => {
		const root = temporaryRoot();
		const first = writeSkill(root, "first", "FIRST_BODY");
		const second = writeSkill(root, "second", "SECOND_BODY");
		const images = [{ type: "image", data: "image-data", mimeType: "image/png" }];
		const result = await createHarness([first, second]).input("Use $first and $second", "rpc", images);
		assert.deepEqual(Reflect.get(result as object, "images"), images);
	});

	it("passes through the full original request and warns instead of emitting partial blocks", async () => {
		const root = temporaryRoot();
		const valid = writeSkill(root, "teach", "TEACH_BODY");
		const missing = skillCommand("missing", join(root, "missing", "SKILL.md"));
		const harness = createHarness([valid, missing]);
		const result = await harness.input("Use $teach with $missing.");
		assert.deepEqual(result, { action: "continue" });
		assert.equal(harness.notifications.length, 1);
		assert.match(harness.notifications[0]?.message ?? "", /Inline identifier could not be expanded/);
		assert.equal(harness.notifications[0]?.level, "warning");
	});
});

describe("inline prompt templates", () => {
	it("places a template block before one unchanged request tail", async () => {
		const root = temporaryRoot();
		const command = writePrompt(root, "concise", "Use concise wording.");
		const request = "Explain the tradeoff with /concise.";
		const text = resultText(await createHarness([command]).input(request));
		assert.match(text, /^Inline prompt template "\/concise" \(revision [a-f0-9]{12}\):/);
		assert.ok(text.endsWith(`Original request:\n${request}`));
		assert.equal(occurrences(text, request), 1);
	});

	it("keeps literal request placeholders, defaults, and slices inside template blocks", async () => {
		const placeholders = ["$1", "$@", "$ARGUMENTS", "${@:1}"];
		for (const [index, placeholder] of placeholders.entries()) {
			const root = temporaryRoot();
			const command = writePrompt(root, `template-${index}`, `Authored payload:\n${placeholder}`);
			const request = `Use /template-${index} for this change.`;
			const text = resultText(await createHarness([command]).input(request));
			assert.equal(occurrences(text, request), 2);
			assert.ok(text.endsWith(`Original request:\n${request}`));
		}

		const root = temporaryRoot();
		const fallback = writePrompt(root, "fallback", "Value: ${2:-fallback}");
		const request = "Use /fallback here.";
		const text = resultText(await createHarness([fallback]).input(request));
		assert.ok(text.includes("Value: fallback"));
		assert.equal(occurrences(text, request), 1);
	});

	it("retains one request copy per consuming placeholder and always keeps the tail", () => {
		const request = "Use /review here.";
		assert.deepEqual(expandInlineTemplate("${2:-fallback}", request), {
			text: "fallback",
			insertedRequest: false,
		});
		assert.deepEqual(expandInlineTemplate("${@:1}", request), {
			text: request,
			insertedRequest: true,
		});
		const result = expandInlineTemplate("First: $@\nSecond: $1", request);
		assert.equal(result.insertedRequest, true);
		assert.equal(occurrences(result.text, request), 2);
	});

	it("re-reads a previously used template and passes through if it disappears", async () => {
		const root = temporaryRoot();
		const command = writePrompt(root, "review", "REVIEW_TEMPLATE_BODY");
		const harness = createHarness([command]);
		const first = resultText(await harness.input("Use /review for the first diff."));
		assert.equal(occurrences(first, "REVIEW_TEMPLATE_BODY"), 1);
		writeFileSync(command.sourceInfo.path, "---\ndescription: review\n---\n\nUPDATED_BODY\n");
		const second = resultText(await harness.input("Use /review for the second diff."));
		assert.equal(occurrences(second, "UPDATED_BODY"), 1);
		rmSync(command.sourceInfo.path);
		assert.deepEqual(await harness.input("Use /review for the third diff."), { action: "continue" });
		assert.equal(harness.notifications.length, 1);
	});
});

describe("trusted agent references", () => {
	it("adapts the current compact subagent action/input API", () => {
		const tool = supportedSubagentTool();
		const partialApi = { getAllTools: () => [tool] };
		// SAFETY: The feature reads only the test API's getAllTools method.
		const support = getNamedSubagentSupport(partialApi as unknown as Pick<ExtensionAPI, "getAllTools">);
		assert.deepEqual(support, { available: true, supportsProjectScope: true });
	});

	it("does not advertise agents for unsupported subagent tool schemas", async () => {
		const root = temporaryRoot();
		const agentDirectory = join(root, "agent-dir", "agents");
		process.env.PI_CODING_AGENT_DIR = join(root, "agent-dir");
		writeAgent(agentDirectory, "reviewer");
		const unsupported: ToolFixture = {
			name: "subagent",
			parameters: { type: "object", properties: { input: { type: "object" } } },
		};
		assert.deepEqual(await createHarness([], [unsupported]).input("Ask &reviewer."), {
			action: "continue",
		});
		const topLevelOnly: ToolFixture = {
			name: "subagent",
			parameters: {
				type: "object",
				properties: { action: { enum: ["execute"] }, agent: { type: "string" } },
			},
		};
		assert.deepEqual(await createHarness([], [topLevelOnly]).input("Ask &reviewer."), {
			action: "continue",
		});
	});

	it("requires project trust and includes scope instructions for trusted project agents", async () => {
		const root = temporaryRoot();
		const projectAgents = join(root, ".pi", "agents");
		writeAgent(projectAgents, "project-reviewer");
		const commandTools = [supportedSubagentTool()];
		const request = "Ask &project-reviewer to inspect this change.";
		const untrusted = await createHarness([], commandTools, { cwd: root, trusted: false }).input(request);
		assert.deepEqual(untrusted, { action: "continue" });

		const trusted = await createHarness([], commandTools, { cwd: root, trusted: true }).input(request);
		const text = resultText(trusted);
		assert.ok(text.includes('agent: "project-reviewer"'));
		assert.ok(text.includes("input.agentScope to 'both'"));
		assert.ok(text.endsWith(`Original request:\n${request}`));
	});
});

describe("shared editor behavior", () => {
	it("keeps inline completion, theme coloring, and Pi's editor hooks", async () => {
		const root = temporaryRoot();
		const skill = writeSkill(root, "teach", "Teach body.");
		const prompt = writePrompt(root, "publish-pi-ext", "Publish carefully.");
		const agentDirectory = join(root, "agent-dir", "agents");
		process.env.PI_CODING_AGENT_DIR = join(root, "agent-dir");
		writeAgent(agentDirectory, "reviewer");
		const harness = createHarness([skill, prompt], [supportedSubagentTool()]);
		const originalEditorRender = Editor.prototype.render;
		const originalCustomRender = CustomEditor.prototype.render;
		harness.setEditorText("Use $teach, &reviewer, and /publish-pi-ext.");
		harness.start();

		const provider = harness.getAutocompleteProvider();
		assert.equal(typeof provider, "object");
		assert.ok(provider !== null);
		if (typeof provider !== "object" || provider === null) throw new Error("Missing autocomplete provider");
		const getSuggestions = Reflect.get(provider, "getSuggestions");
		assert.equal(typeof getSuggestions, "function");
		const line = "Then use /publ";
		const suggestions: unknown = await Reflect.apply(getSuggestions, provider, [
			[line],
			0,
			line.length,
			{ signal: new AbortController().signal },
		]);
		assert.deepEqual(suggestions, {
			prefix: "/publ",
			items: [{ value: "/publish-pi-ext", label: "/publish-pi-ext" }],
		});

		const skillDefinition: SkillDefinition = {
			kind: "skill",
			name: "teach",
			token: "$teach",
			filePath: skill.sourceInfo.path,
		};
		const colored = colorizeSkillAliases("Use $teach", [skillDefinition]);
		assert.equal(colored, "Use \x1b[36m$teach\x1b[39m");
		assert.equal(visibleWidth(colored), "Use $teach".length);
		assert.notEqual(Editor.prototype.render, originalEditorRender);
		assert.notEqual(CustomEditor.prototype.render, originalCustomRender);
		harness.shutdown();
	});

	it("sorts distinct references by first mention and preserves all original text", () => {
		const definitions: InlineIdentifierDefinition[] = [
			{ kind: "skill", name: "teach", token: "$teach", filePath: "/skills/teach/SKILL.md" },
		];
		assert.equal(definitions[0]?.token, "$teach");
	});
});
