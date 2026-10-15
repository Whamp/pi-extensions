import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function planSkeleton() {
	const playbook = readFileSync(join(here, "../playbooks/multi-phase-plan.md"), "utf8");
	const open = playbook.indexOf("````markdown\n");
	assert.notEqual(open, -1, "playbook is missing the skeleton fence");
	const start = open + "````markdown\n".length;
	const close = playbook.indexOf("````", start);
	assert.notEqual(close, -1, "playbook skeleton fence is unclosed");
	return playbook.slice(start, close);
}

function checkPlan(text) {
	const dir = mkdtempSync(join(tmpdir(), "check-plan-"));
	try {
		const file = join(dir, "plan.md");
		writeFileSync(file, text);
		return spawnSync(process.execPath, [join(here, "check-plan.mjs"), file], {
			encoding: "utf8",
			timeout: 10_000,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("bundled multi-phase-plan skeleton passes check-plan.mjs", () => {
	const result = checkPlan(planSkeleton());
	assert.equal(result.status, 0, result.stderr + result.stdout);
});

for (const [name, snippet] of [
	["tilde fences", "~~~\nCode: a curly quote ’ is literal\n~~~"],
	["indented fences", "   ```\nCode: a curly quote ’ is literal\n   ```"],
	["nested shorter fences", "````markdown\n```js\nCode: a curly quote ’ is literal\n```\n````"],
	["mismatched closing characters", "```\n~~~\nCode: a curly quote ’ is literal\n```"],
]) {
	test(`check-plan ignores code within ${name}`, () => {
		const result = checkPlan(`${planSkeleton()}\n${snippet}\n`);
		assert.equal(result.status, 0, result.stderr + result.stdout);
	});
}

test("check-plan still rejects prose after a matching closing fence", () => {
	const result = checkPlan(`${planSkeleton()}\n~~~\nCode: literal\n~~~~\nProse: a curly quote ’\n`);
	assert.equal(result.status, 1);
	assert.match(result.stderr + result.stdout, /mid-sentence colon|curly quote/);
});
