import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { configPath, getAgentDir, isSafeModelSelector, legacyMarkdownPath } from "./config.ts";

describe("isSafeModelSelector", () => {
	it("accepts inherit-parent, auto, provider/id, and [high] suffix", () => {
		assert.equal(isSafeModelSelector("inherit-parent"), true);
		assert.equal(isSafeModelSelector("auto"), true);
		assert.equal(isSafeModelSelector("anthropic/claude-opus-4-6"), true);
		assert.equal(isSafeModelSelector("anthropic/claude-opus-4-6[high]"), true);
	});

	it("rejects empty, no slash, __proto__/x, and control chars", () => {
		assert.equal(isSafeModelSelector(""), false);
		assert.equal(isSafeModelSelector("no-slash"), false);
		assert.equal(isSafeModelSelector("__proto__/x"), false);
		assert.equal(isSafeModelSelector("a/b\nc"), false);
	});
});

describe("getAgentDir / configPath / legacyMarkdownPath", () => {
	it("defaults to ~/.pi/agent and the pstack JSON / markdown paths", () => {
		assert.equal(
			getAgentDir({}, () => "/home/u"),
			join("/home/u", ".pi", "agent"),
		);
		assert.equal(
			configPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "pstack", "models.json"),
		);
		assert.equal(
			legacyMarkdownPath({}, () => "/home/u"),
			join("/home/u", ".pi", "agent", "pstack-models.md"),
		);
	});

	it("honors PI_CODING_AGENT_DIR and ~ expansion", () => {
		assert.equal(
			configPath({ PI_CODING_AGENT_DIR: "~/custom-agent" }, () => "/home/u"),
			join("/home/u", "custom-agent", "pstack", "models.json"),
		);
		assert.equal(
			configPath({ PI_CODING_AGENT_DIR: "/abs/agent" }, () => "/home/u"),
			join("/abs/agent", "pstack", "models.json"),
		);
	});
});
