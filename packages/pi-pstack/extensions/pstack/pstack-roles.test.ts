import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { formatPstackRoleReferenceMarkdown, PSTACK_ROLES } from "./pstack-roles.ts";

const SPEC_ROLES = [
	["feature implementation", "single", "feature, refactoring"],
	["refactoring implementation", "single", "feature, refactoring"],
	["bug-fix", "single", "bug-fix"],
	["perf-issue", "single", "perf-issue"],
	["hillclimb", "repeat", "hillclimb"],
	["judgment", "single", "judgment and prose"],
	["prose", "single", "judgment and prose"],
	["hardest tasks", "single", "hardest tasks"],
	["how explorers", "repeat", "how explorer"],
	["how explainer", "single", "how explainer"],
	["how synthesizer", "single", "how explainer"],
	["why investigators", "repeat", "why investigators"],
	["why synthesizer", "single", "why synthesizer"],
	["reflect judgment reviewer", "single", "reflect judgment, divergent, synthesizer"],
	["reflect tooling reviewer", "single", "reflect tooling"],
	["reflect divergent reviewer", "single", "reflect judgment, divergent, synthesizer"],
	["reflect synthesizer", "single", "reflect judgment, divergent, synthesizer"],
	["arena runners", "fanout", "arena runners"],
	["arena judge pool", "pick-one", "arena cross-judge pool"],
	["swarm workers", "repeat", "swarm workers"],
	["architect runners", "fanout", "architect runners"],
	["interrogate reviewers", "fanout", "interrogate reviewers"],
] as const;

describe("PSTACK_ROLES", () => {
	it("has the 22 atomic roles in registry order with the chosen cardinalities and legacy names", () => {
		assert.deepEqual(
			Object.entries(PSTACK_ROLES).map(([name, def]) => [name, def.cardinality, def.legacyName]),
			SPEC_ROLES.map(([name, cardinality, legacyName]) => [name, cardinality, legacyName]),
		);
		assert.equal(Object.keys(PSTACK_ROLES).length, 22);
	});

	it("does not encode Architect's two-candidate minimum in registry metadata", () => {
		assert.equal("minimumEntries" in PSTACK_ROLES["architect runners"], false);
		for (const def of Object.values(PSTACK_ROLES)) {
			assert.equal("minimumEntries" in def, false);
		}
	});

	it("treats repeat as one selector, not a list", () => {
		for (const name of ["hillclimb", "how explorers", "why investigators", "swarm workers"] as const) {
			assert.equal(PSTACK_ROLES[name].cardinality, "repeat");
		}
	});

	it("keeps MODEL-ROLES.md equal to the registry formatter", () => {
		const path = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"skills",
			"setup-pstack",
			"references",
			"MODEL-ROLES.md",
		);
		assert.equal(readFileSync(path, "utf8"), formatPstackRoleReferenceMarkdown());
	});
});
