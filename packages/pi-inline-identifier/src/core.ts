import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	Editor,
	visibleWidth,
} from "@earendil-works/pi-tui";

const IDENTIFIER_KINDS = ["skill", "prompt", "agent"] as const;
type InlineIdentifierKind = (typeof IDENTIFIER_KINDS)[number];

const IDENTIFIER_COLOR_TOKENS: Record<InlineIdentifierKind, ThemeColor> = {
	skill: "mdLink",
	prompt: "accent",
	agent: "borderAccent",
};
const IDENTIFIER_COLORS_KEY = Symbol.for("kg.pi.inlineIdentifier.colors.v1");
const DECORATION_STATE_KEY = Symbol.for("kg.pi.inlineIdentifier.decorationState.v1");
const EDITOR_PATCH_VERSION = 1;
const MAX_AUTOCOMPLETE_ITEMS = 20;

/** Skill metadata available to inline identifier discovery. */
export interface SkillDefinition {
	kind: "skill";
	name: string;
	token: string;
	filePath: string;
	description?: string;
}

/** Named subagent metadata from trusted user or project agent files. */
export interface AgentDefinition {
	kind: "agent";
	name: string;
	token: string;
	filePath: string;
	source: "user" | "project";
	description?: string;
}

/** Prompt template metadata available to inline identifier discovery. */
export interface PromptDefinition {
	kind: "prompt";
	name: string;
	token: string;
	filePath: string;
	description?: string;
}

/** A discovered inline identifier category and its completion metadata. */
export type InlineIdentifierDefinition = SkillDefinition | AgentDefinition | PromptDefinition;

/** A known identifier's first source offset and the resource it resolves to. */
export type InlineIdentifierReference =
	| { kind: "skill"; name: string; offset: number; filePath: string }
	| {
			kind: "agent";
			name: string;
			offset: number;
			filePath: string;
			source: "user" | "project";
	  }
	| { kind: "prompt"; name: string; offset: number; filePath: string };

/** A fully resolved inline reference rendered as one instruction block. */
export type ResolvedInlineIdentifier =
	| { kind: "skill"; name: string; offset: number; block: string }
	| { kind: "agent"; name: string; offset: number; source: "user" | "project"; block: string }
	| { kind: "prompt"; name: string; offset: number; block: string };

/** A resource resolution result; failures prevent partial request transformation. */
export type InlineIdentifierResolution =
	| { kind: "ready"; items: readonly ResolvedInlineIdentifier[] }
	| { kind: "failed"; reference: InlineIdentifierReference; reason: string };

/** The first character of a reference prefix and the text before its query. */
export type AutocompleteMatch = { prefix: string; query: string } | "stop" | undefined;

/** Category-owned matching, resolution, and rendering for the shared coordinator. */
export interface InlineIdentifierFeature {
	kind: InlineIdentifierKind;
	triggerCharacter: string;
	listDefinitions(ctx: ExtensionContext): InlineIdentifierDefinition[];
	matchAutocomplete(beforeCursor: string): AutocompleteMatch;
	findReferences(
		text: string,
		definitions: InlineIdentifierDefinition[],
	): InlineIdentifierReference[];
	resolveReference(
		reference: InlineIdentifierReference,
		request: string,
		ctx: ExtensionContext,
	): { ok: true; value: ResolvedInlineIdentifier } | { ok: false; reason: string };
	colorizeLine(line: string, definitions: InlineIdentifierDefinition[]): string;
}

interface Coordinator {
	features: Map<InlineIdentifierKind, InlineIdentifierFeature>;
	decorationOwner: object;
}

interface DecorationState {
	decorateLines?: (lines: string[]) => string[];
	owner?: object;
	patchedPrototypes?: WeakSet<object>;
	patchVersion?: number;
}

/** Match a leading slash command that Pi must expand natively. */
export function isNativeSlashInput(text: string): boolean {
	return (text.split("\n", 1)[0] ?? "").trimStart().startsWith("/");
}

/** Read the session theme color selected for one inline identifier category. */
export function getInlineIdentifierColor(
	kind: InlineIdentifierKind,
): string | undefined {
	const colors: unknown = Reflect.get(globalThis, IDENTIFIER_COLORS_KEY);
	if (typeof colors !== "object" || colors === null || Array.isArray(colors)) return undefined;
	const color: unknown = Reflect.get(colors, kind);
	return typeof color === "string" ? color : undefined;
}

/** Escape text before inserting it into a regular expression. */
export function escapeIdentifierRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDecorationState(value: unknown): value is DecorationState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const decorateLines: unknown = Reflect.get(value, "decorateLines");
	const owner: unknown = Reflect.get(value, "owner");
	const patchedPrototypes: unknown = Reflect.get(value, "patchedPrototypes");
	const patchVersion: unknown = Reflect.get(value, "patchVersion");
	return (
		(decorateLines === undefined || typeof decorateLines === "function") &&
		(owner === undefined || (typeof owner === "object" && owner !== null)) &&
		(patchedPrototypes === undefined || patchedPrototypes instanceof WeakSet) &&
		(patchVersion === undefined || typeof patchVersion === "number")
	);
}

function decorationState(): DecorationState {
	const existing: unknown = Reflect.get(globalThis, DECORATION_STATE_KEY);
	if (isDecorationState(existing)) return existing;

	const state: DecorationState = {};
	Reflect.set(globalThis, DECORATION_STATE_KEY, state);
	return state;
}

function isStringArray(value: unknown): value is string[] {
	if (!Array.isArray(value)) return false;
	for (const item of value) {
		if (typeof item !== "string") return false;
	}
	return true;
}

function escapeCharacterClass(character: string): string {
	return character.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
}

function triggerPattern(characters: string[]): RegExp {
	const escaped = characters.map(escapeCharacterClass);
	return new RegExp(`(?:^|[\\s])[${escaped.join("")}][^\\s]*$`);
}

function debouncePattern(characters: string[]): RegExp {
	const escapedWithoutAt = characters
		.filter((character) => character !== "@")
		.map(escapeCharacterClass);
	return new RegExp(
		`(?:^|[ \\t])(?:@(?:"[^"]*|[^\\s]*)|[${escapedWithoutAt.join("")}][^\\s]*)$`,
	);
}

function patchEditorPrototype(
	prototype: object,
	state: DecorationState,
	suppressNestedDecoration = false,
): void {
	const patched = state.patchedPrototypes ?? new WeakSet<object>();
	state.patchedPrototypes = patched;
	if (patched.has(prototype)) return;

	const originalRender: unknown = Reflect.get(prototype, "render");
	if (typeof originalRender !== "function") return;
	const renderWithInlineIdentifiers = function renderWithInlineIdentifiers(
		this: unknown,
		width: number,
	): string[] {
		const lines: unknown = Reflect.apply(originalRender, this, [width]);
		if (!isStringArray(lines)) {
			throw new Error("Inline identifier editor render expected string lines.");
		}
		const decorateLines = decorationState().decorateLines;
		if (!decorateLines) return lines;
		if (!suppressNestedDecoration) return decorateLines(lines);

		const currentState = decorationState();
		delete currentState.decorateLines;
		try {
			return decorateLines(lines);
		} finally {
			currentState.decorateLines = decorateLines;
		}
	};
	Reflect.set(prototype, "render", renderWithInlineIdentifiers);

	const originalSetTriggers: unknown = Reflect.get(prototype, "setAutocompleteTriggerCharacters");
	if (typeof originalSetTriggers === "function") {
		const setTriggersWithInlineSlash = function setTriggersWithInlineSlash(
			this: unknown,
			characters: string[],
		): void {
			Reflect.apply(originalSetTriggers, this, [characters]);
			if (!characters.includes("/") || typeof this !== "object" || this === null) return;

			const active: unknown = Reflect.get(this, "autocompleteTriggerCharacters");
			if (!isStringArray(active) || active.includes("/")) return;
			active.push("/");
			Reflect.set(this, "autocompleteTriggerCharacters", active);
			Reflect.set(this, "autocompleteTriggerPattern", triggerPattern(active));
			Reflect.set(this, "autocompleteDebouncePattern", debouncePattern(active));
		};
		Reflect.set(prototype, "setAutocompleteTriggerCharacters", setTriggersWithInlineSlash);
	}

	patched.add(prototype);
}

function installEditorRenderPatch(): void {
	const state = decorationState();
	if (state.patchVersion !== EDITOR_PATCH_VERSION) {
		state.patchedPrototypes = new WeakSet<object>();
		state.patchVersion = EDITOR_PATCH_VERSION;
	}

	patchEditorPrototype(Editor.prototype, state);

	const customInheritsEditor = Editor.prototype.isPrototypeOf(CustomEditor.prototype);
	const customHasOwnRender = Object.prototype.hasOwnProperty.call(
		CustomEditor.prototype,
		"render",
	);
	if (!customInheritsEditor || customHasOwnRender) {
		patchEditorPrototype(
			CustomEditor.prototype,
			state,
			customInheritsEditor && customHasOwnRender,
		);
	}
}

function definitionsFor(
	feature: InlineIdentifierFeature,
	ctx: ExtensionContext,
): InlineIdentifierDefinition[] {
	try {
		return feature.listDefinitions(ctx);
	} catch {
		return [];
	}
}

function createAutocompleteProvider(
	current: AutocompleteProvider,
	coordinator: Coordinator,
	ctx: ExtensionContext,
): AutocompleteProvider {
	return {
		triggerCharacters: [...coordinator.features.values()].map(
			(feature) => feature.triggerCharacter,
		),

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			if ((lines[0] ?? "").trimStart().startsWith("/")) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
			for (const feature of coordinator.features.values()) {
				const match = feature.matchAutocomplete(beforeCursor);
				if (match === "stop") {
					return options.force
						? current.getSuggestions(lines, cursorLine, cursorCol, options)
						: null;
				}
				if (!match) continue;

				const query = match.query.toLowerCase();
				const startsWithQuery = (name: string) => name.toLowerCase().startsWith(query);
				const items: AutocompleteItem[] = definitionsFor(feature, ctx)
					.filter((definition) => definition.name.toLowerCase().includes(query))
					.sort(
						(a, b) =>
							Number(startsWithQuery(b.name)) - Number(startsWithQuery(a.name)),
					)
					.slice(0, MAX_AUTOCOMPLETE_ITEMS)
					.map((definition) => ({
						value: definition.token,
						label: definition.token,
						...(definition.description ? { description: definition.description } : {}),
					}));
				if (items.length > 0) return { prefix: match.prefix, items };
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const promptFeature = coordinator.features.get("prompt");
			const isInlinePrompt =
				!(lines[0] ?? "").trimStart().startsWith("/") &&
				prefix.startsWith("/") &&
				promptFeature !== undefined &&
				definitionsFor(promptFeature, ctx).some(
					(definition) => definition.token === item.value,
				);
			if (isInlinePrompt) {
				const line = lines[cursorLine] ?? "";
				const before = line.slice(0, cursorCol - prefix.length);
				const next = [...lines];
				next[cursorLine] = before + item.value + line.slice(cursorCol);
				return {
					lines: next,
					cursorLine,
					cursorCol: before.length + item.value.length,
				};
			}

			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function canonicalReferenceName(reference: InlineIdentifierReference): string {
	switch (reference.kind) {
		case "skill":
		case "prompt":
			return reference.name;
		case "agent":
			return reference.name.toLowerCase();
		default: {
			const exhaustive: never = reference;
			return exhaustive;
		}
	}
}

function collectInlineIdentifierReferences(
	text: string,
	coordinator: Coordinator,
	ctx: ExtensionContext,
): InlineIdentifierReference[] {
	const references = new Map<string, InlineIdentifierReference>();
	for (const feature of coordinator.features.values()) {
		if (!text.includes(feature.triggerCharacter)) continue;
		for (const reference of feature.findReferences(text, definitionsFor(feature, ctx))) {
			const key = `${reference.kind}:${canonicalReferenceName(reference)}`;
			if (!references.has(key)) references.set(key, reference);
		}
	}
	return [...references.values()].sort((left, right) => left.offset - right.offset);
}

function resolveInlineIdentifierReferences(
	references: readonly InlineIdentifierReference[],
	request: string,
	coordinator: Coordinator,
	ctx: ExtensionContext,
): InlineIdentifierResolution {
	const items: ResolvedInlineIdentifier[] = [];
	for (const reference of references) {
		const feature = coordinator.features.get(reference.kind);
		if (!feature) {
			return {
				kind: "failed",
				reference,
				reason: "its identifier category is not registered",
			};
		}
		const result = feature.resolveReference(reference, request, ctx);
		if (!result.ok) return { kind: "failed", reference, reason: result.reason };
		items.push(result.value);
	}
	return { kind: "ready", items };
}

function originalRequestTail(request: string): string {
	return `Original request:\n${request}`;
}

function composeInlineIdentifierRequest(
	request: string,
	items: readonly ResolvedInlineIdentifier[],
): string {
	const instructionBlocks = items.map((item) => item.block);
	return `${instructionBlocks.join("\n\n---\n\n")}\n\n---\n\n${originalRequestTail(request)}`;
}

function notifyResolutionFailure(
	ctx: ExtensionContext,
	resolution: Extract<InlineIdentifierResolution, { kind: "failed" }>,
): void {
	const token = `${resolution.reference.kind}:${resolution.reference.name}`;
	ctx.ui.notify(
		`Inline identifier could not be expanded (${token}): ${resolution.reason}. The original request was left unchanged.`,
		"warning",
	);
}

function preserveInputImages(event: InputEvent): { images?: InputEvent["images"] } {
	return event.images ? { images: event.images } : {};
}

function installCoordinator(pi: ExtensionAPI, coordinator: Coordinator): void {
	pi.on("session_start", (event, ctx) => {
		void event;
		if (ctx.mode !== "tui") return;

		const colors: Partial<Record<InlineIdentifierKind, string>> = {};
		for (const kind of IDENTIFIER_KINDS) {
			try {
				colors[kind] = ctx.ui.theme.getFgAnsi(IDENTIFIER_COLOR_TOKENS[kind]);
			} catch {
				// A theme missing a token leaves that identifier kind uncolored.
			}
		}
		Reflect.set(globalThis, IDENTIFIER_COLORS_KEY, colors);

		const decoration = decorationState();
		decoration.owner = coordinator.decorationOwner;
		decoration.decorateLines = (lines) => {
			if (isNativeSlashInput(ctx.ui.getEditorText())) return lines;
			const activeFeatures = [...coordinator.features.values()]
				.filter((feature) =>
					lines.some((line) => line.includes(feature.triggerCharacter)),
				)
				.map((feature) => ({ definitions: definitionsFor(feature, ctx), feature }));
			return lines.map((line) => {
				let decorated = line;
				for (const { definitions, feature } of activeFeatures) {
					if (!decorated.includes(feature.triggerCharacter)) continue;
					decorated = feature.colorizeLine(decorated, definitions);
				}
				return visibleWidth(decorated) === visibleWidth(line) ? decorated : line;
			});
		};
		installEditorRenderPatch();
		ctx.ui.addAutocompleteProvider((current) =>
			createAutocompleteProvider(current, coordinator, ctx),
		);
	});

	pi.on("session_shutdown", (event) => {
		void event;
		const decoration = decorationState();
		if (decoration.owner === coordinator.decorationOwner) {
			delete decoration.decorateLines;
			delete decoration.owner;
			Reflect.deleteProperty(globalThis, IDENTIFIER_COLORS_KEY);
		}
		coordinator.features.clear();
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || isNativeSlashInput(event.text)) {
			return { action: "continue" };
		}

		const references = collectInlineIdentifierReferences(event.text, coordinator, ctx);
		if (references.length === 0) return { action: "continue" };

		const resolution = resolveInlineIdentifierReferences(references, event.text, coordinator, ctx);
		if (resolution.kind === "failed") {
			notifyResolutionFailure(ctx, resolution);
			return { action: "continue" };
		}

		if (resolution.items.length === 1) {
			const [item] = resolution.items;
			if (item?.kind === "skill") {
				return {
					action: "transform",
					text: `/skill:${item.name} ${event.text}`,
					...preserveInputImages(event),
				};
			}
		}

		return {
			action: "transform",
			text: composeInlineIdentifierRequest(event.text, resolution.items),
			...preserveInputImages(event),
		};
	});
}

/** Register one coordinator for all identifier categories in this extension. */
export function registerInlineIdentifierCoordinator(
	pi: ExtensionAPI,
	features: readonly InlineIdentifierFeature[],
): void {
	const coordinator: Coordinator = {
		features: new Map(features.map((feature) => [feature.kind, feature])),
		decorationOwner: {},
	};
	installCoordinator(pi, coordinator);
}
