import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PSTACK_ROLE_NAMES, PSTACK_ROLES, type PstackRoleName } from "./pstack-roles.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type RoleConsumerLine = {
	readonly section: string;
	readonly line: string;
	readonly roles: readonly PstackRoleName[];
};

type RoleConsumerSpec = {
	readonly file: string;
	readonly lines: readonly RoleConsumerLine[];
};

const ROLE_CONSUMERS: readonly RoleConsumerSpec[] = [
	{
		file: "skills/how/SKILL.md",
		lines: [
			{
				section: "## Step 2a. Explore",
				line: "- `model`: `how explorers` (default inherit-parent)",
				roles: ["how explorers"],
			},
			{
				section: "## Step 2b. Direct Explain",
				line: "- `model`: `how explainer` (default inherit-parent)",
				roles: ["how explainer"],
			},
			{
				section: "## Step 3. Synthesize",
				line: "- `model`: `how synthesizer` (default inherit-parent)",
				roles: ["how synthesizer"],
			},
		],
	},
	{
		file: "skills/why/SKILL.md",
		lines: [
			{
				section: "## Step 3. Spawn Parallel Investigators",
				line: "- `model`: `why investigators` (default inherit-parent)",
				roles: ["why investigators"],
			},
			{
				section: "## Step 4. Synthesize",
				line: "- `model`: `why synthesizer` (default inherit-parent)",
				roles: ["why synthesizer"],
			},
		],
	},
	{
		file: "skills/reflect/SKILL.md",
		lines: [
			{
				section: "### 2. Spawn three reviewers in parallel",
				line: "| Judgment | `reflect judgment reviewer` (default inherit-parent) | `references/judgment-reviewer.md` |",
				roles: ["reflect judgment reviewer"],
			},
			{
				section: "### 2. Spawn three reviewers in parallel",
				line: "| Tooling | `reflect tooling reviewer` (default inherit-parent) | `references/tooling-reviewer.md` |",
				roles: ["reflect tooling reviewer"],
			},
			{
				section: "### 2. Spawn three reviewers in parallel",
				line: "| Divergent | `reflect divergent reviewer` (default inherit-parent) | `references/divergent-reviewer.md` |",
				roles: ["reflect divergent reviewer"],
			},
			{
				section: "### 3. Synthesize",
				line: "using `reflect synthesizer` (default inherit-parent)",
				roles: ["reflect synthesizer"],
			},
		],
	},
	{
		file: "skills/arena/SKILL.md",
		lines: [
			{
				section: "## Phase A: Frame",
				line: "Use `arena runners` from `~/.pi/agent/pstack/models.json` when present.",
				roles: ["arena runners"],
			},
			{
				section: "## Phase C: Cross-judge",
				line: "choose one model from the `arena judge pool` in `~/.pi/agent/pstack/models.json` when present.",
				roles: ["arena judge pool"],
			},
		],
	},
	{
		file: "skills/architect/SKILL.md",
		lines: [
			{
				section: "## Phase B: Sketch",
				line: "Override Arena's candidate selector with `architect runners` (defaults inherit-parent). Require at least two candidates. The Arena judge still uses `arena judge pool`.",
				roles: ["arena judge pool", "architect runners"],
			},
		],
	},
	{
		file: "skills/swarm/SKILL.md",
		lines: [
			{
				section: "## Phase A: Frame",
				line: "Pick the worker model from `swarm workers` in `~/.pi/agent/pstack/models.json` when present.",
				roles: ["swarm workers"],
			},
		],
	},
	{
		file: "skills/interrogate/SKILL.md",
		lines: [
			{
				section: "## Step 3, Spawn Reviewers",
				line: "Use the `interrogate reviewers` list from `~/.pi/agent/pstack/models.json` when present",
				roles: ["interrogate reviewers"],
			},
		],
	},
	{
		file: "skills/poteto-mode/playbooks/feature.md",
		lines: [
			{
				section: "### Feature",
				line: "using the `feature implementation` role (default inherit-parent)",
				roles: ["feature implementation"],
			},
		],
	},
	{
		file: "skills/poteto-mode/playbooks/refactoring.md",
		lines: [
			{
				section: "### Refactoring",
				line: "using the `refactoring implementation` role (default inherit-parent)",
				roles: ["refactoring implementation"],
			},
		],
	},
	{
		file: "skills/poteto-mode/playbooks/bug-fix.md",
		lines: [
			{
				section: "### Bug fix",
				line: "using the `bug-fix` role (default inherit-parent)",
				roles: ["bug-fix"],
			},
		],
	},
	{
		file: "skills/poteto-mode/playbooks/perf-issue.md",
		lines: [
			{
				section: "### Perf issue",
				line: "using the `perf-issue` role (default inherit-parent)",
				roles: ["perf-issue"],
			},
		],
	},
	{
		file: "skills/poteto-mode/playbooks/hillclimb.md",
		lines: [
			{
				section: "### Hillclimb",
				line: "using the `hillclimb` role (default inherit-parent)",
				roles: ["hillclimb"],
			},
		],
	},
	{
		file: "skills/poteto-mode/SKILL.md",
		lines: [
			{
				section: "## Subagents",
				line: "Ordinary judgment uses `judgment`.",
				roles: ["judgment"],
			},
			{
				section: "## Subagents",
				line: "User-facing writing uses `prose`.",
				roles: ["prose"],
			},
			{
				section: "## Subagents",
				line: "Escalated difficult work uses `hardest tasks`.",
				roles: ["hardest tasks"],
			},
			{
				section: "## Subagents",
				line: "Implementation playbooks use `feature implementation`, `refactoring implementation`, `bug-fix`, `perf-issue`, and `hillclimb`.",
				roles: [
					"feature implementation",
					"refactoring implementation",
					"bug-fix",
					"perf-issue",
					"hillclimb",
				],
			},
			{
				section: "## Subagents",
				line: "Role lines choose only the model.",
				roles: [],
			},
			{
				section: "## Subagents",
				line: "They never grant tools, authority, or isolation.",
				roles: [],
			},
		],
	},
	{
		file: "skills/setup-pstack/SKILL.md",
		lines: [
			{
				section: "# Setup pstack",
				line: "`version`: `2`",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "`single`",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "`repeat`",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "`fanout`",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "`pick-one`",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "references/MODEL-ROLES.md",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "Do not persist `auto`.",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "A backup is written before replacing v1 JSON or leftover markdown.",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "`/pstack status` shows source, warnings, and errors.",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "it applies to new turns",
				roles: [],
			},
			{
				section: "# Setup pstack",
				line: "Session start does not rewrite the file.",
				roles: [],
			},
		],
	},
];

const LEGACY_ONLY_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
	{ id: "feature, refactoring", pattern: /feature, refactoring/ },
	{ id: "judgment and prose", pattern: /judgment and prose/ },
	{ id: "how explorer", pattern: /how explorer(?!s)/ },
	{ id: "arena cross-judge pool", pattern: /arena cross-judge pool/ },
	{
		id: "reflect judgment, divergent, synthesizer",
		pattern: /reflect judgment, divergent, synthesizer/,
	},
	{ id: "how critics", pattern: /how critics/ },
	{ id: "reflect tooling", pattern: /reflect tooling(?! reviewer)/ },
];

const LEGACY_NAME_ALLOWLIST = new Set([
	"extensions/pstack/pstack-roles.ts",
	"extensions/pstack/pstack-roles.test.ts",
	"extensions/pstack/pstack-role-config.ts",
	"extensions/pstack/pstack-role-config.test.ts",
	"extensions/pstack/pstack-role-config-store.ts",
	"extensions/pstack/pstack-role-prompt.test.ts",
	"extensions/pstack/pstack-extension.test.ts",
	"extensions/pstack/pstack-config-status.test.ts",
	"skills/setup-pstack/SKILL.md",
	"scripts/reground-from-cursor.mjs",
	"scripts/reground-from-cursor.test.mjs",
]);

function readPackageFile(rel: string): string {
	return readFileSync(join(PACKAGE_ROOT, rel), "utf8");
}

function sectionAfter(text: string, heading: string): string {
	const start = text.indexOf(heading);
	if (start === -1) return "";
	const hashes = heading.match(/^#+/)?.[0]?.length ?? 0;
	const rest = text.slice(start + heading.length);
	const next = hashes === 0 ? -1 : rest.search(new RegExp(`\n#{1,${hashes}} `));
	return next === -1 ? text.slice(start) : text.slice(start, start + heading.length + next);
}

function backtickRolesIn(text: string): PstackRoleName[] {
	return PSTACK_ROLE_NAMES.filter((name) => text.includes(`\`${name}\``));
}

function roleConsumerMismatches(files: ReadonlyMap<string, string>): string[] {
	const mismatches: string[] = [];
	for (const spec of ROLE_CONSUMERS) {
		const text = files.get(spec.file) ?? "";
		for (const expected of spec.lines) {
			if (!text.includes(expected.line)) {
				mismatches.push(`${spec.file}: missing ${JSON.stringify(expected.line)}`);
			}
			const section = sectionAfter(text, expected.section);
			if (section === "") {
				mismatches.push(`${spec.file}: missing section ${JSON.stringify(expected.section)}`);
				continue;
			}
			if (!section.includes(expected.line)) {
				mismatches.push(
					`${spec.file}: ${expected.section} missing ${JSON.stringify(expected.line)}`,
				);
			}
			const found = backtickRolesIn(expected.line);
			if (JSON.stringify(found) !== JSON.stringify(expected.roles)) {
				mismatches.push(
					`${spec.file}: line roles ${JSON.stringify(found)} !== ${JSON.stringify(expected.roles)}`,
				);
			}
		}
	}
	return mismatches;
}

function loadConsumerFiles(): Map<string, string> {
	const files = new Map<string, string>();
	for (const spec of ROLE_CONSUMERS) {
		files.set(spec.file, readPackageFile(spec.file));
	}
	return files;
}

function walkRelFiles(dir: string, relBase: string, out: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) walkRelFiles(abs, rel, out);
		else out.push(rel);
	}
}

describe("pstack role consumers", () => {
	it("keeps the exact role-bearing line at each consuming phase", () => {
		assert.deepEqual(roleConsumerMismatches(loadConsumerFiles()), []);
	});

	it("fails when a different known role is substituted", () => {
		const files = loadConsumerFiles();
		const how = files.get("skills/how/SKILL.md") ?? "";
		files.set("skills/how/SKILL.md", how.replaceAll("`how synthesizer`", "`how explainer`"));
		const mismatches = roleConsumerMismatches(files);
		assert.equal(mismatches.length > 0, true);
		assert.equal(
			mismatches.some((mismatch) => mismatch.includes("how synthesizer")),
			true,
		);
	});

	it("keeps every expected consumer role in the registry", () => {
		for (const spec of ROLE_CONSUMERS) {
			for (const expected of spec.lines) {
				for (const role of expected.roles) {
					assert.equal(role in PSTACK_ROLES, true, role);
				}
			}
		}
	});

	it("keeps v1-only role names in migration code, tests, and setup docs", () => {
		const rels: string[] = [];
		walkRelFiles(join(PACKAGE_ROOT, "extensions"), "extensions", rels);
		walkRelFiles(join(PACKAGE_ROOT, "skills"), "skills", rels);
		walkRelFiles(join(PACKAGE_ROOT, "scripts"), "scripts", rels);
		const leaks: string[] = [];
		for (const rel of rels) {
			if (LEGACY_NAME_ALLOWLIST.has(rel)) continue;
			if (rel.endsWith(".test.ts") || rel.endsWith(".test.mjs")) {
				if (
					rel.includes("pstack-role-") ||
					rel === "extensions/pstack/index.test.ts" ||
					rel.includes("pstack-config-status")
				) {
					continue;
				}
			}
			const text = readPackageFile(rel);
			for (const { id, pattern } of LEGACY_ONLY_PATTERNS) {
				if (pattern.test(text)) leaks.push(`${rel}: ${id}`);
			}
		}
		assert.deepEqual(leaks, []);
	});
});
