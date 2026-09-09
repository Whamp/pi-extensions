import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPstackRoleConfig, decodePstackConfigText } from "./pstack-role-config.ts";
import { PSTACK_ROLES, type PstackRoleName } from "./pstack-roles.ts";
import {
	buildPstackSetupPlan,
	collectPstackSetupSelections,
	pstackModelSelectorsFromSession,
} from "./pstack-setup-plan.ts";

const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";
const SELECTOR_C = "cursor/grok-4.6:slow:high";

const EXPECTED_SETUP_ROLES = [
	["feature implementation", "single", "scalar", "Implementation"],
	["refactoring implementation", "single", "scalar", "Implementation"],
	["bug-fix", "single", "scalar", "Implementation"],
	["perf-issue", "single", "scalar", "Implementation"],
	["hillclimb", "repeat", "scalar", "Implementation"],
	["judgment", "single", "scalar", "Judgment and prose"],
	["prose", "single", "scalar", "Judgment and prose"],
	["hardest tasks", "single", "scalar", "Judgment and prose"],
	["how explorers", "repeat", "scalar", "How"],
	["how explainer", "single", "scalar", "How"],
	["how synthesizer", "single", "scalar", "How"],
	["why investigators", "repeat", "scalar", "Why"],
	["why synthesizer", "single", "scalar", "Why"],
	["reflect judgment reviewer", "single", "scalar", "Reflect"],
	["reflect tooling reviewer", "single", "scalar", "Reflect"],
	["reflect divergent reviewer", "single", "scalar", "Reflect"],
	["reflect synthesizer", "single", "scalar", "Reflect"],
	["arena runners", "fanout", "list", "Arena"],
	["arena judge pool", "pick-one", "list", "Arena"],
	["swarm workers", "repeat", "scalar", "Swarm"],
	["architect runners", "fanout", "list", "Architect"],
	["interrogate reviewers", "fanout", "list", "Interrogate"],
] as const;

describe("pstackModelSelectorsFromSession", () => {
	it("appends thinkingLevel as a trailing suffix and keeps colon ids intact", () => {
		assert.deepEqual(
			pstackModelSelectorsFromSession({
				scopedModels: [
					{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "high" },
					{ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, thinkingLevel: "medium" },
					{ model: { provider: "cursor", id: "grok-4.6:slow" }, thinkingLevel: "high" },
					{ model: { provider: "xai", id: "grok-4.6" } },
				],
			}),
			[SELECTOR, "openai-codex/gpt-5.6-sol:medium", SELECTOR_C, "xai/grok-4.6"],
		);
	});

	it("falls back to bare available models when scoped models are absent or empty", () => {
		const available = [{ provider: "xai", id: "grok-4.6" }];
		assert.deepEqual(pstackModelSelectorsFromSession({ availableModels: available }), ["xai/grok-4.6"]);
		assert.deepEqual(
			pstackModelSelectorsFromSession({ scopedModels: [], availableModels: available }),
			["xai/grok-4.6"],
		);
	});
});

describe("buildPstackSetupPlan", () => {
	it("covers all 22 roles with cardinality, pick kind, and group labels", () => {
		const configured = decodePstackConfigText(
			JSON.stringify({
				version: 2,
				roles: {
					"bug-fix": SELECTOR_B,
					"arena runners": [SELECTOR, SELECTOR],
				},
				skillsEnabled: true,
			}),
		).config;
		const plan = buildPstackSetupPlan({
			config: configured,
			sessionSelectors: [SELECTOR],
		});
		assert.deepEqual(
			plan.steps.map((step) => [step.role, step.cardinality, step.kind, step.group]),
			EXPECTED_SETUP_ROLES.map((row) => [...row]),
		);
		assert.equal(plan.steps.length, 22);
		assert.equal(plan.steps.length, Object.keys(PSTACK_ROLES).length);
		assert.equal(plan.choices.includes("inherit-parent"), true);
		assert.equal(plan.choices.includes("auto"), false);
		assert.equal(plan.choices.includes(SELECTOR), true);
		assert.equal(plan.choices.includes(SELECTOR_B), true);
		assert.equal(plan.steps.find((step) => step.role === "bug-fix")?.current, SELECTOR_B);
		assert.deepEqual(plan.steps.find((step) => step.role === "arena runners")?.current, [SELECTOR, SELECTOR]);
		for (const name of Object.keys(PSTACK_ROLES) as PstackRoleName[]) {
			const step = plan.steps.find((entry) => entry.role === name);
			assert.equal(step?.purpose, PSTACK_ROLES[name].purpose);
		}
	});
});

describe("collectPstackSetupSelections", () => {
	it("omits inherit-parent, keeps list duplicates, and leaves the loaded config untouched", async () => {
		const loaded = decodePstackConfigText(
			JSON.stringify({
				version: 2,
				roles: { "bug-fix": SELECTOR_B },
				skillsEnabled: false,
			}),
		).config;
		Object.freeze(loaded);
		Object.freeze(loaded.roles);
		const plan = buildPstackSetupPlan({ config: loaded, sessionSelectors: [SELECTOR, SELECTOR_B] });
		const answers = plan.steps.flatMap((step) => {
			if (step.role === "feature implementation") return [SELECTOR];
			if (step.role === "arena runners") return [SELECTOR, SELECTOR, "done"];
			return ["inherit-parent"];
		});
		const next = await collectPstackSetupSelections({
			config: loaded,
			plan,
			select: async () => answers.shift(),
		});
		assert.equal(loaded.roles["bug-fix"], SELECTOR_B);
		assert.equal(next?.skillsEnabled, false);
		assert.equal(next?.roles["feature implementation"], SELECTOR);
		assert.equal(next?.roles["bug-fix"], undefined);
		assert.deepEqual(next?.roles["arena runners"], [SELECTOR, SELECTOR]);
		assert.equal(next?.roles["arena judge pool"], undefined);
		assert.equal("auto" in (next?.roles ?? {}), false);
	});

	it("returns undefined when the user cancels a later role", async () => {
		const plan = buildPstackSetupPlan({
			config: defaultPstackRoleConfig(),
			sessionSelectors: [SELECTOR],
		});
		let calls = 0;
		const next = await collectPstackSetupSelections({
			config: defaultPstackRoleConfig(),
			plan,
			select: async () => {
				calls += 1;
				if (calls === 1) return SELECTOR;
				return undefined;
			},
		});
		assert.equal(next, undefined);
		assert.equal(calls, 2);
	});
});
