import { batchChunksForJevRequests } from "./chunk-request-batching.ts";
import { commandCategoryGuidance } from "./command-category.ts";
import { buildNoulRequest, noulQuestionForChunk } from "./jev-client.ts";
import type { JevAsker } from "./jev-asker.ts";
import { outputArchiveMarker } from "./output-archive.ts";
import type { OutputArchiveTarget } from "./output-archive.ts";
import { splitOutputIntoChunks } from "./output-chunk-split.ts";
import type { OutputChunk } from "./output-chunk-split.ts";
import { buildOutputRelevanceState } from "./output-relevance-state.ts";
import type { OutputRelevanceStateInput } from "./output-relevance-state.ts";
import { findOutputSkipReason } from "./output-safety.ts";
import { estimateOutputTokens, estimateStateTokens } from "./output-token-estimate.ts";
import type { JevPrunerConfig } from "./jev-pruner-config.ts";
import { conversationGoal, fitTurnsToTokenBudget } from "./session-history.ts";
import type { ConversationTurn } from "./session-history.ts";

/** Tuning for one prune run. Every value comes from the extension configuration. */
export interface OutputPruneOptions {
	/** Estimated token count above which output is worth pruning. */
	minTokens: number;
	/** Lines per chunk before the chunk cap widens them. */
	chunkLines: number;
	/** Noul probability at or above which a chunk is kept. */
	keepThreshold: number;
	/** Token budget one request's state may use. */
	maxStateTokens: number;
	/** Maximum number of Jev requests one prune run may make. */
	maxScoringRequests: number;
	/** Maximum chunks before chunk size widens to stay under it. */
	maxChunks: number;
	/** Hard cap on one request's total size, including questions. */
	requestTokenBudget: number;
	/** Jev model name. */
	model: string;
}

/** One prunable tool result. */
export interface OutputPruneInput {
	/** The command whose output is being scored. */
	command: string;
	/** Output text to prune, which is the complete stream rather than a preview. */
	output: string;
	/** Recent conversation turns, oldest first. */
	history: readonly ConversationTurn[];
	/** Where the complete output can be read back once lines are dropped. */
	archive: OutputArchiveTarget | undefined;
}

/** Output that was pruned, with the evidence used to decide. */
export interface PrunedOutput {
	kind: "pruned";
	/** Pruned text, with a marker standing in for every run of dropped lines. */
	output: string;
	/** Chunks the output was split into. */
	totalChunks: number;
	/** Chunks that survived. */
	keptChunks: number;
	/** Lines replaced by markers. */
	droppedLines: number;
	/** Highest probability seen per chunk, in chunk order. */
	probabilities: readonly number[];
}

/** Output left exactly as the bash tool produced it. */
export interface UnprunedOutput {
	kind: "unpruned";
	/** Why nothing was dropped, which is also what the status command reports. */
	reason:
		| "empty"
		| "binary"
		| "structured"
		| "secret"
		| "below-threshold"
		| "too-few-chunks"
		| "kept-everything";
}

export type OutputPruneOutcome = PrunedOutput | UnprunedOutput;

export const MAX_CHUNKS = 200;
/** Hard cap on one request's total size, leaving room for questions inside Jev's state limit. */
export const REQUEST_TOKEN_BUDGET = 30_000;
const MIN_RETRY_STATE_TOKENS = 4_000;

/** Maps the extension configuration onto one prune run's tuning. */
export function pruneOptionsFromConfig(config: JevPrunerConfig): OutputPruneOptions {
	return {
		minTokens: config.minTokens,
		chunkLines: config.chunkLines,
		keepThreshold: config.keepThreshold,
		maxStateTokens: config.maxStateTokens,
		maxScoringRequests: config.maxScoringRequests,
		maxChunks: MAX_CHUNKS,
		requestTokenBudget: REQUEST_TOKEN_BUDGET,
		model: config.model,
	};
}

// Deliberately narrow: this pattern overrides Jev, so it must catch a reported failure without
// catching a file called serialize-error.js in a directory listing.
const ERROR_PATTERN = new RegExp(
	[
		"\\b(ERROR|FATAL|FAILED|FAILURE|PANIC)\\b",
		"\\b(error|failure|exception|panic|traceback|assertion)s?\\s*:",
		"\\b(failed|failing|cannot|could not|unable to|denied|refused|timed out)\\s+\\w",
		"\\b\\w*(Error|Exception)\\b\\s*[:(]",
		"\\bTraceback \\(most recent call last\\)",
		"^\\s*at\\s+\\S+\\(.*:\\d+",
		"\\b(severity )?vulnerabilit(y|ies)\\b",
		"\\bCrashLoopBackOff\\b|\\bOOMKilled\\b",
		"\\bHTTP/[0-9.]+ [45]\\d\\d\\b|\\bstatus[=: ]\\s*[45]\\d\\d\\b",
	].join("|"),
	"m",
);

function stateIsTooLarge(error: unknown): boolean {
	return error instanceof Error && error.message.includes("max_tokens_exceeded");
}

/** Replaces each run of dropped chunks with one marker, leaving kept chunks verbatim. */
function renderPrunedOutput(
	chunks: readonly OutputChunk[],
	keptIndexes: ReadonlySet<number>,
	archive: OutputArchiveTarget | undefined,
): { output: string; droppedLines: number } {
	const parts: string[] = [];
	let pendingLines = 0;
	let droppedLines = 0;
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		if (chunk === undefined) {
			continue;
		}
		if (keptIndexes.has(index)) {
			if (pendingLines > 0) {
				parts.push(outputArchiveMarker(pendingLines, archive));
				pendingLines = 0;
			}
			parts.push(chunk.text);
		} else {
			pendingLines += chunk.lineCount;
			droppedLines += chunk.lineCount;
		}
	}
	if (pendingLines > 0) {
		parts.push(outputArchiveMarker(pendingLines, archive));
	}
	return { output: parts.join("\n"), droppedLines };
}

/**
 * Decides which chunks matter and returns the output with the rest replaced by markers.
 *
 * A chunk is kept when any of these holds: Jev scored it at or above the keep threshold, it
 * matches the error pattern, it could not be scored, or it is the first or last chunk. Anything
 * that throws propagates to the caller, which leaves the original output untouched, because a
 * partial answer would drop text the agent may still need.
 */
async function attemptPrune(
	input: OutputPruneInput,
	asker: JevAsker,
	options: OutputPruneOptions,
): Promise<OutputPruneOutcome> {
	if (estimateOutputTokens(input.output) <= options.minTokens) {
		return { kind: "unpruned", reason: "below-threshold" };
	}
	const chunks = splitOutputIntoChunks(input.output, options.chunkLines, MAX_CHUNKS);
	if (chunks.length <= 2) {
		return { kind: "unpruned", reason: "too-few-chunks" };
	}
	const categoryGuidance = commandCategoryGuidance(input.command);
	const stateInput: OutputRelevanceStateInput = {
		command: input.command,
		goal: conversationGoal(input.history),
		history: [],
		categoryGuidance,
	};
	const allChunksTokens = estimateStateTokens(
		JSON.stringify(buildOutputRelevanceState(stateInput, chunks)),
	);
	const historyBudgetTokens = Math.max(
		1,
		options.maxStateTokens - Math.min(allChunksTokens, Math.ceil(options.maxStateTokens / 2)),
	);
	const scoredStateInput: OutputRelevanceStateInput = {
		...stateInput,
		history: fitTurnsToTokenBudget(input.history, historyBudgetTokens),
	};
	const batches = batchChunksForJevRequests(
		scoredStateInput,
		chunks,
		options.maxStateTokens,
		options.requestTokenBudget,
	);
	const scoredBatches = batches.slice(0, Math.max(1, options.maxScoringRequests));
	const scoredChunkIds = new Set(
		scoredBatches.flatMap((batch) => batch.chunks.map((chunk) => chunk.id)),
	);
	const answers = await Promise.all(
		scoredBatches.map(async (batch) => {
			const questions = batch.chunks.map(noulQuestionForChunk);
			const request = buildNoulRequest(options.model, batch.state, questions, undefined);
			return asker.askChunkRelevance(
				request,
				questions.map((question) => question.id),
			);
		}),
	);
	const probabilities: number[] = chunks.map(() => 0);
	const scored = new Set<number>();
	for (const answer of answers) {
		for (const [id, probability] of answer) {
			const index = chunks.findIndex((chunk) => chunk.id === id);
			if (index < 0) {
				continue;
			}
			probabilities[index] = Math.max(probabilities[index] ?? 0, probability);
			scored.add(index);
		}
	}
	const keptIndexes = new Set<number>();
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		if (chunk === undefined) {
			continue;
		}
		const unscored = !scored.has(index) || !scoredChunkIds.has(chunk.id);
		if (
			unscored ||
			index === 0 ||
			index === chunks.length - 1 ||
			ERROR_PATTERN.test(chunk.text) ||
			(probabilities[index] ?? 0) >= options.keepThreshold
		) {
			keptIndexes.add(index);
		}
	}
	if (keptIndexes.size === chunks.length) {
		return { kind: "unpruned", reason: "kept-everything" };
	}
	const rendered = renderPrunedOutput(chunks, keptIndexes, input.archive);
	return {
		kind: "pruned",
		output: rendered.output,
		totalChunks: chunks.length,
		keptChunks: keptIndexes.size,
		droppedLines: rendered.droppedLines,
		probabilities,
	};
}

/**
 * Prunes one tool result with Jev, retrying once with half the state budget when Jev reports that
 * the request was too large.
 *
 * Output that is binary, structured, credential-like, empty, or too short is reported as unpruned
 * without calling Jev at all.
 */
export async function pruneOutputWithJev(
	input: OutputPruneInput,
	asker: JevAsker,
	options: OutputPruneOptions,
): Promise<OutputPruneOutcome> {
	const skip = findOutputSkipReason(input.command, input.output);
	if (skip !== undefined) {
		return { kind: "unpruned", reason: skip.reason };
	}
	try {
		return await attemptPrune(input, asker, options);
	} catch (error) {
		if (!stateIsTooLarge(error) || options.maxStateTokens < MIN_RETRY_STATE_TOKENS) {
			throw error;
		}
		return await attemptPrune(input, asker, {
			...options,
			maxStateTokens: Math.floor(options.maxStateTokens / 2),
		});
	}
}
