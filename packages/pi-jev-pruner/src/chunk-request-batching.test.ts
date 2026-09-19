import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batchChunksForJevRequests } from "./chunk-request-batching.ts";
import { splitOutputIntoChunks } from "./output-chunk-split.ts";
import { buildOutputRelevanceState } from "./output-relevance-state.ts";
import type { OutputRelevanceStateInput } from "./output-relevance-state.ts";
import { estimateStateTokens } from "./output-token-estimate.ts";

const input: OutputRelevanceStateInput = {
	command: "npm test",
	goal: "fix the failing build",
	history: [],
	categoryGuidance: undefined,
};

function chunkCost(text: string, id: string): number {
	return estimateStateTokens(JSON.stringify({ id, text })) + 1;
}

describe("batchChunksForJevRequests", () => {
	const chunks = splitOutputIntoChunks(
		Array.from({ length: 6 }, (_, index) => `progress step ${index + 1}`).join("\n"),
		2,
		200,
	);

	it("keeps every chunk in one request when the budget is generous", () => {
		const batches = batchChunksForJevRequests(input, chunks, 25_000, 30_000);
		assert.equal(batches.length, 1);
		assert.equal(batches[0]?.chunks.length, 3);
	});

	it("splits into more requests as the budget tightens", () => {
		const base = estimateStateTokens(JSON.stringify(buildOutputRelevanceState(input, [])));
		const budget = base + chunkCost(chunks[0]?.text ?? "", "c1") * 2 + 2;
		const batches = batchChunksForJevRequests(input, chunks, budget, 30_000);
		assert.deepEqual(
			batches.map((batch) => batch.chunks.length),
			[2, 1],
		);
	});

	it("covers every chunk exactly once", () => {
		const base = estimateStateTokens(JSON.stringify(buildOutputRelevanceState(input, [])));
		const budget = base + chunkCost(chunks[0]?.text ?? "", "c1") + 2;
		const batches = batchChunksForJevRequests(input, chunks, budget, 30_000);
		const ids = batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.id));
		assert.deepEqual(ids, ["c1", "c2", "c3"]);
	});

	it("reports a chunk that cannot fit instead of skipping it", () => {
		const base = estimateStateTokens(JSON.stringify(buildOutputRelevanceState(input, [])));
		assert.throws(
			() => batchChunksForJevRequests(input, chunks, base, 30_000),
			/leaves no room for the question about c1/,
		);
	});

	it("carries the shared state on every batch", () => {
		const base = estimateStateTokens(JSON.stringify(buildOutputRelevanceState(input, [])));
		const budget = base + chunkCost(chunks[0]?.text ?? "", "c1") + 2;
		const batches = batchChunksForJevRequests(input, chunks, budget, 30_000);
		for (const batch of batches) {
			assert.equal(batch.state.command, "npm test");
			assert.equal(batch.state.task, "fix the failing build");
		}
	});
});
