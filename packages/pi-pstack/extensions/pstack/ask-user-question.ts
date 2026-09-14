import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Reserved select item that opens a typed answer instead of a listed option. */
export const TYPE_DIFFERENT_ANSWER_OPTION = "Type a different answer";

const DONE_OPTION = "Done";

export interface PstackQuestionRequest {
	question: string;
	options: string[];
	allow_multiple?: boolean;
}

export interface PstackQuestionUi {
	hasUI: boolean;
	ui: {
		select(title: string, options: string[]): Promise<string | undefined>;
		input(title: string, placeholder?: string): Promise<string | undefined>;
	};
}

export interface PstackQuestionAnswer {
	selections: string[];
	cancelled: boolean;
}

function labeledQuestionOptions(options: string[]): string[] {
	return options.map((option, index) => `${index + 1}. ${option}`);
}

/** Format the host UI result as the tool's text content. */
export function formatPstackQuestionAnswer(answer: PstackQuestionAnswer): string {
	if (!answer.cancelled) {
		return `Selected: ${answer.selections.join(", ")}`;
	}
	if (answer.selections.length > 0) {
		return `Question cancelled after selecting: ${answer.selections.join(", ")}`;
	}
	return "Question cancelled without a selection.";
}

/** Ask one preference question, always offering a typed answer beside the listed options. */
export async function askPstackQuestion(
	request: PstackQuestionRequest,
	ctx: PstackQuestionUi,
): Promise<PstackQuestionAnswer> {
	if (!ctx.hasUI) {
		throw new Error("Pstack question UI unavailable in this Pi mode");
	}

	const labels = labeledQuestionOptions(request.options);
	const remaining = [...labels];
	const selections: string[] = [];

	while (remaining.length > 0 || request.allow_multiple === true) {
		const choices = [
			...(selections.length > 0 ? [DONE_OPTION] : []),
			...remaining,
			TYPE_DIFFERENT_ANSWER_OPTION,
		];
		const selected = await ctx.ui.select(request.question, choices);
		if (selected === undefined) {
			return { selections, cancelled: true };
		}
		if (selected === DONE_OPTION) {
			return { selections, cancelled: false };
		}
		if (selected === TYPE_DIFFERENT_ANSWER_OPTION) {
			const typed = await ctx.ui.input(request.question, "Your answer");
			if (typed === undefined) {
				continue;
			}
			const answer = typed.trim();
			if (answer === "") {
				continue;
			}
			selections.push(answer);
			if (request.allow_multiple !== true) {
				return { selections, cancelled: false };
			}
			continue;
		}

		const remainingIndex = remaining.indexOf(selected);
		if (remainingIndex === -1) {
			throw new Error("Pstack question UI returned an unknown option");
		}
		const optionIndex = labels.indexOf(selected);
		const option = request.options[optionIndex];
		if (option === undefined) {
			throw new Error("Pstack question option index is invalid");
		}
		selections.push(option);
		remaining.splice(remainingIndex, 1);

		if (request.allow_multiple !== true) {
			return { selections, cancelled: false };
		}
	}

	return { selections, cancelled: false };
}

/** Register the model-facing ask_user_question tool on a Pi extension API. */
export function registerAskUserQuestion(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask one structured preference or product question with 2-6 choices. The user can pick listed options or type a different answer.",
		promptSnippet: "Ask a structured preference or product question with selectable options",
		promptGuidelines: [
			"Use ask_user_question only for genuine preference or product decisions that available evidence cannot settle.",
		],
		executionMode: "sequential",
		parameters: Type.Object(
			{
				question: Type.String({ minLength: 1 }),
				options: Type.Array(Type.String({ minLength: 1 }), {
					minItems: 2,
					maxItems: 6,
					uniqueItems: true,
				}),
				allow_multiple: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const answer = await askPstackQuestion(params, ctx);
			return {
				content: [{ type: "text", text: formatPstackQuestionAnswer(answer) }],
				details: answer,
			};
		},
	});
}
