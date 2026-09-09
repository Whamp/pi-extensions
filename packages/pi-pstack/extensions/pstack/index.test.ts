import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPstackRoleConfig, decodePstackConfigText } from "./pstack-role-config.ts";
import { systemPromptInjection } from "./index.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const ADVISORY =
	"Pstack model roles. These are advisory model selections; tools and authority are separate.";

const SLUG_CONFIG = decodePstackConfigText(
	JSON.stringify({
		version: 2,
		roles: { "bug-fix": "anthropic/claude-opus-4-6" },
	}),
).config;

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode one-liner when the mode is on", () => {
		assert.equal(systemPromptInjection(defaultPstackRoleConfig(), true), POTETO_ONE_LINER);
	});

	it("injects no Poteto Mode text when the mode is off", () => {
		assert.equal(systemPromptInjection(defaultPstackRoleConfig(), false), "");
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, false),
			`${ADVISORY}\nbug-fix [single]: "anthropic/claude-opus-4-6"`,
		);
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, true),
			`${ADVISORY}\nbug-fix [single]: "anthropic/claude-opus-4-6"\n\n${POTETO_ONE_LINER}`,
		);
	});
});
