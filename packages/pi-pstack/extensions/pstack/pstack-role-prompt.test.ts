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
		assert.equal(systemPromptInjection(false), "");
	});
});
