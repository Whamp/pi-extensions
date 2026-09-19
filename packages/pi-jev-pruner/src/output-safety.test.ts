import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOutputSkipReason } from "./output-safety.ts";

describe("findOutputSkipReason", () => {
	it("accepts ordinary build output", () => {
		assert.equal(findOutputSkipReason("npm test", "added 42 packages in 3s"), undefined);
	});

	it("rejects empty and whitespace-only output", () => {
		assert.equal(findOutputSkipReason("npm test", "")?.reason, "empty");
		assert.equal(findOutputSkipReason("npm test", "   \n  ")?.reason, "empty");
	});

	it("rejects binary output", () => {
		assert.equal(findOutputSkipReason("npm test", "abc\u0000def")?.reason, "binary");
	});

	it("rejects output that reads as one document", () => {
		assert.equal(findOutputSkipReason("npm test", '{"a":1}')?.reason, "structured");
		assert.equal(findOutputSkipReason("npm test", "diff --git a/f.ts b/f.ts")?.reason, "structured");
		assert.equal(findOutputSkipReason("git diff HEAD", "some output")?.reason, "structured");
		assert.equal(findOutputSkipReason("cat package.json", "{}")?.reason, "structured");
	});

	it("rejects credential-like commands", () => {
		assert.equal(findOutputSkipReason("printenv FOO", "FOO=bar")?.reason, "secret");
		assert.equal(findOutputSkipReason("vault read secret/db", "ok")?.reason, "secret");
	});

	it("rejects credential-like output", () => {
		assert.equal(
			findOutputSkipReason("npm test", "AWS_SECRET_ACCESS_KEY=abc123")?.reason,
			"secret",
		);
		assert.equal(
			findOutputSkipReason("npm test", "https://user:hunter2@example.com/repo.git")?.reason,
			"secret",
		);
	});

	it("does not treat a file merely named like an error as structured output", () => {
		assert.equal(findOutputSkipReason("npm test", "src/serialize-error.js: ok"), undefined);
	});
});
