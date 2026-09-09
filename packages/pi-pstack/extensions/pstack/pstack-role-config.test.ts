import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	decodePstackConfigText,
	defaultPstackRoleConfig,
	type PstackConfigReadResult,
} from "./pstack-role-config.ts";

const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";
const SELECTOR_C = "zai/glm-5.3:max";

const V1_TARGETS: ReadonlyArray<readonly [string, readonly string[]]> = [
	["feature, refactoring", ["feature implementation", "refactoring implementation"]],
	["bug-fix", ["bug-fix"]],
	["perf-issue", ["perf-issue"]],
	["hillclimb", ["hillclimb"]],
	["judgment and prose", ["judgment", "prose"]],
	["hardest tasks", ["hardest tasks"]],
	["how explorer", ["how explorers"]],
	["how explainer", ["how explainer", "how synthesizer"]],
	["why investigators", ["why investigators"]],
	["why synthesizer", ["why synthesizer"]],
	["reflect tooling", ["reflect tooling reviewer"]],
	[
		"reflect judgment, divergent, synthesizer",
		["reflect judgment reviewer", "reflect divergent reviewer", "reflect synthesizer"],
	],
	["arena runners", ["arena runners"]],
	["arena cross-judge pool", ["arena judge pool"]],
	["swarm workers", ["swarm workers"]],
	["architect runners", ["architect runners"]],
	["interrogate reviewers", ["interrogate reviewers"]],
];

function decode(value: unknown): PstackConfigReadResult {
	return decodePstackConfigText(JSON.stringify(value));
}

function codes(result: PstackConfigReadResult): string[] {
	return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function diagnosticsWithCode(result: PstackConfigReadResult, code: string) {
	return result.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

describe("defaultPstackRoleConfig", () => {
	it("is version 2 with omitted roles inheriting and skills on", () => {
		assert.deepEqual(defaultPstackRoleConfig(), { version: 2, roles: {}, skillsEnabled: true });
	});
});

describe("decodePstackConfigText v2", () => {
	it("keeps explicit selectors, effort suffixes, list order, and duplicates", () => {
		const result = decode({
			version: 2,
			roles: {
				"feature implementation": SELECTOR,
				"arena runners": [SELECTOR_B, SELECTOR, SELECTOR_B],
				"arena judge pool": [SELECTOR_C],
			},
			skillsEnabled: true,
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.version, 2);
		assert.equal(result.config.roles["feature implementation"], SELECTOR);
		assert.deepEqual(result.config.roles["arena runners"], [SELECTOR_B, SELECTOR, SELECTOR_B]);
		assert.deepEqual(result.config.roles["arena judge pool"], [SELECTOR_C]);
		assert.equal(result.config.roles.hillclimb, undefined);
		assert.equal(result.diagnostics.length, 0);
	});

	it("normalizes auto to inherit-parent by omitting the role", () => {
		const result = decode({
			version: 2,
			roles: {
				"bug-fix": "auto",
				prose: "inherit-parent",
				"perf-issue": SELECTOR,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["bug-fix"], undefined);
		assert.equal(result.config.roles.prose, undefined);
		assert.equal(result.config.roles["perf-issue"], SELECTOR);
		assert.equal(result.diagnostics.length, 0);
	});

	it("accepts top-level inherit-parent for fanout and pick-one roles", () => {
		const result = decode({
			version: 2,
			roles: {
				"arena runners": "inherit-parent",
				"arena judge pool": "auto",
				"architect runners": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.equal(result.config.roles["arena judge pool"], undefined);
		assert.deepEqual(codes(result), ["invalid-role-selection"]);
		assert.equal(result.diagnostics[0]?.role, "architect runners");
		assert.equal(result.config.roles["architect runners"], undefined);
	});

	it("accepts a one-entry Architect list because the registry does not own a two-candidate minimum", () => {
		const result = decode({
			version: 2,
			roles: { "architect runners": [SELECTOR] },
		});
		assert.equal(result.source, "v2");
		assert.deepEqual(result.config.roles["architect runners"], [SELECTOR]);
		assert.equal(result.diagnostics.length, 0);
	});

	it("rejects scalar/repeat arrays, empty lists, and inheritance aliases inside arrays", () => {
		const result = decode({
			version: 2,
			roles: {
				judgment: [SELECTOR, SELECTOR_B],
				hillclimb: [SELECTOR],
				"arena runners": [],
				"arena judge pool": [SELECTOR, "inherit-parent"],
				"swarm workers": "auto",
				"how explorers": SELECTOR,
				"interrogate reviewers": [SELECTOR, "auto", SELECTOR_B],
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles.judgment, undefined);
		assert.equal(result.config.roles.hillclimb, undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.equal(result.config.roles["arena judge pool"], undefined);
		assert.equal(result.config.roles["swarm workers"], undefined);
		assert.equal(result.config.roles["how explorers"], SELECTOR);
		assert.equal(result.config.roles["interrogate reviewers"], undefined);
		assert.deepEqual(new Set(codes(result)), new Set(["invalid-role-selection"]));
		assert.deepEqual(
			new Set(
				diagnosticsWithCode(result, "invalid-role-selection").map((diagnostic) => diagnostic.role),
			),
			new Set([
				"judgment",
				"hillclimb",
				"arena runners",
				"arena judge pool",
				"interrogate reviewers",
			]),
		);
	});

	it("reports unknown roles and invalid selectors without dropping unrelated valid roles", () => {
		const result = decode({
			version: 2,
			roles: {
				"bug-fix": SELECTOR,
				"not-a-role": SELECTOR_B,
				"how critics": SELECTOR_C,
				"how explainer": "no-slash",
				"why synthesizer": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["bug-fix"], SELECTOR);
		assert.equal(result.config.roles["why synthesizer"], SELECTOR_B);
		assert.equal(result.config.roles["how explainer"], undefined);
		assert.ok(codes(result).includes("unknown-role"));
		assert.ok(codes(result).includes("retired-role"));
		assert.ok(codes(result).includes("invalid-selector"));
		assert.equal(diagnosticsWithCode(result, "retired-role")[0]?.role, "how critics");
		assert.equal(diagnosticsWithCode(result, "unknown-role")[0]?.role, "not-a-role");
	});

	it("keeps a valid skills flag when roles is not an object", () => {
		const result = decode({
			version: 2,
			roles: ["bug-fix", SELECTOR],
			skillsEnabled: false,
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.skillsEnabled, false);
		assert.deepEqual(result.config.roles, {});
		assert.ok(codes(result).includes("invalid-document"));
	});

	it("defaults an invalid skills flag to true and reports it", () => {
		const result = decode({
			version: 2,
			roles: { "bug-fix": SELECTOR },
			skillsEnabled: "off",
		});
		assert.equal(result.config.skillsEnabled, true);
		assert.equal(result.config.roles["bug-fix"], SELECTOR);
		assert.ok(codes(result).includes("invalid-skills-enabled"));
	});
});

describe("decodePstackConfigText v1 migration", () => {
	it("copies every v1 key onto the chosen v2 targets, including combined roles and effort suffixes", () => {
		const roles: Record<string, string> = {};
		for (const [legacyName] of V1_TARGETS) {
			roles[legacyName] = SELECTOR;
		}
		const result = decode({ version: 1, roles, skillsEnabled: false });
		assert.equal(result.source, "v1");
		assert.equal(result.config.version, 2);
		assert.equal(result.config.skillsEnabled, false);
		assert.ok(codes(result).includes("legacy-migrated"));
		const listRoles = new Set([
			"arena runners",
			"arena judge pool",
			"architect runners",
			"interrogate reviewers",
		]);
		for (const [, targets] of V1_TARGETS) {
			for (const target of targets) {
				if (listRoles.has(target)) {
					assert.deepEqual(result.config.roles[target], [SELECTOR]);
				} else {
					assert.equal(result.config.roles[target], SELECTOR);
				}
			}
		}
		assert.equal(Object.keys(result.config.roles).length, 22);
	});

	it("treats retired how critics as unknown with no replacement", () => {
		const result = decode({
			version: 1,
			roles: {
				"how critics": SELECTOR,
				"bug-fix": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v1");
		assert.equal(result.config.roles["bug-fix"], SELECTOR_B);
		assert.equal(result.config.roles["interrogate reviewers"], undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		const retired = diagnosticsWithCode(result, "retired-role");
		assert.equal(retired.length, 1);
		assert.equal(retired[0]?.role, "how critics");
		assert.match(retired[0]?.message ?? "", /no replacement/);
	});

	it("treats atomic v2 names inside a v1 document as unknown", () => {
		const result = decode({
			version: 1,
			roles: {
				"feature implementation": SELECTOR,
				"bug-fix": SELECTOR_B,
			},
		});
		assert.equal(result.config.roles["feature implementation"], undefined);
		assert.equal(result.config.roles["bug-fix"], SELECTOR_B);
		assert.equal(diagnosticsWithCode(result, "unknown-role")[0]?.role, "feature implementation");
	});

	it("takes the first real selector from an ambiguous v1 array for scalar and repeat targets", () => {
		const result = decode({
			version: 1,
			roles: {
				"feature, refactoring": [SELECTOR, SELECTOR_B],
				hillclimb: ["inherit-parent", SELECTOR_C, SELECTOR],
				"how explorer": [SELECTOR_B],
			},
		});
		assert.equal(result.config.roles["feature implementation"], SELECTOR);
		assert.equal(result.config.roles["refactoring implementation"], SELECTOR);
		assert.equal(result.config.roles.hillclimb, SELECTOR_C);
		assert.equal(result.config.roles["how explorers"], SELECTOR_B);
		const ambiguous = diagnosticsWithCode(result, "ambiguous-legacy-selection");
		assert.deepEqual(
			new Set(ambiguous.map((diagnostic) => diagnostic.role)),
			new Set(["feature, refactoring", "hillclimb"]),
		);
		assert.match(ambiguous[0]?.message ?? "", /Retained 1 selector and discarded 1/);
	});

	it("keeps v1 list order, strips inherit aliases, and turns a scalar list role into a singleton list", () => {
		const result = decode({
			version: 1,
			roles: {
				"arena runners": ["auto", SELECTOR_B, "inherit-parent", SELECTOR_B],
				"arena cross-judge pool": SELECTOR_C,
				"architect runners": [SELECTOR],
				"interrogate reviewers": ["bad", SELECTOR, "__proto__/x"],
			},
		});
		assert.deepEqual(result.config.roles["arena runners"], [SELECTOR_B, SELECTOR_B]);
		assert.deepEqual(result.config.roles["arena judge pool"], [SELECTOR_C]);
		assert.deepEqual(result.config.roles["architect runners"], [SELECTOR]);
		assert.deepEqual(result.config.roles["interrogate reviewers"], [SELECTOR]);
		assert.ok(
			diagnosticsWithCode(result, "invalid-selector").some((diagnostic) => diagnostic.index === 0),
		);
		assert.ok(
			diagnosticsWithCode(result, "invalid-selector").some(
				(diagnostic) => diagnostic.role === "interrogate reviewers",
			),
		);
	});

	it("falls back to inheritance when a v1 array has no real selectors", () => {
		const result = decode({
			version: 1,
			roles: {
				"bug-fix": ["no-slash", "auto"],
				"arena runners": ["inherit-parent", "auto"],
			},
		});
		assert.equal(result.config.roles["bug-fix"], undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.ok(codes(result).includes("invalid-selector"));
	});
});

describe("decodePstackConfigText failures", () => {
	it("returns defaults for invalid JSON, documents, and versions without throwing", () => {
		const invalidJson = decodePstackConfigText("{not json");
		assert.equal(invalidJson.source, "invalid");
		assert.deepEqual(invalidJson.config, defaultPstackRoleConfig());
		assert.ok(codes(invalidJson).includes("invalid-json"));

		const invalidDocument = decodePstackConfigText("[]");
		assert.equal(invalidDocument.source, "invalid");
		assert.ok(codes(invalidDocument).includes("invalid-document"));

		const unsupported = decode({ version: 3, roles: { "bug-fix": SELECTOR } });
		assert.equal(unsupported.source, "invalid");
		assert.deepEqual(unsupported.config, defaultPstackRoleConfig());
		assert.ok(codes(unsupported).includes("unsupported-version"));
	});
});
