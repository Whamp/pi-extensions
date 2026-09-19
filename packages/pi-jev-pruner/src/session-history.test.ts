import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { conversationGoal, conversationTurnsFromSession, fitTurnsToTokenBudget } from "./session-history.ts";

const BASE = { parentId: null, timestamp: "2026-01-01T00:00:00.000Z" };

function userEntry(id: string, text: string): SessionEntry {
	return { ...BASE, type: "message", id, message: { role: "user", content: text, timestamp: 1 } };
}

function assistantEntry(id: string, text: string, toolCalls: readonly { id: string; name: string }[] = []): SessionEntry {
	return {
		...BASE,
		type: "message",
		id,
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				...toolCalls.map((call) => ({
					type: "toolCall" as const,
					id: call.id,
					name: call.name,
					arguments: { command: "npm test" },
				})),
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		},
	};
}

function toolResultEntry(id: string, toolCallId: string, toolName: string, text: string): SessionEntry {
	return {
		...BASE,
		type: "message",
		id,
		message: {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text }],
			isError: false,
			timestamp: 3,
		},
	};
}

describe("conversationTurnsFromSession", () => {
	it("keeps user and assistant turns in order", () => {
		const turns = conversationTurnsFromSession([userEntry("e1", "fix the build"), assistantEntry("e2", "on it")]);
		assert.deepEqual(
			turns.map((turn) => [turn.role, turn.text]),
			[
				["user", "fix the build"],
				["assistant", "on it"],
			],
		);
	});

	it("folds a tool result into the call that produced it", () => {
		const turns = conversationTurnsFromSession([
			assistantEntry("e1", "running tests", [{ id: "call_1", name: "bash" }]),
			toolResultEntry("e2", "call_1", "bash", "42 failing"),
		]);
		assert.equal(turns.length, 1);
		assert.deepEqual(turns[0]?.toolCalls, [
			{ tool: "bash", input: '{"command":"npm test"}', result: "42 failing" },
		]);
	});

	it("marks a call with no result as pending", () => {
		const turns = conversationTurnsFromSession([assistantEntry("e1", "", [{ id: "call_1", name: "bash" }])]);
		assert.equal(turns[0]?.toolCalls?.[0]?.result, "pending");
	});

	it("keeps a result whose call is not on the branch", () => {
		const turns = conversationTurnsFromSession([toolResultEntry("e1", "call_9", "bash", "orphaned output")]);
		assert.equal(turns.length, 1);
		assert.equal(turns[0]?.toolCalls?.[0]?.result, "orphaned output");
		assert.equal(turns[0]?.toolCalls?.[0]?.tool, "bash");
	});

	it("keeps a compaction summary as its own turn", () => {
		const compaction: SessionEntry = {
			...BASE,
			type: "compaction",
			id: "e1",
			summary: "keep the API compatible",
			firstKeptEntryId: "e0",
			tokensBefore: 100,
		};
		const turns = conversationTurnsFromSession([compaction, userEntry("e2", "continue")]);
		assert.equal(turns[0]?.role, "summary");
		assert.match(turns[0]?.text ?? "", /API compatible/);
	});

	it("skips entries that carry no conversation", () => {
		const model: SessionEntry = { ...BASE, type: "model_change", id: "e1", provider: "anthropic", modelId: "x" };
		assert.deepEqual(conversationTurnsFromSession([model]), []);
	});

	it("caps very long turn text", () => {
		const turns = conversationTurnsFromSession([userEntry("e1", "x".repeat(20_000))]);
		assert.ok((turns[0]?.text.length ?? 0) < 5_000);
	});
});

describe("conversationGoal", () => {
	it("uses the most recent user turns and ignores assistant turns", () => {
		const goal = conversationGoal([
			{ role: "user", text: "first" },
			{ role: "assistant", text: "noise" },
			{ role: "user", text: "second" },
		]);
		assert.equal(goal, "first\nsecond");
	});
});

describe("fitTurnsToTokenBudget", () => {
	it("keeps everything when the budget is generous", () => {
		const turns = [{ role: "user" as const, text: "one" }, { role: "assistant" as const, text: "two" }];
		assert.equal(fitTurnsToTokenBudget(turns, 10_000).length, 2);
	});

	it("drops the oldest turns first", () => {
		const turns = [
			{ role: "user" as const, text: "a".repeat(3_000) },
			{ role: "assistant" as const, text: "b".repeat(3_000) },
			{ role: "user" as const, text: "newest" },
		];
		const fitted = fitTurnsToTokenBudget(turns, 100);
		assert.deepEqual(fitted, [{ role: "user", text: "newest" }]);
	});

	it("keeps the newest turn even when it alone exceeds the budget", () => {
		const turns = [{ role: "user" as const, text: "x".repeat(10_000) }];
		assert.equal(fitTurnsToTokenBudget(turns, 10).length, 1);
	});
});
