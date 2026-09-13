import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	applyBodyTransforms,
	asRelPath,
	assertNoLegacyPiCallerGuidance,
	classify,
	plan,
} from "./reground-from-cursor.mjs";

const SKILL_BODY = "# fixture skill body\n";

const CURSOR_FILES = {
	"skills/how/SKILL.md": SKILL_BODY,
	"skills/how/references/explainer.md": SKILL_BODY,
	"skills/poteto-mode/SKILL.md": SKILL_BODY,
	"skills/poteto-mode/playbooks/bug-fix.md": SKILL_BODY,
	"skills/poteto-mode/playbooks/feature.md": SKILL_BODY,
	"skills/principle-laziness-protocol/SKILL.md": SKILL_BODY,
	"skills/principle-test-behavior-not-implementation/SKILL.md": SKILL_BODY,
	"skills/typescript-best-practices/references/patterns.md": SKILL_BODY,
	"skills/setup-pstack/SKILL.md": SKILL_BODY,
	"skills/make-bot-ui/SKILL.md": SKILL_BODY,
	"agents/poteto-agent.md": SKILL_BODY,
	"README.md": SKILL_BODY,
};

const PI_STALE_FILES = {
	"skills/how/SKILL.md": SKILL_BODY,
	"skills/how/references/critic-prompt.md": SKILL_BODY,
	"skills/how/references/critique-rubric.md": SKILL_BODY,
	"skills/poteto-mode/SKILL.md": SKILL_BODY,
	"skills/poteto-mode/playbooks/feature.md": SKILL_BODY,
	"skills/poteto-mode/playbooks/autonomous-run.md": SKILL_BODY,
	"skills/legacy-skill/SKILL.md": SKILL_BODY,
	"skills/deslop/SKILL.md": SKILL_BODY,
	"skills/setup-pstack/SKILL.md": SKILL_BODY,
	"README.md": "- **47 skills**, 23 playbooks, 23 principle skills, not all 47.\n",
	"extensions/pstack/config.ts": 'export const ROLES = ["how critics", "arena runners"];\n',
	"extensions/pstack/skill-catalog.test.ts":
		"assert.equal(skills.length, 47);\n" +
		"assert.equal(skills.filter((skill) => skill.hidden).length, 43);\n" +
		"assert.equal(hidden.length, 43);\n",
};

const PI_SYNCED_FILES = {
	...PI_STALE_FILES,
	"README.md": "- **7 skills**, 2 playbooks, 2 principle skills, not all 7.\n",
	"extensions/pstack/config.ts": 'export const ROLES = ["arena runners"];\n',
	"extensions/pstack/skill-catalog.test.ts":
		"assert.equal(skills.length, 7);\n" +
		"assert.equal(skills.filter((skill) => skill.hidden).length, 3);\n" +
		"assert.equal(hidden.length, 3);\n",
};

const sandbox = mkdtempSync(join(tmpdir(), "pi-pstack-reground-"));
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
after(() => rmSync(sandbox, { recursive: true, force: true }));

function makeTree(name, files) {
	const root = join(sandbox, name);
	for (const [rel, text] of Object.entries(files)) {
		const dest = join(root, rel);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, text);
	}
	return root;
}

const cursorDir = makeTree("cursor-plugins/pstack", CURSOR_FILES);
const piStaleDir = makeTree("pi-pstack-stale", PI_STALE_FILES);
const piSyncedDir = makeTree("pi-pstack-synced", PI_SYNCED_FILES);

function classTable(planned, kind) {
	return planned.actions
		.filter((action) => action.kind === kind)
		.map((action) => [action.rel, action.class])
		.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

test("asRelPath rejects traversal and absolute paths", () => {
	assert.throws(() => asRelPath(".."));
	assert.throws(() => asRelPath("foo/../bar"));
	assert.throws(() => asRelPath("foo\\bar"));
	assert.throws(() => asRelPath("/abs"));
	assert.equal(asRelPath("skills/how/SKILL.md"), "skills/how/SKILL.md");
});

test("classify maps Cursor-relative paths to copy classes", () => {
	assert.equal(
		classify(asRelPath("skills/typescript-best-practices/references/patterns.md")),
		"copy",
	);
	assert.equal(classify(asRelPath("skills/how/SKILL.md")), "adapt");
	assert.equal(classify(asRelPath("skills/setup-pstack/SKILL.md")), "pi-only");
	assert.equal(classify(asRelPath("skills/setup-pstack/references/MODEL-ROLES.md")), "pi-only");
	assert.equal(classify(asRelPath("skills/make-bot-ui/SKILL.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/principle-attack-the-premise/SKILL.md")), "copy");
	assert.equal(classify(asRelPath("agents/poteto-agent.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/package.json")), "pi-only");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/worktree-audit.sh")), "pi-only");
	assert.throws(
		() => classify(asRelPath("extensions/pstack/index.ts")),
		/unclassified Cursor path/,
	);
});

test("plan dry-run maps the fixture Cursor tree to write, skip, and delete actions", () => {
	const planned = plan({ from: cursorDir, to: piStaleDir, dryRun: true });

	assert.deepEqual(classTable(planned, "write"), [
		["skills/how/SKILL.md", "adapt"],
		["skills/how/references/explainer.md", "adapt"],
		["skills/poteto-mode/SKILL.md", "adapt"],
		["skills/poteto-mode/playbooks/bug-fix.md", "adapt"],
		["skills/poteto-mode/playbooks/feature.md", "adapt"],
		["skills/principle-laziness-protocol/SKILL.md", "copy"],
		["skills/principle-test-behavior-not-implementation/SKILL.md", "copy"],
		["skills/typescript-best-practices/references/patterns.md", "copy"],
	]);

	assert.deepEqual(classTable(planned, "skip"), [
		["README.md", "never-copy"],
		["agents/poteto-agent.md", "never-copy"],
		["skills/make-bot-ui/SKILL.md", "never-copy"],
		["skills/setup-pstack/SKILL.md", "pi-only"],
	]);

	const deleted = planned.actions
		.filter((action) => action.kind === "delete")
		.map((action) => action.rel)
		.sort();
	assert.deepEqual(deleted, [
		"skills/how/references/critic-prompt.md",
		"skills/how/references/critique-rubric.md",
		"skills/legacy-skill/SKILL.md",
		"skills/poteto-mode/playbooks/autonomous-run.md",
	]);

	assert.equal(planned.counts.total, 7);
	assert.equal(planned.counts.discoverable, 4);
	assert.equal(planned.counts.hidden, 3);
	assert.equal(planned.counts.principles, 2);
	assert.equal(planned.counts.playbooks, 2);

	assert.equal(readFileSync(join(piStaleDir, "skills/legacy-skill/SKILL.md"), "utf8"), SKILL_BODY);
});

test("plan dry-run derives count and config patches only for a stale destination", () => {
	const stale = plan({ from: cursorDir, to: piStaleDir, dryRun: true });
	const stalePatches = stale.actions
		.filter((action) => action.derived)
		.map((action) => [action.derived, relative(piStaleDir, action.dest)])
		.sort((a, b) => (a[0] < b[0] ? -1 : 1));
	assert.deepEqual(stalePatches, [
		["catalog-counts", "extensions/pstack/skill-catalog.test.ts"],
		["readme-counts", "README.md"],
	]);
	assert.equal(
		stale.actions.some((action) => action.derived === "drop-how-critics"),
		false,
	);

	const synced = plan({ from: cursorDir, to: piSyncedDir, dryRun: true });
	assert.deepEqual(
		synced.actions.filter((action) => action.derived),
		[],
	);
	assert.deepEqual(synced.counts, stale.counts);
});

test("adapt transforms Cursor caller guidance to catalog workflows", () => {
	const direct = applyBodyTransforms(
		'Spawn subagent_type: "poteto-agent" for this task.',
		"skills/poteto-mode/SKILL.md",
	);
	assert.equal(
		direct,
		'Spawn subagent({ action: "execute", input: { agent: "poteto-agent", task } }) for this task.',
	);
	assert.equal(
		applyBodyTransforms(
			'subagent({ agent: "comment-sicko", task })',
			"skills/no-comments/SKILL.md",
		),
		'subagent({ action: "execute", input: { agent: "comment-sicko", task } })',
	);

	const cases = [
		{
			rel: "skills/how/SKILL.md",
			text: "Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Spawn all explorers in a single message:\n\n- agent: \"worker\"\n- `model`: `how explorers` (default inherit-parent)\n- tools: read-only (`read, grep, find, ls, bash`)\n\nEach explorer gets the prompt in `references/explorer-prompt.md` with its angle filled in. Then go to Step 3.",
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N + 1", "runs.all([", 'runs.run("explain",'],
		},
		{
			rel: "skills/how/SKILL.md",
			text: 'Spawn one child that explores and explains in one pass:\n\n- agent: "worker"\n- `model`: `how explainer` (default inherit-parent)\n- `task`: instruct the child to inspect only and not modify files\n\nBuild its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.',
			expected: ['subagent({ action: "execute"', "one standalone child", "async: false"],
		},
		{
			rel: "skills/arena/SKILL.md",
			text: "Spawn all N subagents in one message with `run_in_background: true`.",
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N + 1", "runs.all([", 'runs.run("cross-judge",'],
		},
		{
			rel: "skills/swarm/SKILL.md",
			text: 'Spawn all N workers in one message with `environment: "cloud"`, `run_in_background: true`.',
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N", "return await runs.all(["],
		},
		{
			rel: "skills/swarm/SKILL.md",
			text: "When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.",
			expected: ["`cwd` or `baseRef` under `input`"],
		},
		{
			rel: "skills/reflect/SKILL.md",
			text: "One message, three `subagent()` launches, one per reviewer.",
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: 4", 'runs.run("synthesize-reviews",'],
		},
		{
			rel: "skills/why/SKILL.md",
			text: "Launch all matching investigators in a single message so they run concurrently.",
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N + 1", 'runs.run("synthesize-why",'],
		},
		{
			rel: "skills/why/SKILL.md",
			text: "Each investigator gets:\n1. The base prompt from `references/investigator-prompt.md`\n2. The category playbook `references/sources/<source>.md` for the selected MCP\n3. The user's original question\n\n### Investigator roster. One per available evidence category\n\nSpawn one investigator per category that has a matching MCP. Each owns exactly one tool or MCP.",
			expected: ["parent's evidence packet", "including null results and gaps", "owns exactly one evidence packet"],
		},
		{
			rel: "skills/interrogate/SKILL.md",
			text: "Launch all reviewers in a single message using the Task tool. Use the `interrogate reviewers` list from `~/.pi/agent/pstack/models.json` when present, one reviewer per entry, extending or shrinking the Reviewer A/B/C/D labels below to the configured entry count. Otherwise use the table defaults.",
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N", "return await runs.all([", "interrogate reviewers"],
		},
		{
			rel: "skills/interrogate/SKILL.md",
			text: "If a model slug is rejected as unresolvable when you try to spawn the subagent, check the valid slugs in the Task tool's error message, pick the closest equivalent, and retry.",
			expected: ['action: "models"', "Explicit selectors do not fall back"],
		},
		{
			rel: "skills/poteto-mode/SKILL.md",
			text: '**Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step** (code-writing delegates, ad-hoc helpers).',
			expected: ["one standalone child", "Put every operation field under `input`"],
		},
		{
			rel: "skills/poteto-mode/playbooks/multi-phase-plan.md",
			text: '3. Explore in subagents with subagent_type: "poteto-agent".',
			expected: ["workflowScript", "maxSubagentSpawnsPerRun: N", "return await runs.all(["],
		},
		{
			rel: "skills/poteto-mode/playbooks/orchestrate.md",
			text: [
				"Agents are spawned, resumed, and drained only through the Task tool.",
				"Spawns its workers and verifiers (nesting works to depth 3, and a nested spawn has the full Task schema including `environment`).",
				"- Never resume an agent to check on it. Probe the cloud agent's status in the Cursor dashboard.",
				"- After a Cursor restart: local agents are dead, cloud work is not.",
				'4. **Scale.** Spawn a rolling window of workers up to the in-flight cap, refilling as children finish.',
			].join("\n"),
			expected: [
				'action: "execute"',
				"subagentOnlyExtensions",
				'action: "status"',
				"After a Pi restart",
				"workflowScript",
				"maxSubagentSpawnsPerRun: N + V",
				"return await runs.all([",
			],
		},
	];

	for (const fixture of cases) {
		const transformed = applyBodyTransforms(fixture.text, fixture.rel);
		for (const expected of fixture.expected) {
			assert.equal(transformed.includes(expected), true, `${fixture.rel} should include ${expected}`);
		}
		assert.equal(transformed.includes("run_in_background"), false);
		assert.equal(transformed.includes("environment:"), false);
		assert.equal(transformed.includes("Task tool"), false);
	}
});

test("current executable Pi guidance contains no legacy caller forms", () => {
	assert.doesNotThrow(() => assertNoLegacyPiCallerGuidance(packageRoot));
});

test("caller audit rejects launch syntax but ignores historical and reference prose", () => {
	const staleRoot = makeTree("legacy-caller-guidance", {
		"README.md": "Historical: subagent({ agent, task }) was removed with Cursor's Task tool.\n",
		"skills/example/SKILL.md": [
			'subagent({ agent: "worker", task })',
			"run_in_background: true",
			'environment: "cloud"',
			"readonly: false",
			'cloud_base_branch: "main"',
			'full subagent catalog schema including `environment`',
			"Probe the cloud agent's status in the Cursor dashboard.",
			'runs.run({ key: "review", agent: "worker" })',
			'Inside the script, use `runs.all([{ key: "review", agent: "worker" }])`.',
			"Launch reviewers using the Task tool.",
		].join("\n"),
		"skills/example/references/history.md": 'subagent({ agent: "third-party", task })\n',
	});

	assert.throws(
		() => assertNoLegacyPiCallerGuidance(staleRoot),
		(error) => {
			assert.equal(error instanceof Error, true);
			for (const id of [
				"legacy-flat-subagent-call",
				"cursor-run-in-background-field",
				"cursor-environment-field",
				"cursor-readonly-field",
				"cursor-cloud-base-branch-field",
				"cursor-environment-schema",
				"cursor-runtime-guidance",
				"object-form-runs-run",
				"unawaited-runs-all-guidance",
				"task-tool-launch-language",
			]) {
				assert.equal(error.message.includes(id), true, `missing ${id}`);
			}
			return true;
		},
	);

	writeFileSync(join(staleRoot, "skills/example/SKILL.md"), "# Current catalog guidance\n");
	assert.doesNotThrow(() => assertNoLegacyPiCallerGuidance(staleRoot));
});

test("adapt transforms Cursor role prose to atomic Pi names", () => {
	const how = applyBodyTransforms(
		[
			"## Step 2a. Explore (complex questions only)",
			"- `model`: your configured how-explorer model (default inherit-parent)",
			"## Step 2b. Direct Explain (simple questions)",
			"- `model`: your configured how-explainer model (default inherit-parent)",
			"## Step 3. Synthesize (complex questions only)",
			"- `model`: your configured how-explainer model (default inherit-parent)",
		].join("\n"),
		"skills/how/SKILL.md",
	);
	assert.equal(how.includes("`how explorers`"), true);
	assert.equal(how.includes("`how explainer`"), true);
	assert.equal(how.includes("`how synthesizer`"), true);
	assert.equal(how.includes("how-explorer"), false);
	assert.equal(how.includes("how-explainer"), false);

	const arena = applyBodyTransforms(
		"choose one model from the `arena cross-judge pool` in `~/.pi/agent/pstack/models.json`",
		"skills/arena/SKILL.md",
	);
	assert.equal(arena.includes("`arena judge pool`"), true);
	assert.equal(arena.includes("arena cross-judge pool"), false);

	const feature = applyBodyTransforms(
		"Delegate code-writing to a subagent using your configured feature model (default inherit-parent)",
		"skills/poteto-mode/playbooks/feature.md",
	);
	assert.equal(feature.includes("`feature implementation`"), true);

	const architect = applyBodyTransforms(
		"Use your configured architect runners (defaults inherit-parent).",
		"skills/architect/SKILL.md",
	);
	assert.equal(architect.includes("`architect runners`"), true);
	assert.equal(architect.includes("`arena judge pool`"), true);
	assert.equal(architect.includes("at least two candidates"), true);

	const reflect = applyBodyTransforms(
		[
			"| Judgment | your configured reflect-judgment model (default inherit-parent) | `references/judgment-reviewer.md` |",
			"| Tooling | your configured reflect-tooling model (default inherit-parent) | `references/tooling-reviewer.md` |",
			"| Divergent | your configured reflect-judgment model (default inherit-parent) | `references/divergent-reviewer.md` |",
			"using your configured reflect-judgment model (default inherit-parent)",
		].join("\n"),
		"skills/reflect/SKILL.md",
	);
	assert.equal(reflect.includes("`reflect judgment reviewer`"), true);
	assert.equal(reflect.includes("`reflect tooling reviewer`"), true);
	assert.equal(reflect.includes("`reflect divergent reviewer`"), true);
	assert.equal(reflect.includes("`reflect synthesizer`"), true);
});
