import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	stripFrontmatter,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	escapeIdentifierRegex,
	getInlineIdentifierColor,
	type InlineIdentifierDefinition,
	type InlineIdentifierFeature,
	type InlineIdentifierReference,
	type ResolvedInlineIdentifier,
	type SkillDefinition,
} from "./core.ts";

const SKILL_TOKEN_START = "(?<![a-z0-9._%+-])";
const SKILL_TOKEN_END = "(?![a-z0-9_-]|\\.[a-z0-9])";
const SKILL_ALIAS_RE = new RegExp(
	`${SKILL_TOKEN_START}\\$([a-z0-9][a-z0-9-]{0,63})${SKILL_TOKEN_END}`,
	"g",
);
const SKILL_AUTOCOMPLETE_RE = /(?:^|[ \t])(\$[a-z0-9-]*)$/;
const SKILL_AUTOCOMPLETE_STOP_RE = /(?:^|[ \t])\$[a-z0-9-]*[ \t]$/;

function isSkillDefinition(definition: InlineIdentifierDefinition): definition is SkillDefinition {
	return definition.kind === "skill";
}

function skillName(command: ReturnType<ExtensionAPI["getCommands"]>[number]): string | undefined {
	if (command.source !== "skill") return undefined;
	const name = command.name.startsWith("skill:")
		? command.name.slice("skill:".length)
		: command.name;
	return name || undefined;
}

/** List Pi's loaded skill commands for inline completion and input matching. */
export function getSkillDefinitions(
	pi: Pick<ExtensionAPI, "getCommands">,
): SkillDefinition[] {
	const definitions = new Map<string, SkillDefinition>();
	for (const command of pi.getCommands()) {
		const name = skillName(command);
		if (!name || definitions.has(name)) continue;
		definitions.set(name, {
			kind: "skill",
			name,
			token: `$${name}`,
			filePath: command.sourceInfo.path,
			...(command.description ? { description: command.description } : {}),
		});
	}
	return [...definitions.values()];
}

/** Find known skill tokens with upstream token boundaries and source offsets. */
export function findSkillReferences(
	text: string,
	definitions: InlineIdentifierDefinition[],
): InlineIdentifierReference[] {
	const byName = new Map(
		definitions.filter(isSkillDefinition).map((definition) => [definition.name, definition]),
	);
	const references: InlineIdentifierReference[] = [];
	for (const match of text.matchAll(SKILL_ALIAS_RE)) {
		const name = match[1];
		const definition = name ? byName.get(name) : undefined;
		if (definition && match.index !== undefined) {
			references.push({
				kind: "skill",
				name: definition.name,
				offset: match.index,
				filePath: definition.filePath,
			});
		}
	}
	return references;
}

/** Color loaded skill tokens without changing terminal-visible line width. */
export function colorizeSkillAliases(
	line: string,
	definitions: InlineIdentifierDefinition[],
): string {
	const skills = definitions.filter(isSkillDefinition);
	if (skills.length === 0 || !line.includes("$")) return line;
	const alternatives = [...skills]
		.sort((left, right) => right.name.length - left.name.length)
		.map((definition) => escapeIdentifierRegex(definition.name))
		.join("|");
	const pattern = new RegExp(
		`${SKILL_TOKEN_START}\\$(${alternatives})${SKILL_TOKEN_END}`,
		"g",
	);
	return line.replace(pattern, (match) => {
		const color = getInlineIdentifierColor("skill");
		return color ? `${color}${match}\x1b[39m` : match;
	});
}

function resolveSkillReference(
	reference: InlineIdentifierReference,
): { ok: true; value: ResolvedInlineIdentifier } | { ok: false; reason: string } {
	if (reference.kind !== "skill") {
		return { ok: false, reason: "the skill resolver received a different identifier category" };
	}
	try {
		const body = stripFrontmatter(readFileSync(reference.filePath, "utf8")).trim();
		const baseDir = dirname(reference.filePath);
		const block = `<skill name="${reference.name}" location="${reference.filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
		return {
			ok: true,
			value: { kind: "skill", name: reference.name, offset: reference.offset, block },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown file read error";
		return { ok: false, reason: `failed to read skill file ${reference.filePath}: ${message}` };
	}
}

/** Build the loaded-skill feature; multi-skill blocks match Pi's native format. */
export function createSkillIdentifierFeature(
	pi: Pick<ExtensionAPI, "getCommands">,
): InlineIdentifierFeature {
	return {
		kind: "skill",
		triggerCharacter: "$",
		listDefinitions: () => getSkillDefinitions(pi),
		matchAutocomplete(beforeCursor) {
			if (SKILL_AUTOCOMPLETE_STOP_RE.test(beforeCursor)) return "stop";
			const prefix = beforeCursor.match(SKILL_AUTOCOMPLETE_RE)?.[1];
			return prefix ? { prefix, query: prefix.slice(1) } : undefined;
		},
		findReferences: findSkillReferences,
		resolveReference: (reference) => resolveSkillReference(reference),
		colorizeLine: colorizeSkillAliases,
	};
}
