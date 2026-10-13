import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { systemPromptInjection } from "./pstack-role-prompt.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode reminder when enabled", () => {
		assert.equal(systemPromptInjection(true), POTETO_ONE_LINER);
	});

	it("adds no prompt text when Poteto Mode is off", () => {
		assert.equal(systemPromptInjection(false, "/package/bb-surface.md"), "");
	});

	it("points BB sessions to the shipped worker reference without requiring a project", () => {
		const prompt = systemPromptInjection(true, "/package/bb-surface.md");
		assert.ok(prompt.includes("pi_worker"));
		assert.ok(prompt.includes("/package/bb-surface.md"));
		assert.ok(!prompt.includes("BB_PROJECT_ID"));
		assert.ok(!prompt.includes("authorization"));
	});
});
