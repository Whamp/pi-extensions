import { estimateStateTokens } from "./output-token-estimate.ts";
import { buildOutputRelevanceState } from "./output-relevance-state.ts";
import type { OutputRelevanceState, OutputRelevanceStateInput } from "./output-relevance-state.ts";
import type { OutputChunk } from "./output-chunk-split.ts";

/** One Jev request: a state to send and the chunks it asks about. */
export interface JevChunkBatch {
	/** State shared by every question in the request. */
	state: OutputRelevanceState;
	/** Chunks this request asks about. */
	chunks: readonly OutputChunk[];
}

/** Token cost of one chunk's question, measured as the state would carry it. */
function chunkQuestionTokens(chunk: OutputChunk): number {
	return estimateStateTokens(JSON.stringify({ id: chunk.id, text: chunk.text })) + 1;
}

/**
 * Groups chunks into requests that fit the state budget, preserving chunk order.
 *
 * A chunk that cannot fit beside any state is rejected rather than silently skipped: skipping it
 * would leave output unscored while the caller believed it had been judged.
 */
export function batchChunksForJevRequests(
	input: OutputRelevanceStateInput,
	chunks: readonly OutputChunk[],
	stateTokenBudget: number,
	requestTokenBudget: number,
): readonly JevChunkBatch[] {
	const baseTokens = estimateStateTokens(JSON.stringify(buildOutputRelevanceState(input, [])));
	const budget = Math.min(stateTokenBudget, requestTokenBudget) - baseTokens;
	const batches: JevChunkBatch[] = [];
	let current: OutputChunk[] = [];
	let currentTokens = 0;
	const flush = (): void => {
		if (current.length === 0) {
			return;
		}
		batches.push({ state: buildOutputRelevanceState(input, current), chunks: current });
		current = [];
		currentTokens = 0;
	};
	for (const chunk of chunks) {
		const cost = chunkQuestionTokens(chunk);
		if (cost > budget) {
			throw new Error(
				`state leaves no room for the question about ${chunk.id} (${cost} > ${budget} tokens)`,
			);
		}
		if (current.length > 0 && currentTokens + cost > budget) {
			flush();
		}
		current.push(chunk);
		currentTokens += cost;
	}
	flush();
	return batches;
}
