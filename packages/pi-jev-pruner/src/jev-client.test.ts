import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNoulRequest, parseNoulProbabilities } from "./jev-client.ts";
import type { JevHttpRequest } from "./jev-client.ts";
import { createJevAsker } from "./jev-http-asker.ts";
import type { JevHttpTransport } from "./jev-asker.ts";
import { buildOutputRelevanceState } from "./output-relevance-state.ts";

const state = buildOutputRelevanceState(
	{ command: "npm test", goal: "fix the build", history: [], categoryGuidance: undefined },
	[{ id: "c1", text: "line one", lineCount: 1, charCount: 8 }],
);

function jsonBody(request: JevHttpRequest): Record<string, unknown> {
	return JSON.parse(request.body) as Record<string, unknown>;
}

describe("buildNoulRequest", () => {
	it("posts to System One with the model and state", () => {
		const request = buildNoulRequest("jev-latest", state, [{ id: "c1", instructions: "keep?" }], undefined);
		assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
		assert.equal(request.method, "POST");
		const body = jsonBody(request);
		assert.equal(body.model, "jev-latest");
		assert.deepEqual(body.state, state);
	});

	it("asks one noul question per chunk with both criteria", () => {
		const request = buildNoulRequest(
			"jev-latest",
			state,
			[
				{ id: "c1", instructions: "keep c1?" },
				{ id: "c2", instructions: "keep c2?" },
			],
			undefined,
		);
		const questions = jsonBody(request).questions as Record<string, Record<string, unknown>>;
		assert.deepEqual(Object.keys(questions), ["c1", "c2"]);
		assert.equal(questions.c1?.type, "noul");
		assert.equal(questions.c1?.instructions, "keep c1?");
		assert.match(String((questions.c1?.criteria as Record<string, string>).false), /disposable/);
	});

	it("adds an authorization header only when a key is supplied", () => {
		const withKey = buildNoulRequest("jev-latest", state, [], "secret-key");
		assert.equal(withKey.headers.authorization, "Bearer secret-key");
		const withoutKey = buildNoulRequest("jev-latest", state, [], undefined);
		assert.equal(withoutKey.headers.authorization, undefined);
	});
});

describe("parseNoulProbabilities", () => {
	it("reads one probability per answered question", () => {
		const probabilities = parseNoulProbabilities('{"answers":{"c1":{"noul":0.8},"c2":{"noul":0.1}}}');
		assert.equal(probabilities.get("c1"), 0.8);
		assert.equal(probabilities.get("c2"), 0.1);
	});

	it("rejects a body that is not JSON", () => {
		assert.throws(() => parseNoulProbabilities("<html>502</html>"), /not JSON/);
	});

	it("rejects a body without answers", () => {
		assert.throws(() => parseNoulProbabilities("{}"), /missing an answers object/);
		assert.throws(() => parseNoulProbabilities('{"answers":[]}'), /missing an answers object/);
	});

	it("rejects an answer that carries no probability", () => {
		assert.throws(() => parseNoulProbabilities('{"answers":{"c1":{"choice":"x"}}}'), /no noul probability/);
		assert.throws(() => parseNoulProbabilities('{"answers":{"c1":{"noul":"high"}}}'), /no noul probability/);
	});
});

describe("createJevAsker", () => {
	function transportReturning(body: string): JevHttpTransport {
		return { async send() { return body; } };
	}

	it("answers every expected chunk", async () => {
		const asker = createJevAsker(transportReturning('{"answers":{"c1":{"noul":0.7}}}'));
		const probabilities = await asker.askChunkRelevance(
			buildNoulRequest("jev-latest", state, [], undefined),
			["c1"],
		);
		assert.equal(probabilities.get("c1"), 0.7);
	});

	it("fails rather than reporting a missing answer as zero", async () => {
		const asker = createJevAsker(transportReturning('{"answers":{"c1":{"noul":0.7}}}'));
		await assert.rejects(
			asker.askChunkRelevance(buildNoulRequest("jev-latest", state, [], undefined), ["c1", "c2"]),
			/missing an answer for c2/,
		);
	});
});
