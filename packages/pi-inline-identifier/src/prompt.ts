import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	parseFrontmatter,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	escapeIdentifierRegex,
	getInlineIdentifierColor,
	type InlineIdentifierDefinition,
	type InlineIdentifierFeature,
	type InlineIdentifierReference,
	type PromptDefinition,
	type ResolvedInlineIdentifier,
} from "./core.ts";

const PROMPT_TOKEN_START = "(?<![a-z0-9._%+/-])";
const PROMPT_TOKEN_END = "(?![a-z0-9_/-]|\\.[a-z0-9])";
const PROMPT_AUTOCOMPLETE_RE = /(?:^|[ \t])(\/[a-z0-9-]*)$/i;
const PROMPT_AUTOCOMPLETE_STOP_RE = /(?:^|[ \t])\/[a-z0-9-]+[ \t]$/i;
const ARGUMENT_PATTERN =
	/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g;
const PROMPT_REVISION_LENGTH = 12;

interface LoadedPrompt {
	body: string;
	revision: string;
}

/** Template text after literal Pi placeholder substitution against one request. */
export interface InlineTemplateExpansion {
	text: string;
	insertedRequest: boolean;
}

function isPromptDefinition(
	definition: InlineIdentifierDefinition,
): definition is PromptDefinition {
	return definition.kind === "prompt";
}

/** List Pi's loaded prompt commands for inline completion and input matching. */
export function getPromptDefinitions(
	pi: Pick<ExtensionAPI, "getCommands">,
): PromptDefinition[] {
	const definitions = new Map<string, PromptDefinition>();
	for (const command of pi.getCommands()) {
		if (command.source !== "prompt" || definitions.has(command.name)) continue;
		const definition: PromptDefinition = {
			kind: "prompt",
			name: command.name,
			token: `/${command.name}`,
			filePath: command.sourceInfo.path,
			...(command.description ? { description: command.description } : {}),
		};
		definitions.set(command.name, definition);
	}
	return [...definitions.values()];
}

function promptAliasPattern(names: string[]): RegExp | undefined {
	if (names.length === 0) return undefined;
	const alternatives = [...names]
		.sort((left, right) => right.length - left.length)
		.map(escapeIdentifierRegex)
		.join("|");
	return new RegExp(`${PROMPT_TOKEN_START}\\/(${alternatives})${PROMPT_TOKEN_END}`, "g");
}

/** Find known prompt tokens with upstream token boundaries and source offsets. */
export function findPromptReferences(
	text: string,
	definitions: InlineIdentifierDefinition[],
): InlineIdentifierReference[] {
	const prompts = definitions.filter(isPromptDefinition);
	const byName = new Map(prompts.map((definition) => [definition.name, definition]));
	const pattern = promptAliasPattern(prompts.map((definition) => definition.name));
	if (!pattern) return [];

	const references: InlineIdentifierReference[] = [];
	for (const match of text.matchAll(pattern)) {
		const definition = match[1] ? byName.get(match[1]) : undefined;
		if (definition && match.index !== undefined) {
			references.push({
				kind: "prompt",
				name: definition.name,
				offset: match.index,
				filePath: definition.filePath,
			});
		}
	}
	return references;
}

/** Color loaded prompt tokens without changing terminal-visible line width. */
export function colorizePromptAliases(
	line: string,
	definitions: InlineIdentifierDefinition[],
): string {
	const prompts = definitions.filter(isPromptDefinition);
	if (prompts.length === 0 || !line.includes("/")) return line;
	const pattern = promptAliasPattern(prompts.map((definition) => definition.name));
	if (!pattern) return line;
	return line.replace(pattern, (match) => {
		const color = getInlineIdentifierColor("prompt");
		return color ? `${color}${match}\x1b[39m` : match;
	});
}

/** Expand prompt placeholders literally against the full original request. */
export function expandInlineTemplate(
	content: string,
	request: string,
): InlineTemplateExpansion {
	let insertedRequest = false;
	const args = [request];
	const allArgs = request;
	const text = content.replace(
		ARGUMENT_PATTERN,
		(
			_match,
			defaultTarget: string | undefined,
			defaultValue: string | undefined,
			sliceStart: string | undefined,
			sliceLength: string | undefined,
			simple: string | undefined,
		) => {
			if (defaultTarget) {
				const isAll = defaultTarget === "@" || defaultTarget === "ARGUMENTS";
				const index = isAll ? 0 : Number.parseInt(defaultTarget, 10) - 1;
				const value = isAll ? allArgs : args[index];
				if (value) {
					if (isAll || index === 0) insertedRequest = true;
					return value;
				}
				return defaultValue ?? "";
			}

			if (sliceStart) {
				const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
				const length = sliceLength ? Number.parseInt(sliceLength, 10) : undefined;
				const selected =
					length === undefined
						? args.slice(start)
						: args.slice(start, start + length);
				if (start === 0 && selected.length > 0) insertedRequest = true;
				return selected.join(" ");
			}

			if (simple === "ARGUMENTS" || simple === "@") {
				insertedRequest = true;
				return allArgs;
			}

			const index = Number.parseInt(simple ?? "0", 10) - 1;
			const value = args[index] ?? "";
			if (index === 0 && value) insertedRequest = true;
			return value;
		},
	);
	return { text, insertedRequest };
}

function promptRevision(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, PROMPT_REVISION_LENGTH);
}

function promptHeader(name: string, revision: string): string {
	return `Inline prompt template "/${name}" (revision ${revision}):`;
}

function loadPrompt(reference: InlineIdentifierReference): LoadedPrompt | undefined {
	if (reference.kind !== "prompt") return undefined;
	const { body } = parseFrontmatter(readFileSync(reference.filePath, "utf8"));
	const content = body.trim();
	if (!content) return undefined;
	return { body: content, revision: promptRevision(content) };
}

function resolvePromptReference(
	reference: InlineIdentifierReference,
	request: string,
): { ok: true; value: ResolvedInlineIdentifier } | { ok: false; reason: string } {
	if (reference.kind !== "prompt") {
		return { ok: false, reason: "the prompt resolver received a different identifier category" };
	}
	try {
		const prompt = loadPrompt(reference);
		if (!prompt) {
			return { ok: false, reason: `prompt template ${reference.filePath} is empty` };
		}
		const marker = promptHeader(reference.name, prompt.revision);
		const expanded = expandInlineTemplate(prompt.body, request);
		return {
			ok: true,
			value: {
				kind: "prompt",
				name: reference.name,
				offset: reference.offset,
				block: `${marker}\n\n${expanded.text}`,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown file read error";
		return {
			ok: false,
			reason: `failed to read prompt template ${reference.filePath}: ${message}`,
		};
	}
}

/** Build the full-body prompt template feature for the shared coordinator. */
export function createPromptIdentifierFeature(
	pi: Pick<ExtensionAPI, "getCommands">,
): InlineIdentifierFeature {
	return {
		kind: "prompt",
		triggerCharacter: "/",
		listDefinitions: () => getPromptDefinitions(pi),
		matchAutocomplete(beforeCursor) {
			if (PROMPT_AUTOCOMPLETE_STOP_RE.test(beforeCursor)) return "stop";
			const prefix = beforeCursor.match(PROMPT_AUTOCOMPLETE_RE)?.[1];
			return prefix ? { prefix, query: prefix.slice(1) } : undefined;
		},
		findReferences: findPromptReferences,
		resolveReference: (reference, request) =>
			resolvePromptReference(reference, request),
		colorizeLine: colorizePromptAliases,
	};
}
