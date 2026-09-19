import { simpleCommand } from "./simple-command.ts";

/**
 * Relevance guidance for a command whose output shape is already known, or `undefined` when the
 * command gives no useful signal.
 *
 * The category never decides what to discard on its own; it only tells Jev what a command of this
 * kind usually makes worth keeping.
 */
export interface CommandCategoryGuidance {
	/** Recognized command family. */
	category: "build" | "search";
	/** What to retain for this family, added to the shared relevance question. */
	guidance: string;
}

const BUILD_GUIDANCE =
	"Build, install, or test log: retain diagnostics, failing test names, stack traces, result counts, final status, artifact paths, and values the task requires. Repeated progress, cache hits, download progress, and duplicate success messages may be noise. A single needed line protects its entire chunk.";

const SEARCH_GUIDANCE =
	"Search results or file excerpts: matching source text, file paths, line numbers, and surrounding context are evidence for the investigation. Judge relevance against the task and history; repetition alone does not make a match disposable. Retain evidence needed to compare matches or to establish absence, counts, or completeness when the task asks for them.";

const BUILD_COMMAND = new RegExp(
	[
		"^(make|gmake|ninja|pytest|jest|vitest|ctest|mvn|gradle|gradlew)(?:\\s|$)",
		"^(npm|pnpm|yarn|bun)\\s+(?:(?:run\\s+)?(?:build|test|lint|typecheck|check)(?::[\\w-]+)*|install|ci|add)(?:\\s|$)",
		"^(cargo|go)\\s+(build|test|check|clippy|install)(?:\\s|$)",
		"^cmake\\s+--build(?:\\s|$)",
		"^(pip[23]?|uv\\s+pip)\\s+install(?:\\s|$)",
		"^python(?:[23](?:\\.\\d+)?)?\\s+-m\\s+(pytest|unittest|build|pip\\s+install)(?:\\s|$)",
	].join("|"),
);

const SEARCH_COMMAND = /^(rg|grep|egrep|fgrep|find|fd|head|tail|sed|git\s+grep)(?:\s|$)/;

/**
 * Describes what a recognized build, install, test, or search command makes worth retaining.
 *
 * Compound commands and wrappers are not recognized; they fall back to the shared relevance
 * question, because guessing a category from a pipeline would mislead the retention decision.
 */
export function commandCategoryGuidance(command: string): CommandCategoryGuidance | undefined {
	const simple = simpleCommand(command);
	if (BUILD_COMMAND.test(simple)) {
		return { category: "build", guidance: BUILD_GUIDANCE };
	}
	if (SEARCH_COMMAND.test(simple)) {
		return { category: "search", guidance: SEARCH_GUIDANCE };
	}
	return undefined;
}
