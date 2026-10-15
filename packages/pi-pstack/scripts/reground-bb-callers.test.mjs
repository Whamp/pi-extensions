import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyBodyTransforms, plan, renderWrite } from "./reground-from-cursor.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "fixtures/cursor-pstack-6ce45c5");
const paths = { from: sourceRoot, to: packageRoot };
plan(paths);

function adaptFixture(name) {
	const rel = `skills/${name}/SKILL.md`;
	return renderWrite({ rel, class: "adapt" }, paths);
}

for (const name of [
	"how",
	"arena",
	"interrogate",
	"reflect",
	"why",
	"no-comments",
	"poteto-mode",
]) {
	test(`Cursor 0.15.25 ${name} launches BB workers without native Cursor fields`, () => {
		const body = adaptFixture(name);
		assert.match(body, /pi_worker/);
		assert.doesNotMatch(
			body,
			/subagent_type|readonly:|run_in_background|agent-transcripts|poteto-agent|composer-\*|cursor-grok-\*/,
		);
		assert.doesNotMatch(
			body,
			/run that (?:seat|reviewer) on|closest equivalent|adjusted slug|same slug without/,
		);
		assert.equal(applyBodyTransforms(body, `skills/${name}/SKILL.md`), body);
	});
}

test("How preserves parallel explorers followed by its separate synthesizer role", () => {
	const body = adaptFixture("how");
	assert.match(body, /how explorers/);
	assert.match(body, /how explainer/);
	assert.match(body, /how synthesizer/);
	assert.match(body, /2 to 4/);
	assert.match(body, /Once all explorers[\s\S]*retrieve[\s\S]*how synthesizer/i);
	assert.match(body, /tools `read`, `grep`, `find`, and `ls`/);
});

test("Arena preserves isolated candidates, configured judges and completed-candidate ordering", () => {
	const body = adaptFixture("arena");
	assert.match(body, /arena runners/);
	assert.match(body, /arena judge pool/);
	assert.match(body, /Otherwise inherit the resolved parent Pi model/);
	assert.match(body, /isolated workspace/);
	assert.match(body, /Never launch the judge while candidates are writing/);
	assert.match(body, /alternatives it considered and what it rejected/);
});

test("Reflect retains three inspect-only lenses, Pi transcript boundaries and approval", () => {
	const body = adaptFixture("reflect");
	assert.match(body, /Launch three fresh `pi_worker` reviewers/);
	for (const role of [
		"reflect judgment reviewer",
		"reflect tooling reviewer",
		"reflect divergent reviewer",
		"reflect synthesizer",
	]) {
		assert.ok(body.includes(role), role);
	}
	assert.match(body, /\$PI_SESSION_FILE/);
	assert.match(body, /Do not glob sibling slugs/);
	assert.match(body, /wait for explicit approval/);
	assert.doesNotMatch(body, /readonly strips MCPs/);
});

test("Why keeps source-control coverage and waits for investigators before synthesis", () => {
	const body = adaptFixture("why");
	assert.match(body, /source-control evidence or a matching/);
	assert.match(body, /why investigators/);
	assert.match(body, /After all investigators finish[\s\S]*why synthesizer/);
	assert.match(body, /specific research\/MCP tools/);
});

test("Interrogate retains configured cardinality and explicit inspect-only tools", () => {
	const body = adaptFixture("interrogate");
	assert.match(body, /one reviewer per configured entry/);
	assert.match(body, /`read`, `grep`, `find`, and `ls`/);
	assert.match(body, /not modify files/);
	assert.doesNotMatch(body, /role: "worker"/);
});

test("new user-only skills retain upstream invocation settings and use Pi commands", () => {
	for (const name of ["in-your-own-words", "ketchup", "sharpen"]) {
		const body = adaptFixture(name);
		assert.match(body, /^disable-model-invocation: true$/m);
		assert.ok(body.includes(`/skill:${name}`));
	}
	const ketchup = adaptFixture("ketchup");
	assert.match(ketchup, /inline-vis/);
	assert.match(ketchup, /Keep this turn read-only/);
	assert.doesNotMatch(ketchup, /\/visualize/);
});

test("Poteto effort adaptation preserves role policy and exact parent inheritance", () => {
	const body = adaptFixture("poteto-mode");
	assert.match(body, /reasoningLevel/);
	assert.match(body, /inherit-parent[\s\S]*resolved parent model and reasoning/);
	assert.match(body, /Do not change provider or model selectors/);
	assert.doesNotMatch(body, /xhigh by default|same slug without|adjusted slug/);
});

test("ordinary prose outside the current caller contracts is unchanged", () => {
	const source = readFileSync(join(sourceRoot, "skills/sharpen/SKILL.md"), "utf8");
	assert.equal(
		applyBodyTransforms(source, "skills/sharpen/SKILL.md"),
		source.replaceAll("/sharpen", "/skill:sharpen"),
	);
});
