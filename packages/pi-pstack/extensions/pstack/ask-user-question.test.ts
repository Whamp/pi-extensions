import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	TYPE_DIFFERENT_ANSWER_OPTION,
	askPstackQuestion,
	formatPstackQuestionAnswer,
} from "./ask-user-question.ts";

function createQuestionContext(actions: Array<{ kind: "select" | "input"; value?: string }>) {
	const prompts: Array<{ kind: "select" | "input"; title: string; options?: string[] }> = [];
	const queue = [...actions];
	return {
		prompts,
		context: {
			hasUI: true,
			ui: {
				async select(title: string, options: string[]) {
					prompts.push({ kind: "select", title, options });
					const next = queue.shift();
					assert.equal(next?.kind, "select");
					return next?.value;
				},
				async input(title: string, _placeholder?: string) {
					prompts.push({ kind: "input", title });
					const next = queue.shift();
					assert.equal(next?.kind, "input");
					return next?.value;
				},
			},
		},
	};
}

describe("askPstackQuestion", () => {
	it("returns one selected option", async () => {
		const fake = createQuestionContext([{ kind: "select", value: "2. Reliability" }]);

		const answer = await askPstackQuestion(
			{
				question: "What matters most?",
				options: ["Speed", "Reliability", "Cost"],
			},
			fake.context,
		);

		assert.deepEqual(answer, {
			selections: ["Reliability"],
			cancelled: false,
		});
		assert.deepEqual(fake.prompts, [
			{
				kind: "select",
				title: "What matters most?",
				options: ["1. Speed", "2. Reliability", "3. Cost", TYPE_DIFFERENT_ANSWER_OPTION],
			},
		]);
	});

	it("accepts a typed answer instead of a listed option", async () => {
		const fake = createQuestionContext([
			{ kind: "select", value: TYPE_DIFFERENT_ANSWER_OPTION },
			{ kind: "input", value: "  Ship the smallest patch  " },
		]);

		const answer = await askPstackQuestion(
			{
				question: "What matters most?",
				options: ["Speed", "Reliability", "Cost"],
			},
			fake.context,
		);

		assert.deepEqual(answer, {
			selections: ["Ship the smallest patch"],
			cancelled: false,
		});
		assert.equal(fake.prompts[1]?.kind, "input");
	});

	it("returns to the option list when the typed answer is cancelled", async () => {
		const fake = createQuestionContext([
			{ kind: "select", value: TYPE_DIFFERENT_ANSWER_OPTION },
			{ kind: "input", value: undefined },
			{ kind: "select", value: "1. Speed" },
		]);

		const answer = await askPstackQuestion(
			{
				question: "What matters most?",
				options: ["Speed", "Reliability"],
			},
			fake.context,
		);

		assert.deepEqual(answer, {
			selections: ["Speed"],
			cancelled: false,
		});
		assert.equal(fake.prompts.length, 3);
	});

	it("collects listed options and a typed answer until the user is done", async () => {
		const fake = createQuestionContext([
			{ kind: "select", value: "1. Speed" },
			{ kind: "select", value: TYPE_DIFFERENT_ANSWER_OPTION },
			{ kind: "input", value: "Keep the public API" },
			{ kind: "select", value: "Done" },
		]);

		const answer = await askPstackQuestion(
			{
				question: "Choose priorities",
				options: ["Speed", "Reliability", "Cost"],
				allow_multiple: true,
			},
			fake.context,
		);

		assert.deepEqual(answer, {
			selections: ["Speed", "Keep the public API"],
			cancelled: false,
		});
		assert.deepEqual(fake.prompts[1]?.options, [
			"Done",
			"2. Reliability",
			"3. Cost",
			TYPE_DIFFERENT_ANSWER_OPTION,
		]);
	});

	it("reports cancellation without inventing a choice", async () => {
		const fake = createQuestionContext([{ kind: "select", value: undefined }]);

		const answer = await askPstackQuestion(
			{
				question: "Choose one",
				options: ["A", "B"],
			},
			fake.context,
		);

		assert.deepEqual(answer, { selections: [], cancelled: true });
		assert.equal(formatPstackQuestionAnswer(answer), "Question cancelled without a selection.");
	});

	it("rejects use when the current Pi mode has no host UI", async () => {
		await assert.rejects(
			askPstackQuestion(
				{
					question: "Choose one",
					options: ["A", "B"],
				},
				{
					hasUI: false,
					ui: {
						async select() {
							return undefined;
						},
						async input() {
							return undefined;
						},
					},
				},
			),
			/Pstack question UI unavailable/,
		);
	});
});
