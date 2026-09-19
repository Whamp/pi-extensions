import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pruneBashOutput } from "./bash-output-pruner.ts";
import type { BashOutputPruneDeps, BashOutputPruneRequest } from "./bash-output-pruner.ts";
import type { JevAsker } from "./jev-asker.ts";
import type { OutputArchiveTarget } from "./output-archive.ts";
import type { OutputPruneOptions } from "./output-pruner.ts";

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

const OUTPUT = Array.from({ length: 10 }, (_, index) => `progress step ${index + 1} complete`).join("\n");
const NOW = 1_700_000_000_000;

const alwaysDrop: JevAsker = {
	async askChunkRelevance(_request, expectedQuestionIds) {
		return new Map(expectedQuestionIds.map((id) => [id, 0]));
	},
};

interface FakeDeps {
	deps: BashOutputPruneDeps;
	writes: { target: OutputArchiveTarget; text: string }[];
}

function fakeDeps(options: { files?: Record<string, string>; failWrite?: boolean } = {}): FakeDeps {
	const writes: { target: OutputArchiveTarget; text: string }[] = [];
	const deps: BashOutputPruneDeps = {
		async readFileText(path) {
			return options.files?.[path];
		},
		async writeArchive(target, text) {
			if (options.failWrite === true) {
				throw new Error("ENOSPC");
			}
			writes.push({ target, text });
		},
		asker: alwaysDrop,
		now: () => NOW,
	};
	return { deps, writes };
}

function request(overrides: Partial<BashOutputPruneRequest> = {}): BashOutputPruneRequest {
	return {
		command: "npm test",
		toolCallId: "call_01",
		contentText: OUTPUT,
		fullOutputPath: undefined,
		history: [],
		projectConfigDir: ".pi",
		options: OPTIONS,
		...overrides,
	};
}

describe("pruneBashOutput", () => {
	it("writes its own archive before dropping lines pi never saved", async () => {
		const { deps, writes } = fakeDeps();
		const result = await pruneBashOutput(request(), deps);
		assert.equal(result.outcome.kind, "pruned");
		assert.equal(writes.length, 1);
		assert.equal(writes[0]?.text, OUTPUT);
		assert.equal(writes[0]?.target.path, `.pi/jev-pruner/bash-call_01.txt`);
		assert.match(result.contentText ?? "", /full output: \.pi\/jev-pruner\/bash-call_01\.txt/);
	});

	it("scores the complete stream pi saved instead of the preview in hand", async () => {
		const { deps, writes } = fakeDeps({ files: { "/tmp/pi-bash-abc.log": OUTPUT } });
		const result = await pruneBashOutput(
			request({ contentText: "last two lines only", fullOutputPath: "/tmp/pi-bash-abc.log" }),
			deps,
		);
		assert.equal(result.outcome.kind, "pruned");
		assert.equal(writes.length, 0, "pi's file is reused as the archive");
		assert.match(result.contentText ?? "", /full output: \/tmp\/pi-bash-abc\.log/);
	});

	it("leaves the result untouched when the complete stream cannot be read", async () => {
		const { deps } = fakeDeps();
		await assert.rejects(
			pruneBashOutput(request({ fullOutputPath: "/tmp/missing.log" }), deps),
			/cannot read the complete output/,
		);
	});

	it("reports nothing to replace when the output is left alone", async () => {
		const { deps, writes } = fakeDeps();
		const result = await pruneBashOutput(request({ contentText: OUTPUT.slice(0, 4) }), deps);
		assert.equal(result.outcome.kind, "unpruned");
		assert.equal(result.contentText, undefined);
		assert.equal(writes.length, 0);
	});

	it("fails the prune when the archive cannot be written", async () => {
		const { deps } = fakeDeps({ failWrite: true });
		await assert.rejects(pruneBashOutput(request(), deps), /ENOSPC/);
	});

	it("names an archive that cannot collide with another tool call", async () => {
		const { deps, writes } = fakeDeps();
		await pruneBashOutput(request({ toolCallId: "call_02" }), deps);
		assert.equal(writes[0]?.target.path, ".pi/jev-pruner/bash-call_02.txt");
	});
});
