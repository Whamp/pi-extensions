import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyBodyTransforms } from "./reground-from-cursor.mjs";

const fixtures = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../fixtures/cursor-pstack-6ce45c5",
);

function nonStyleTokens(text) {
	return text.replaceAll(/\/\*\*[\s\S]*?\*\//g, "").replaceAll(/[{}\s]/g, "");
}

for (const name of ["github", "types"]) {
	test(`watch-pr/${name} retains upstream non-brace, non-doc tokens`, () => {
		const rel = `skills/poteto-mode/scripts/watch-pr/${name}.ts`;
		const raw = readFileSync(resolve(fixtures, rel), "utf8");
		const adapted = applyBodyTransforms(raw, rel);
		assert.equal(nonStyleTokens(adapted), nonStyleTokens(raw));
		assert.equal(applyBodyTransforms(adapted, rel), adapted);
		for (const brace of ["{", "}"]) {
			assert.equal(
				adapted.split(brace).length - raw.split(brace).length,
				name === "github" ? 8 : 0,
			);
		}
		if (name === "github") {
			assert.match(adapted, /\/\*\* Read and validate one GitHub review-thread page\. \*\//);
		} else {
			assert.match(
				adapted,
				/\/\*\* A review thread before cross-page pass identities are assigned\. \*\//,
			);
		}
	});
}
