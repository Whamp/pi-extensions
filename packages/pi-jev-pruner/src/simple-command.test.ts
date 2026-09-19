import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simpleCommand } from "./simple-command.ts";

describe("simpleCommand", () => {
	it("returns a plain command as written", () => {
		assert.equal(simpleCommand("npm test"), "npm test");
	});

	it("strips leading environment assignments", () => {
		assert.equal(simpleCommand("CI=1 NODE_ENV=test npm test"), "npm test");
		assert.equal(simpleCommand("CI='a b' npm test"), "npm test");
	});

	it("reduces a path to the executable to its name", () => {
		assert.equal(simpleCommand("/usr/bin/npm test"), "npm test");
		assert.equal(simpleCommand("./scripts/build.sh"), "build.sh");
		assert.equal(simpleCommand("scripts/tools/grade.sh --all"), "grade.sh --all");
	});

	it("rejects compound commands so callers fall back to general handling", () => {
		for (const command of ["npm test | tee out.log", "npm test && echo done", "echo `date`", "cat < in.txt", "a; b", "echo $HOME"]) {
			assert.equal(simpleCommand(command), "", command);
		}
	});

	it("trims surrounding whitespace", () => {
		assert.equal(simpleCommand("  npm test  "), "npm test");
	});
});
