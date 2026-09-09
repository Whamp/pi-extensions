import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { asRelPath, classify, plan } from "./reground-from-cursor.mjs";

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

function relTable(planned, kind) {
	return planned.actions.filter((action) => action.kind === kind).map((action) => action.rel).sort();
}

test("asRelPath rejects traversal and absolute paths", () => {
	assert.throws(() => asRelPath(".."));
	assert.throws(() => asRelPath("foo/../bar"));
	assert.throws(() => asRelPath("foo\\bar"));
	assert.throws(() => asRelPath("/abs"));
	assert.equal(asRelPath("skills/how/SKILL.md"), "skills/how/SKILL.md");
});

test("classify maps Cursor-relative paths to copy classes", () => {
	assert.equal(classify(asRelPath("skills/typescript-best-practices/references/patterns.md")), "copy");
	assert.equal(classify(asRelPath("skills/how/SKILL.md")), "adapt");
	assert.equal(classify(asRelPath("skills/setup-pstack/SKILL.md")), "pi-only");
	assert.equal(classify(asRelPath("skills/make-bot-ui/SKILL.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/principle-attack-the-premise/SKILL.md")), "copy");
	assert.equal(classify(asRelPath("agents/poteto-agent.md")), "never-copy");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/package.json")), "pi-only");
	assert.equal(classify(asRelPath("skills/poteto-mode/scripts/worktree-audit.sh")), "pi-only");
	assert.throws(() => classify(asRelPath("extensions/pstack/index.ts")), /unclassified Cursor path/);
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

	assert.deepEqual(relTable(planned, "delete"), [
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
		["drop-how-critics", "extensions/pstack/config.ts"],
		["readme-counts", "README.md"],
	]);

	const synced = plan({ from: cursorDir, to: piSyncedDir, dryRun: true });
	assert.deepEqual(synced.actions.filter((action) => action.derived), []);
	assert.deepEqual(synced.counts, stale.counts);
});
