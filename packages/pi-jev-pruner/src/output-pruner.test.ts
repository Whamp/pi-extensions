import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JevAsker } from "./jev-asker.ts";
import type { OutputArchiveTarget } from "./output-archive.ts";
import { pruneOutputWithJev } from "./output-pruner.ts";
import type { OutputPruneOptions } from "./output-pruner.ts";
import type { ConversationTurn } from "./session-history.ts";

const OPTIONS: OutputPruneOptions = {
	minTokens: 20,
	chunkLines: 2,
	keepThreshold: 0.5,
	maxStateTokens: 25_000,
	maxScoringRequests: 8,
	maxChunks: 200,
	requestTokenBudget: 30_000,
	model: "jev-latest",
};

const NO_HISTORY: readonly ConversationTurn[] = [];
const ARCHIVE: OutputArchiveTarget = { path: ".pi/jev-pruner/bash-call_1.txt", alreadyWritten: false };

/** Ten lines, so `chunkLines: 2` gives chunks c1..c5. */
function progressLines(): string {
	return Array.from({ length: 10 }, (_, index) => `progress step ${index + 1} complete`).join("\n");
}

interface RecordedAsk {
	chunkIds: readonly string[];
}

/** Records what was asked and answers `decide(id)`, so tests can drive the keep decision. */
function recordingAsker(decide: (id: string, call: number) => number): {
	asker: JevAsker;
	calls: RecordedAsk[];
} {
	const calls: RecordedAsk[] = [];
	const asker: JevAsker = {
		async askChunkRelevance(_request, expectedQuestionIds) {
			calls.push({ chunkIds: [...expectedQuestionIds] });
			return new Map(expectedQuestionIds.map((id) => [id, decide(id, calls.length)]));
		},
	};
	return { asker, calls };
}

describe("pruneOutputWithJev", () => {
	it("leaves output below the gate untouched without calling Jev", async () => {
		const { asker, calls } = recordingAsker(() => 0);
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: "ok", history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.deepEqual(outcome, { kind: "unpruned", reason: "below-threshold" });
		assert.equal(calls.length, 0);
	});

	it("leaves structured output untouched without calling Jev", async () => {
		const { asker, calls } = recordingAsker(() => 0);
		const output = JSON.stringify({ items: Array.from({ length: 40 }, (_, index) => ({ index })) }, null, 2);
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output, history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.deepEqual(outcome, { kind: "unpruned", reason: "structured" });
		assert.equal(calls.length, 0);
	});

	it("leaves output that is only one or two chunks untouched", async () => {
		const { asker } = recordingAsker(() => 0);
		const output = `${"a".repeat(200)}\n${"b".repeat(200)}`;
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output, history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.deepEqual(outcome, { kind: "unpruned", reason: "too-few-chunks" });
	});

	it("drops scored noise and marks the gap with the archive path", async () => {
		const { asker } = recordingAsker(() => 0);
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.equal(outcome.kind, "pruned");
		if (outcome.kind !== "pruned") {
			return;
		}
		assert.equal(outcome.totalChunks, 5);
		assert.equal(outcome.keptChunks, 2, "first and last chunks stay");
		assert.equal(outcome.droppedLines, 6);
		assert.match(outcome.output, /progress step 1 complete/);
		assert.match(
			outcome.output,
			/\[jev-pruner dropped 6 lines; full output: \.pi\/jev-pruner\/bash-call_1\.txt \(read or grep it if needed\)\]/,
		);
		assert.doesNotMatch(outcome.output, /progress step 4 complete/);
	});

	it("keeps a chunk Jev scored above the threshold", async () => {
		const { asker } = recordingAsker((id) => (id === "c3" ? 0.9 : 0));
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.equal(outcome.kind, "pruned");
		if (outcome.kind !== "pruned") {
			return;
		}
		assert.equal(outcome.keptChunks, 3);
		assert.match(outcome.output, /progress step 5 complete/);
		assert.equal(outcome.probabilities[2], 0.9);
	});

	it("keeps a chunk that reports a failure whatever Jev answered", async () => {
		const lines = Array.from({ length: 10 }, (_, index) => `progress step ${index + 1} complete`);
		lines[2] = "ERROR: cannot resolve module ./missing";
		const { asker } = recordingAsker(() => 0);
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: lines.join("\n"), history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.equal(outcome.kind, "pruned");
		if (outcome.kind !== "pruned") {
			return;
		}
		assert.match(outcome.output, /ERROR: cannot resolve module/);
	});

	it("keeps every chunk it could not score", async () => {
		const partialAsker: JevAsker = {
			async askChunkRelevance(_request, expectedQuestionIds) {
				return new Map(
					expectedQuestionIds.filter((id) => id === "c1").map((id) => [id, 0]),
				);
			},
		};
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: ARCHIVE },
			partialAsker,
			OPTIONS,
		);
		assert.deepEqual(outcome, { kind: "unpruned", reason: "kept-everything" });
	});

	it("says so when a dropped line has no archive behind it", async () => {
		const { asker } = recordingAsker(() => 0);
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: undefined },
			asker,
			OPTIONS,
		);
		assert.equal(outcome.kind, "pruned");
		if (outcome.kind !== "pruned") {
			return;
		}
		assert.match(outcome.output, /dropped 6 lines; not saved, re-run the command/);
	});

	it("propagates a Jev failure so the caller can leave the result alone", async () => {
		const failingAsker: JevAsker = {
			async askChunkRelevance() {
				throw new Error("Jev request failed with 502");
			},
		};
		await assert.rejects(
			pruneOutputWithJev(
				{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: ARCHIVE },
				failingAsker,
				OPTIONS,
			),
			/Jev request failed with 502/,
		);
	});

	it("retries once with a smaller state when Jev says the request was too large", async () => {
		const { asker, calls } = recordingAsker((_id, call) => {
			if (call === 1) {
				throw new Error("max_tokens_exceeded");
			}
			return 0;
		});
		const outcome = await pruneOutputWithJev(
			{ command: "npm test", output: progressLines(), history: NO_HISTORY, archive: ARCHIVE },
			asker,
			OPTIONS,
		);
		assert.equal(outcome.kind, "pruned");
		assert.equal(calls.length, 2);
	});

	it("passes the conversation and command to Jev", async () => {
		let seenCommand = "";
		let seenHistory: readonly ConversationTurn[] = [];
		const inspectingAsker: JevAsker = {
			async askChunkRelevance(request, expectedQuestionIds) {
				const body = JSON.parse(request.body) as {
					state: { command: string; history: readonly ConversationTurn[] };
				};
				seenCommand = body.state.command;
				seenHistory = body.state.history;
				return new Map(expectedQuestionIds.map((id) => [id, 0]));
			},
		};
		const history: readonly ConversationTurn[] = [
			{ role: "user", text: "make the tests pass" },
		];
		await pruneOutputWithJev(
			{ command: "pnpm test", output: progressLines(), history, archive: ARCHIVE },
			inspectingAsker,
			OPTIONS,
		);
		assert.equal(seenCommand, "pnpm test");
		assert.deepEqual(seenHistory, history);
	});
});
