import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateOutputTokens, estimateStateTokens } from "./output-token-estimate.ts";

describe("estimateOutputTokens", () => {
	it("counts nothing for empty text", () => {
		assert.equal(estimateOutputTokens(""), 0);
	});

	it("counts one token per short word and rounds up", () => {
		assert.equal(estimateOutputTokens("hello"), 1);
		assert.equal(estimateOutputTokens("hello world"), 2);
	});

	it("charges long words more than short ones", () => {
		assert.ok(estimateOutputTokens("a".repeat(60)) > estimateOutputTokens("a".repeat(6)));
	});

	it("counts a digit run at half a token per digit", () => {
		assert.equal(estimateOutputTokens("1234"), 2);
		assert.ok(estimateOutputTokens("12345678") > estimateOutputTokens("1234"));
	});

	it("counts punctuation below a full token", () => {
		assert.equal(estimateOutputTokens("a,b"), 3);
	});

	it("grows with the amount of text", () => {
		const line = "0123456789 abcdefghij klmnopqrst\n";
		assert.ok(estimateOutputTokens(line.repeat(100)) > estimateOutputTokens(line.repeat(10)));
	});
});

describe("estimateStateTokens", () => {
	it("adds a digit surcharge on top of the plain estimate", () => {
		assert.ok(estimateStateTokens("port 8080") > estimateOutputTokens("port 8080"));
	});

	it("leaves text without digits unchanged", () => {
		assert.equal(estimateStateTokens("hello world"), estimateOutputTokens("hello world"));
	});
});
