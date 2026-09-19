import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitOutputIntoChunks } from "./output-chunk-split.ts";

function numberedLines(count: number): string {
	return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

describe("splitOutputIntoChunks", () => {
	it("groups lines into chunks of the requested size", () => {
		const chunks = splitOutputIntoChunks(numberedLines(100), 20, 200);
		assert.equal(chunks.length, 5);
		assert.deepEqual(
			chunks.map((chunk) => chunk.id),
			["c1", "c2", "c3", "c4", "c5"],
		);
		assert.deepEqual(
			chunks.map((chunk) => chunk.lineCount),
			[20, 20, 20, 20, 20],
		);
		assert.equal(chunks[0]?.text, numberedLines(20));
	});

	it("keeps the last partial chunk", () => {
		const chunks = splitOutputIntoChunks(numberedLines(45), 20, 200);
		assert.deepEqual(
			chunks.map((chunk) => chunk.lineCount),
			[20, 20, 5],
		);
	});

	it("widens chunks rather than dropping lines when the cap would be exceeded", () => {
		const chunks = splitOutputIntoChunks(numberedLines(100), 20, 2);
		assert.equal(chunks.length, 2);
		assert.deepEqual(
			chunks.map((chunk) => chunk.lineCount),
			[50, 50],
		);
		assert.equal(chunks.map((chunk) => chunk.text).join("\n"), numberedLines(100));
	});

	it("splits a single over-long line so it cannot become an untrimmable chunk", () => {
		const chunks = splitOutputIntoChunks("x".repeat(4_500), 20, 200);
		assert.equal(chunks.length, 1);
		assert.equal(chunks[0]?.lineCount, 3);
		assert.equal(chunks[0]?.text.length, 4_500 + 2);
	});

	it("reconstructs the input exactly when chunks are joined", () => {
		const output = numberedLines(37);
		const chunks = splitOutputIntoChunks(output, 10, 200);
		assert.equal(chunks.map((chunk) => chunk.text).join("\n"), output);
	});
});
