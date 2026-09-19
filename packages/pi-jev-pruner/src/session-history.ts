import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { estimateStateTokens } from "./output-token-estimate.ts";

/** One conversation turn handed to Jev as relevance context. */
export interface ConversationTurn {
	/** Who produced the turn. `summary` marks text carried over from compaction. */
	role: "user" | "assistant" | "summary";
	/** Visible text of the turn; empty when the turn contained only tool calls. */
	text: string;
	/** Tool calls made in this turn, each with the result that was recorded for it. */
	toolCalls?: readonly ConversationToolCall[];
}

/** A tool call and its result, serialized so Jev can weigh the evidence it produced. */
export interface ConversationToolCall {
	/** Tool name as pi recorded it. */
	tool: string;
	/** Tool arguments as JSON. */
	input: string;
	/** Result text, or a short marker when no result was recorded for the call. */
	result: string;
}

/** Per-turn text cap: keeps one pasted wall of text from crowding out the recent turns. */
const MAX_TURN_TEXT_CHARS = 4_000;
/** Per-result cap, for the same reason. */
const MAX_TOOL_RESULT_CHARS = 6_000;

function truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}\n[...truncated]`;
}

function textFromMessageContent(content: string | readonly { type: string }[]): string {
	if (typeof content === "string") {
		return content;
	}
	const parts: string[] = [];
	for (const part of content) {
		if (part.type === "text" && "text" in part && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("\n");
}

/** A tool call as it appears on an assistant message, before its result is attached. */
interface PendingToolCall {
	id: string;
	tool: string;
	input: string;
}

function pendingToolCallsFromAssistantMessage(
	content: readonly { type: string }[],
): readonly PendingToolCall[] {
	const calls: PendingToolCall[] = [];
	for (const part of content) {
		if (part.type !== "toolCall" || !("id" in part) || typeof part.id !== "string") {
			continue;
		}
		const name = "name" in part && typeof part.name === "string" ? part.name : "unknown";
		const args = "arguments" in part ? part.arguments : undefined;
		calls.push({ id: part.id, tool: name, input: args === undefined ? "" : JSON.stringify(args) });
	}
	return calls;
}

/**
 * Turns the active session branch into the conversation context Jev scores against.
 *
 * Tool results are folded into the call that produced them. A result whose call is not on the
 * branch becomes its own turn, so no evidence disappears silently. Compaction summaries are kept
 * because they carry the standing requirements that decide what still matters.
 */
export function conversationTurnsFromSession(
	entries: readonly SessionEntry[],
): readonly ConversationTurn[] {
	const resultTextById = new Map<string, string>();
	const resultToolById = new Map<string, string>();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "toolResult") {
			continue;
		}
		resultTextById.set(
			entry.message.toolCallId,
			truncate(textFromMessageContent(entry.message.content), MAX_TOOL_RESULT_CHARS),
		);
		resultToolById.set(entry.message.toolCallId, entry.message.toolName);
	}
	const claimedResultIds = new Set<string>();
	const turns: ConversationTurn[] = [];
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			turns.push({ role: "summary", text: truncate(entry.summary, MAX_TURN_TEXT_CHARS) });
			continue;
		}
		if (entry.type !== "message") {
			continue;
		}
		const message = entry.message;
		switch (message.role) {
			case "user": {
				const text = textFromMessageContent(message.content);
				if (text.trim().length > 0) {
					turns.push({ role: "user", text: truncate(text, MAX_TURN_TEXT_CHARS) });
				}
				break;
			}
			case "assistant": {
				const pending = pendingToolCallsFromAssistantMessage(message.content);
				const toolCalls: ConversationToolCall[] = pending.map((call) => {
					claimedResultIds.add(call.id);
					return {
						tool: call.tool,
						input: call.input,
						result: resultTextById.get(call.id) ?? "pending",
					};
				});
				const text = truncate(textFromMessageContent(message.content), MAX_TURN_TEXT_CHARS);
				if (text.trim().length === 0 && toolCalls.length === 0) {
					break;
				}
				turns.push(toolCalls.length > 0 ? { role: "assistant", text, toolCalls } : { role: "assistant", text });
				break;
			}
			case "compactionSummary": {
				turns.push({ role: "summary", text: truncate(message.summary, MAX_TURN_TEXT_CHARS) });
				break;
			}
			default:
				break;
		}
	}
	for (const [id, result] of resultTextById) {
		if (claimedResultIds.has(id)) {
			continue;
		}
		turns.push({
			role: "assistant",
			text: "",
			toolCalls: [{ tool: resultToolById.get(id) ?? "unknown", input: "", result }],
		});
	}
	return turns;
}

/** Extracts the standing task from the most recent user turns. */
export function conversationGoal(turns: readonly ConversationTurn[]): string {
	return turns
		.filter((turn) => turn.role === "user" && turn.text.trim().length > 0)
		.slice(-3)
		.map((turn) => turn.text.slice(0, 500))
		.join("\n");
}

/**
 * Keeps the newest turns that fit a token budget, dropping oldest first.
 *
 * The newest turn is always kept even when it alone exceeds the budget: a relevance question that
 * omits the latest instruction is worse than a slightly oversized request.
 */
export function fitTurnsToTokenBudget(
	turns: readonly ConversationTurn[],
	budgetTokens: number,
): readonly ConversationTurn[] {
	const kept: ConversationTurn[] = [];
	let used = 0;
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index];
		if (turn === undefined) {
			continue;
		}
		const cost = estimateStateTokens(JSON.stringify(turn));
		if (kept.length > 0 && used + cost > budgetTokens) {
			break;
		}
		kept.unshift(turn);
		used += cost;
	}
	return kept;
}
