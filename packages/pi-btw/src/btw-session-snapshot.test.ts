import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cloneActivePiSessionBranch } from "./btw-session-snapshot.ts";

function writeBranchedSessionFixture(directory: string): string {
	const sourceSessionFile = join(directory, "source.jsonl");
	const entries = [
		{
			type: "session",
			version: 3,
			id: "019fe321-973d-72d3-852b-4521b695882b",
			timestamp: "2026-08-08T20:47:37.277Z",
			cwd: directory,
		},
		{
			type: "message",
			id: "11111111",
			parentId: null,
			timestamp: "2026-08-08T20:47:38.000Z",
			message: { role: "user", content: "root", timestamp: 1 },
		},
		{
			type: "message",
			id: "22222222",
			parentId: "11111111",
			timestamp: "2026-08-08T20:47:39.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "answer" }],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-test",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
		},
		{
			type: "message",
			id: "33333333",
			parentId: "22222222",
			timestamp: "2026-08-08T20:47:40.000Z",
			message: { role: "user", content: "abandoned branch", timestamp: 3 },
		},
		{
			type: "message",
			id: "44444444",
			parentId: "33333333",
			timestamp: "2026-08-08T20:47:41.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "abandoned answer" }],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-test",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 4,
			},
		},
		{
			type: "message",
			id: "55555555",
			parentId: "22222222",
			timestamp: "2026-08-08T20:47:42.000Z",
			message: { role: "user", content: "active branch", timestamp: 5 },
		},
	];

	writeFileSync(
		sourceSessionFile,
		`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
	);
	return sourceSessionFile;
}

test("cloneActivePiSessionBranch copies only the active branch and leaves the parent unchanged", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-btw-session-"));

	try {
		const sourceSessionFile = writeBranchedSessionFixture(directory);
		const sourceBefore = readFileSync(sourceSessionFile, "utf8");

		const snapshotSessionFile = cloneActivePiSessionBranch(sourceSessionFile);

		const snapshot = readFileSync(snapshotSessionFile, "utf8");
		assert.match(snapshot, /root/);
		assert.match(snapshot, /answer/);
		assert.match(snapshot, /active branch/);
		assert.doesNotMatch(snapshot, /abandoned branch/);
		assert.doesNotMatch(snapshot, /abandoned answer/);
		assert.equal(readFileSync(sourceSessionFile, "utf8"), sourceBefore);
		assert.match(
			snapshot,
			new RegExp(`"parentSession":"${sourceSessionFile.replaceAll("\\", "\\\\")}"`),
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
