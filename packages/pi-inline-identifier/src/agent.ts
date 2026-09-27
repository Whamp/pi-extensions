import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	parseFrontmatter,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	escapeIdentifierRegex,
	getInlineIdentifierColor,
	type AgentDefinition,
	type InlineIdentifierDefinition,
	type InlineIdentifierFeature,
	type InlineIdentifierReference,
	type ResolvedInlineIdentifier,
} from "./core.ts";

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const AGENT_TOKEN_START = "(?<![a-z0-9._%+&-])";
const AGENT_TOKEN_END = "(?![a-z0-9_-]|\\.[a-z0-9])";
const AGENT_AUTOCOMPLETE_RE = /(?:^|[ \t])(&[a-z0-9_-]*)$/i;
const AGENT_AUTOCOMPLETE_STOP_RE = /(?:^|[ \t])&[a-z0-9_-]*[ \t]$/i;

interface AgentFrontmatter extends Record<string, unknown> {
	name?: unknown;
	description?: unknown;
}

interface NamedSubagentSupport {
	available: boolean;
	supportsProjectScope: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSchemaProperty(schema: unknown, property: string): boolean {
	if (!isRecord(schema)) return false;
	const properties = Reflect.get(schema, "properties");
	return isRecord(properties) && Object.hasOwn(properties, property);
}

function schemaProperty(schema: unknown, property: string): unknown {
	if (!isRecord(schema)) return undefined;
	const properties = Reflect.get(schema, "properties");
	return isRecord(properties) ? Reflect.get(properties, property) : undefined;
}

function supportsExecuteAction(schema: unknown): boolean {
	const action = schemaProperty(schema, "action");
	if (!isRecord(action)) return false;
	const values: unknown = Reflect.get(action, "enum");
	return Array.isArray(values) && values.some((value: unknown) => value === "execute");
}

function supportsCompactAgentInput(
	parameters: unknown,
	description: string | undefined,
): boolean {
	const input = schemaProperty(parameters, "input");
	if (!isRecord(input)) return false;
	const isOpenInput =
		Reflect.get(input, "type") === "object" &&
		Reflect.get(input, "additionalProperties") === true;
	const directExecuteExample = /\{\s*action\s*:\s*['"]execute['"]\s*,\s*input\s*:\s*\{\s*agent\s*:/.test(
		description ?? "",
	);
	return isOpenInput && supportsExecuteAction(parameters) && directExecuteExample;
}

/** Detect subagent tools that support named agent execution and input-scoped options. */
export function getNamedSubagentSupport(
	pi: Pick<ExtensionAPI, "getAllTools">,
): NamedSubagentSupport {
	const tool = pi.getAllTools().find((candidate) => candidate.name === "subagent");
	if (!tool || !isRecord(tool.parameters)) {
		return { available: false, supportsProjectScope: false };
	}

	const inputSchema = schemaProperty(tool.parameters, "input");
	const compactInput = supportsCompactAgentInput(tool.parameters, tool.description);
	const hasInputAgent = hasSchemaProperty(inputSchema, "agent");
	const supportsProjectScope = hasSchemaProperty(inputSchema, "agentScope") || compactInput;
	const available = (hasInputAgent && supportsExecuteAction(tool.parameters)) || compactInput;
	return { available, supportsProjectScope };
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function agentFiles(directory: string): string[] {
	if (!isDirectory(directory)) return [];
	const files: string[] = [];
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	} catch {
		return [];
	}

	for (const entry of entries) {
		const filePath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...agentFiles(filePath));
		} else if (
			entry.name.endsWith(".md") &&
			(entry.isFile() || entry.isSymbolicLink())
		) {
			files.push(filePath);
		}
	}
	return files;
}

function loadAgentsFromDirectory(
	directory: string,
	source: AgentDefinition["source"],
): AgentDefinition[] {
	const agents: AgentDefinition[] = [];
	for (const filePath of agentFiles(directory)) {
		try {
			const { frontmatter } = parseFrontmatter<AgentFrontmatter>(readFileSync(filePath, "utf8"));
			const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
			if (!AGENT_NAME_RE.test(name)) continue;
			const description =
				typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
			agents.push({
				kind: "agent",
				name,
				token: `&${name}`,
				filePath,
				source,
				...(description ? { description } : {}),
			});
		} catch {
			// A malformed agent file must not hide other usable definitions.
		}
	}
	return agents;
}

function nearestProjectAgentsDirectory(cwd: string): string | undefined {
	let current = cwd;
	while (true) {
		const candidate = join(current, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** Discover file-backed user agents and only trusted project agents. */
export function discoverAgentDefinitions(
	cwd: string,
	includeProject: boolean,
): AgentDefinition[] {
	const agents = new Map<string, AgentDefinition>();
	for (const agent of loadAgentsFromDirectory(join(getAgentDir(), "agents"), "user")) {
		agents.set(agent.name.toLowerCase(), agent);
	}
	if (includeProject) {
		const projectDirectory = nearestProjectAgentsDirectory(cwd);
		if (projectDirectory) {
			for (const agent of loadAgentsFromDirectory(projectDirectory, "project")) {
				agents.set(agent.name.toLowerCase(), agent);
			}
		}
	}
	return [...agents.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function isAgentDefinition(definition: InlineIdentifierDefinition): definition is AgentDefinition {
	return definition.kind === "agent";
}

function agentAliasPattern(names: string[]): RegExp | undefined {
	if (names.length === 0) return undefined;
	const alternatives = [...names]
		.sort((left, right) => right.length - left.length)
		.map(escapeIdentifierRegex)
		.join("|");
	return new RegExp(`${AGENT_TOKEN_START}&(${alternatives})${AGENT_TOKEN_END}`, "gi");
}

/** Find known agent tokens with upstream token boundaries and source offsets. */
export function findAgentReferences(
	text: string,
	definitions: InlineIdentifierDefinition[],
): InlineIdentifierReference[] {
	const byName = new Map(
		definitions
			.filter(isAgentDefinition)
			.map((definition) => [definition.name.toLowerCase(), definition]),
	);
	const pattern = agentAliasPattern(
		definitions.filter(isAgentDefinition).map((definition) => definition.name),
	);
	if (!pattern) return [];

	const references: InlineIdentifierReference[] = [];
	for (const match of text.matchAll(pattern)) {
		const definition = match[1] ? byName.get(match[1].toLowerCase()) : undefined;
		if (definition && match.index !== undefined) {
			references.push({
				kind: "agent",
				name: definition.name,
				offset: match.index,
				filePath: definition.filePath,
				source: definition.source,
			});
		}
	}
	return references;
}

/** Color discovered agent tokens without changing terminal-visible line width. */
export function colorizeAgentAliases(
	line: string,
	definitions: InlineIdentifierDefinition[],
): string {
	const agents = definitions.filter(isAgentDefinition);
	if (agents.length === 0 || !line.includes("&")) return line;
	const pattern = agentAliasPattern(agents.map((definition) => definition.name));
	if (!pattern) return line;
	return line.replace(pattern, (match) => {
		const color = getInlineIdentifierColor("agent");
		return color ? `${color}${match}\x1b[39m` : match;
	});
}

function resolveAgentReference(
	reference: InlineIdentifierReference,
): { ok: true; value: ResolvedInlineIdentifier } | { ok: false; reason: string } {
	if (reference.kind !== "agent") {
		return { ok: false, reason: "the agent resolver received a different identifier category" };
	}
	try {
		const { frontmatter } = parseFrontmatter<AgentFrontmatter>(
			readFileSync(reference.filePath, "utf8"),
		);
		const currentName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
		if (currentName.toLowerCase() !== reference.name.toLowerCase()) {
			return { ok: false, reason: `agent file no longer defines ${reference.name}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown file read error";
		return { ok: false, reason: `failed to read agent file ${reference.filePath}: ${message}` };
	}

	const projectScope =
		reference.source === "project"
			? " Set input.agentScope to 'both' so Pi can use this trusted project agent."
			: "";
	const block =
		`Delegate this task to the "${reference.name}" subagent by calling subagent with ` +
		`{ action: "execute", input: { agent: "${reference.name}", task: <the full Original request below> } }. ` +
		`Pass the full Original request below as its task.${projectScope}`;
	return {
		ok: true,
		value: {
			kind: "agent",
			name: reference.name,
			offset: reference.offset,
			source: reference.source,
			block,
		},
	};
}

/** Build the trusted agent feature for the supported nested subagent API. */
export function createAgentIdentifierFeature(
	pi: Pick<ExtensionAPI, "getAllTools">,
): InlineIdentifierFeature {
	let cachedKey: string | undefined;
	let cachedDefinitions: AgentDefinition[] = [];
	const listDefinitions = (ctx: ExtensionContext): AgentDefinition[] => {
		const support = getNamedSubagentSupport(pi);
		if (!support.available) return [];
		const includeProject = support.supportsProjectScope && ctx.isProjectTrusted();
		const key = `${ctx.cwd}\0${includeProject}`;
		if (cachedKey !== key) {
			cachedKey = key;
			cachedDefinitions = discoverAgentDefinitions(ctx.cwd, includeProject);
		}
		return cachedDefinitions;
	};

	return {
		kind: "agent",
		triggerCharacter: "&",
		listDefinitions,
		matchAutocomplete(beforeCursor) {
			if (AGENT_AUTOCOMPLETE_STOP_RE.test(beforeCursor)) return "stop";
			const prefix = beforeCursor.match(AGENT_AUTOCOMPLETE_RE)?.[1];
			return prefix ? { prefix, query: prefix.slice(1) } : undefined;
		},
		findReferences: findAgentReferences,
		resolveReference: (reference) => resolveAgentReference(reference),
		colorizeLine: colorizeAgentAliases,
	};
}
