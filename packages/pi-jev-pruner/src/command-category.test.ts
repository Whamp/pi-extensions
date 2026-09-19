import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandCategoryGuidance } from "./command-category.ts";

describe("commandCategoryGuidance", () => {
	it("recognizes build, install, and test commands", () => {
		for (const command of [
			"npm test",
			"pnpm run build",
			"yarn install",
			"make",
			"pytest -q",
			"cargo test",
			"go build ./...",
			"uv pip install ruff",
			"python -m pytest",
		]) {
			assert.equal(commandCategoryGuidance(command)?.category, "build", command);
		}
	});

	it("recognizes search and file-excerpt commands", () => {
		for (const command of ["rg pattern", "grep -rn foo .", "find . -name '*.ts'", "sed -n '1,20p' f", "git grep foo"]) {
			assert.equal(commandCategoryGuidance(command)?.category, "search", command);
		}
	});

	it("looks past environment assignments and an executable path", () => {
		assert.equal(commandCategoryGuidance("CI=1 /usr/bin/npm test")?.category, "build");
	});

	it("falls back to no guidance for compound commands", () => {
		assert.equal(commandCategoryGuidance("npm test | tee out.log"), undefined);
		assert.equal(commandCategoryGuidance("npm test && rg error out.log"), undefined);
	});

	it("falls back to no guidance for unknown commands", () => {
		assert.equal(commandCategoryGuidance("node scripts/check.mjs"), undefined);
		assert.equal(commandCategoryGuidance("npm run deploy"), undefined);
	});

	it("carries guidance text for a recognized category", () => {
		assert.match(commandCategoryGuidance("npm test")?.guidance ?? "", /failing test names/);
		assert.match(commandCategoryGuidance("rg foo")?.guidance ?? "", /line numbers/);
	});
});
