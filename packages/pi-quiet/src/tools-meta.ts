/** Built-in tool kinds with specialized Kind Formatters. */

export const QUIET_TOOL_NAMES = ["read", "bash", "edit", "write", "find", "grep", "ls"] as const;

export type QuietToolName = (typeof QUIET_TOOL_NAMES)[number];

/**
 * Semantic bucket for Verb Groups (not the raw tool name).
 * Explore kinds fold; Command / EditFile stay singletons.
 */
export type VerbGroupKind = "file" | "search" | "dir" | "command" | "editFile" | "other";

/** Shared Kind Emoji for Foreign Tools (Generic Kind Formatter). */
export const FOREIGN_KIND_EMOJI = "🧩";

/** Canonical Kind Emoji for a Verb Group Kind (Group Headers). */
export const VERB_GROUP_KIND_EMOJI: Record<VerbGroupKind, string> = {
	file: "📖",
	search: "🔍",
	dir: "📂",
	command: "💻",
	editFile: "✏️",
	other: FOREIGN_KIND_EMOJI,
};

export function isQuietToolName(name: string): name is QuietToolName {
	return (QUIET_TOOL_NAMES as readonly string[]).includes(name);
}

/** Register fallback renderers only for tools that still use Pi's implementation. */
export function registerFallbackQuietBuiltinTools(
	tools: readonly { name: string; sourceInfo: { source: string } }[],
	register: (toolName: QuietToolName) => void,
): QuietToolName[] {
	const builtins = new Set<string>();
	const overrides = new Set<string>();
	for (const tool of tools) {
		if (tool.sourceInfo.source === "builtin") {
			builtins.add(tool.name);
		} else {
			overrides.add(tool.name);
		}
	}

	const selected = QUIET_TOOL_NAMES.filter((name) => builtins.has(name) && !overrides.has(name));
	for (const toolName of selected) register(toolName);
	return selected;
}

let quietBuiltinToolNames = new Set<string>(QUIET_TOOL_NAMES);

/** Set the built-ins whose active renderer participates in Quiet compaction. */
export function setQuietBuiltinToolNames(toolNames: readonly QuietToolName[]): void {
	quietBuiltinToolNames = new Set(toolNames);
}

/** Map a tool name to its Verb Group Kind. */
export function verbGroupKind(toolName: string): VerbGroupKind {
	switch (toolName) {
		case "read":
			return "file";
		case "grep":
		case "find":
			return "search";
		case "ls":
			return "dir";
		case "bash":
			return "command";
		case "edit":
		case "write":
			return "editFile";
		default:
			return "other";
	}
}

/** True when settled success|soft rows of this kind may join a Verb Group. */
export function verbGroupJoins(kind: VerbGroupKind): boolean {
	return kind === "file" || kind === "search" || kind === "dir" || kind === "other";
}

/**
 * Whether Foreign Tools join Quiet Display / Verb Groups.
 * Off until a Tool Renderer Wrapper is registered (Pi registerToolRenderer).
 * Without the hook, only built-ins registered by Quiet participate.
 */
let foreignToolsQuiet = false;

export function setForeignToolsQuiet(enabled: boolean): void {
	foreignToolsQuiet = enabled;
}

export function foreignToolsQuietEnabled(): boolean {
	return foreignToolsQuiet;
}

/** True when this tool name paints Quiet Rows and may join Verb Groups. */
export function toolParticipatesInQuiet(name: string): boolean {
	if (!name) return false;
	if (quietBuiltinToolNames.has(name)) return true;
	return foreignToolsQuiet;
}
