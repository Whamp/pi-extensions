import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	canPersistPstackSkillsToggle,
	formatPstackStatus,
	pstackSessionStartWarning,
	pstackSetupSaveKind,
} from "./pstack-config-status.ts";
import { decodePstackConfigText, defaultPstackRoleConfig } from "./pstack-role-config.ts";

const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";

describe("formatPstackStatus", () => {
	it("reports skills, source, and warning/error counts for a clean v2 file", () => {
		const result = decodePstackConfigText(
			JSON.stringify({
				version: 2,
				roles: { "bug-fix": SELECTOR },
				skillsEnabled: false,
			}),
		);
		assert.equal(
			formatPstackStatus(result),
			[
				"pstack skills off. Hidden from the model; /skill:<name> still works.",
				"Source: v2.",
				"Warnings: 0. Errors: 0.",
			].join("\n"),
		);
	});

	it("lists warning and error details without dumping info-only migration as a warning", () => {
		const result = decodePstackConfigText(
			JSON.stringify({
				version: 1,
				roles: {
					"feature, refactoring": [SELECTOR, SELECTOR_B],
					"bug-fix": SELECTOR,
				},
			}),
		);
		const status = formatPstackStatus(result);
		assert.equal(status.includes("pstack skills on."), true);
		assert.equal(status.includes("Source: v1. Migrated in memory. Run /setup-pstack to save v2."), true);
		assert.equal(status.includes("Warnings: 1. Errors: 0."), true);
		assert.equal(status.includes("ambiguous-legacy-selection [feature, refactoring]:"), true);
		assert.equal(status.includes("legacy-migrated"), false);
	});
});

describe("pstackSessionStartWarning", () => {
	it("warns once for warning or error diagnostics and stays silent for missing or info-only v1", () => {
		assert.equal(
			pstackSessionStartWarning({ config: defaultPstackRoleConfig(), source: "missing", diagnostics: [] }),
			undefined,
		);
		const infoOnly = decodePstackConfigText(JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR } }));
		assert.equal(
			infoOnly.diagnostics.every((diagnostic) => diagnostic.severity === "info"),
			true,
		);
		assert.equal(pstackSessionStartWarning(infoOnly), undefined);
		const noisy = decodePstackConfigText(
			JSON.stringify({ version: 1, roles: { "feature, refactoring": [SELECTOR, SELECTOR_B] } }),
		);
		assert.equal(pstackSessionStartWarning(noisy), "pstack config needs attention. Run /pstack status.");
		assert.equal(
			pstackSessionStartWarning(decodePstackConfigText("{not json")),
			"pstack config needs attention. Run /pstack status.",
		);
	});
});

describe("canPersistPstackSkillsToggle / pstackSetupSaveKind", () => {
	it("allows a skills toggle only for missing or clean v2 documents", () => {
		assert.equal(
			canPersistPstackSkillsToggle({ config: defaultPstackRoleConfig(), source: "missing", diagnostics: [] }),
			true,
		);
		const clean = decodePstackConfigText(JSON.stringify({ version: 2, roles: { "bug-fix": SELECTOR } }));
		assert.equal(canPersistPstackSkillsToggle(clean), true);
		assert.equal(pstackSetupSaveKind(clean), "atomic-v2");
		assert.equal(
			pstackSetupSaveKind({ config: defaultPstackRoleConfig(), source: "missing", diagnostics: [] }),
			"create",
		);
		const v1 = decodePstackConfigText(JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR } }));
		assert.equal(canPersistPstackSkillsToggle(v1), false);
		assert.equal(pstackSetupSaveKind(v1), "backup-legacy");
		assert.equal(pstackSetupSaveKind({ ...v1, source: "markdown" }), "backup-legacy");
		const invalid = decodePstackConfigText("{not json");
		assert.equal(canPersistPstackSkillsToggle(invalid), false);
		assert.equal(pstackSetupSaveKind(invalid), "confirm-replace");
		const dirtyV2 = decodePstackConfigText(
			JSON.stringify({ version: 2, roles: { "bug-fix": SELECTOR, "not-a-role": SELECTOR_B } }),
		);
		assert.equal(canPersistPstackSkillsToggle(dirtyV2), false);
		assert.equal(pstackSetupSaveKind(dirtyV2), "confirm-replace");
	});
});
