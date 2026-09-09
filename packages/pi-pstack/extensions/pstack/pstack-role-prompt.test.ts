import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPstackRoleConfig, decodePstackConfigText } from "./pstack-role-config.ts";
import { formatPstackRoleTable, systemPromptInjection } from "./pstack-role-prompt.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const ADVISORY =
	"Pstack model roles. These are advisory model selections; tools and authority are separate.";

const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";
const SELECTOR_C = "zai/glm-5.3:max";

function config(
	roles: Record<string, string | string[]>,
): ReturnType<typeof decodePstackConfigText>["config"] {
	return decodePstackConfigText(JSON.stringify({ version: 2, roles, skillsEnabled: true })).config;
}

describe("formatPstackRoleTable", () => {
	it("returns empty when every role inherits", () => {
		assert.equal(formatPstackRoleTable(defaultPstackRoleConfig()), "");
	});

	it("renders configured atomic roles with cardinality and JSON-encoded selectors", () => {
		assert.equal(
			formatPstackRoleTable(
				config({
					"bug-fix": "anthropic/claude-opus-4-6",
					"how explorers": SELECTOR,
					"arena runners": [SELECTOR, SELECTOR_C],
					"arena judge pool": [SELECTOR_B, SELECTOR_B],
				}),
			),
			[
				ADVISORY,
				`bug-fix [single]: "anthropic/claude-opus-4-6"`,
				`how explorers [repeat]: "${SELECTOR}"`,
				`arena runners [fanout]: ["${SELECTOR}","${SELECTOR_C}"]`,
				`arena judge pool [pick-one]: ["${SELECTOR_B}","${SELECTOR_B}"]`,
			].join("\n"),
		);
	});

	it("omits inherit-parent and does not include diagnostics", () => {
		const table = formatPstackRoleTable(
			decodePstackConfigText(
				JSON.stringify({
					version: 1,
					roles: {
						"feature, refactoring": SELECTOR,
						"how critics": SELECTOR_B,
					},
				}),
			).config,
		);
		assert.equal(
			table,
			[
				ADVISORY,
				`feature implementation [single]: "${SELECTOR}"`,
				`refactoring implementation [single]: "${SELECTOR}"`,
			].join("\n"),
		);
		assert.equal(table.includes("how critics"), false);
		assert.equal(table.includes("legacy-migrated"), false);
		assert.equal(table.includes("retired-role"), false);
	});
});

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode one-liner when the mode is on and roles inherit", () => {
		assert.equal(systemPromptInjection(defaultPstackRoleConfig(), true), POTETO_ONE_LINER);
	});

	it("injects no Poteto Mode text when the mode is off", () => {
		assert.equal(systemPromptInjection(defaultPstackRoleConfig(), false), "");
		assert.equal(
			systemPromptInjection(config({ "bug-fix": "anthropic/claude-opus-4-6" }), false),
			`${ADVISORY}\nbug-fix [single]: "anthropic/claude-opus-4-6"`,
		);
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(config({ "bug-fix": "anthropic/claude-opus-4-6" }), true),
			`${ADVISORY}\nbug-fix [single]: "anthropic/claude-opus-4-6"\n\n${POTETO_ONE_LINER}`,
		);
	});
});
