import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOutputRelevanceState, OUTPUT_RELEVANCE_CONTEXT } from "./output-relevance-state.ts";
import type { OutputChunk } from "./output-chunk-split.ts";

const CHUNKS: readonly OutputChunk[] = [
	{ id: "c1", text: "line one", lineCount: 1, charCount: 8 },
	{ id: "c2", text: "line two", lineCount: 1, charCount: 8 },
];

const INPUT = { command: "npm test", goal: "fix the build", history: [], categoryGuidance: undefined };

describe("buildOutputRelevanceState", () => {
	it("carries the shared context, task, and command", () => {
		const state = buildOutputRelevanceState(INPUT, CHUNKS);
		assert.equal(state.context, OUTPUT_RELEVANCE_CONTEXT);
		assert.equal(state.task, "fix the build");
		assert.equal(state.command, "npm test");
	});

	it("sends only the id and text of each chunk", () => {
		const state = buildOutputRelevanceState(INPUT, CHUNKS);
		assert.deepEqual(state.chunks, [
			{ id: "c1", text: "line one" },
			{ id: "c2", text: "line two" },
		]);
	});

	it("leaves category fields off when no category was recognized", () => {
		const state = buildOutputRelevanceState(INPUT, CHUNKS);
		assert.equal(state.category, undefined);
		assert.equal(state.categoryGuidance, undefined);
	});

	it("adds category and guidance together when one was recognized", () => {
		const state = buildOutputRelevanceState(
			{ ...INPUT, categoryGuidance: { category: "build", guidance: "keep diagnostics" } },
			CHUNKS,
		);
		assert.equal(state.category, "build");
		assert.equal(state.categoryGuidance, "keep diagnostics");
	});

	it("keeps the history it was given", () => {
		const history = [{ role: "user" as const, text: "make the tests pass" }];
		assert.deepEqual(buildOutputRelevanceState({ ...INPUT, history }, CHUNKS).history, history);
	});
});
