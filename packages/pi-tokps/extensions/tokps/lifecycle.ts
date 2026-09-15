export const SPEED_ENTRY = "tokps-decode-speed";
export const STATE_ENTRY = "tokps-state";

export type DecodeSpeedRecord = {
	schemaVersion: 1;
	kind: "decode_speed";
	provider?: string;
	model?: string;
	api?: string;
	stopReason?: string;
	assistantTimestamp?: number;
	assistantEntryId?: string;
	previousUserEntryId?: string;
	previousUserPreview?: string;
	sessionFile?: string;
	sessionId?: string;
	cwd?: string;
	startedAt: string;
	endedAt: string;
	wallDurationMs: number;
	decodeDurationMs: number | null;
	outputTokens: number;
	outputTokensEstimated: boolean;
	tokensPerSecond: number | null;
	wallTokensPerSecond: number | null;
	visibleChars: number;
	streamEvents: number;
};

export type TokpsMessage = {
	role?: unknown;
	provider?: unknown;
	model?: unknown;
	api?: unknown;
	stopReason?: unknown;
	timestamp?: unknown;
	usage?: { output?: unknown };
	content?: unknown;
};

export type TokpsSessionEntry = {
	type?: unknown;
	id?: unknown;
	customType?: unknown;
	data?: unknown;
	message?: TokpsMessage;
};

export type TokpsSessionSnapshot = {
	entries: TokpsSessionEntry[];
	sessionFile?: string;
	sessionId?: string;
	cwd?: string;
};

export type TokpsStreamEvent = {
	type?: unknown;
	delta?: unknown;
};

export type TokpsEffect =
	| { type: "append"; customType: typeof SPEED_ENTRY; data: DecodeSpeedRecord }
	| { type: "append"; customType: typeof STATE_ENTRY; data: { display: boolean } }
	| { type: "setStatus"; text?: string }
	| { type: "notify"; message: string; level: "info" | "warning" | "error" };

type DecodeSample = {
	startedAtMs: number;
	startedAtWallMs: number;
	firstStreamAtMs?: number;
	firstOutputAtMs?: number;
	visibleChars: number;
	streamEvents: number;
};

type PendingRecord = {
	record: DecodeSpeedRecord;
	message: TokpsMessage;
};

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const item = block as { type?: unknown; text?: unknown; thinking?: unknown };
			if (item.type === "text" && typeof item.text === "string") return item.text;
			if (item.type === "thinking" && typeof item.thinking === "string") return item.thinking;
			return "";
		})
		.join("");
}

function estimatedTokensFromChars(chars: number): number {
	return chars === 0 ? 0 : Math.max(1, Math.round(chars / 4));
}

function outputTokenCount(message: TokpsMessage): { tokens: number; estimated: boolean } {
	const usageOutput = finiteNumber(message.usage?.output);
	if (usageOutput !== undefined) return { tokens: usageOutput, estimated: false };

	return { tokens: estimatedTokensFromChars(textFromContent(message.content).length), estimated: true };
}

function rate(tokens: number, durationMs: number | null): number | null {
	if (durationMs === null || durationMs <= 0) return null;
	return Math.round((tokens / (durationMs / 1000)) * 10) / 10;
}

function formatRecord(record: DecodeSpeedRecord | undefined): string {
	if (!record) return "tokps: no decode speed recorded yet";
	const speed = record.tokensPerSecond === null ? "n/a" : `${record.tokensPerSecond.toFixed(1)} tok/s`;
	const model = record.provider && record.model ? ` ${record.provider}/${record.model}` : "";
	return `tokps: ${speed} (${record.outputTokens} tok/${record.decodeDurationMs ?? "?"}ms)${model}`;
}

function isAssistant(message: TokpsMessage): boolean {
	return message.role === "assistant";
}

function startDecodeSample(nowMs: number, wallMs = nowMs): DecodeSample {
	return { startedAtMs: nowMs, startedAtWallMs: wallMs, visibleChars: 0, streamEvents: 0 };
}

function observeStreamEvent(sample: DecodeSample, event: TokpsStreamEvent, nowMs: number): void {
	sample.firstStreamAtMs ??= nowMs;
	sample.streamEvents += 1;

	if (event.type !== "text_delta" && event.type !== "thinking_delta" && event.type !== "toolcall_delta") return;

	sample.firstOutputAtMs ??= nowMs;
	if (typeof event.delta === "string") sample.visibleChars += event.delta.length;
}

function finishDecodeSpeed(sample: DecodeSample, message: TokpsMessage, endMs: number, endWallMs = endMs): DecodeSpeedRecord {
	const { tokens, estimated } = outputTokenCount(message);
	const wallDurationMs = Math.max(0, Math.round(endMs - sample.startedAtMs));
	const decodeStartMs = sample.firstOutputAtMs ?? sample.firstStreamAtMs;
	const decodeDurationMs = decodeStartMs === undefined ? null : Math.max(0, Math.round(endMs - decodeStartMs));

	return {
		schemaVersion: 1,
		kind: "decode_speed",
		provider: stringValue(message.provider),
		model: stringValue(message.model),
		api: stringValue(message.api),
		stopReason: stringValue(message.stopReason),
		assistantTimestamp: finiteNumber(message.timestamp),
		startedAt: new Date(sample.startedAtWallMs).toISOString(),
		endedAt: new Date(endWallMs).toISOString(),
		wallDurationMs,
		decodeDurationMs,
		outputTokens: tokens,
		outputTokensEstimated: estimated,
		tokensPerSecond: rate(tokens, decodeDurationMs),
		wallTokensPerSecond: rate(tokens, wallDurationMs),
		visibleChars: sample.visibleChars,
		streamEvents: sample.streamEvents,
	};
}

function messagePreview(message: TokpsMessage | undefined): string | undefined {
	if (!message) return undefined;
	const text = textFromContent(message.content).replace(/\s+/g, " ").trim();
	return text ? text.slice(0, 200) : undefined;
}

function findAssistantEntry(entries: TokpsSessionEntry[], message: TokpsMessage): TokpsSessionEntry | undefined {
	const timestamp = finiteNumber(message.timestamp);
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		if (timestamp !== undefined && entry.message.timestamp === timestamp) return entry;
		if (entry.message?.model === message.model && entry.message?.provider === message.provider) return entry;
	}
	return undefined;
}

function findPreviousUserEntry(entries: TokpsSessionEntry[], beforeId?: string): TokpsSessionEntry | undefined {
	let start = entries.length - 1;
	if (beforeId) {
		const index = entries.findIndex((entry) => entry.id === beforeId);
		if (index >= 0) start = index - 1;
	}

	for (let i = start; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "user") return entry;
	}
	return undefined;
}

function latestRecord(entries: TokpsSessionEntry[]): DecodeSpeedRecord | undefined {
	let latest: DecodeSpeedRecord | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SPEED_ENTRY) continue;
		const data = entry.data as Partial<DecodeSpeedRecord> | undefined;
		if (data?.kind === "decode_speed" && data.schemaVersion === 1) latest = data as DecodeSpeedRecord;
	}
	return latest;
}

function restoreDisplay(entries: TokpsSessionEntry[], fallback: boolean): boolean {
	let display = fallback;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
		const data = entry.data as { display?: unknown } | undefined;
		if (typeof data?.display === "boolean") display = data.display;
	}
	return display;
}

function withSessionMetadata(record: DecodeSpeedRecord, session: TokpsSessionSnapshot, message: TokpsMessage): DecodeSpeedRecord {
	const assistant = findAssistantEntry(session.entries, message);
	const previousUser = findPreviousUserEntry(session.entries, stringValue(assistant?.id));

	return {
		...record,
		assistantEntryId: stringValue(assistant?.id),
		previousUserEntryId: stringValue(previousUser?.id),
		previousUserPreview: messagePreview(previousUser?.message),
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		cwd: session.cwd,
	};
}

function statusText(display: boolean, record: DecodeSpeedRecord | undefined): string | undefined {
	return display && record?.tokensPerSecond != null ? `⚡ ${record.tokensPerSecond.toFixed(1)} tok/s` : undefined;
}

function liveStatusText(display: boolean, sample: DecodeSample, nowMs: number): string | undefined {
	if (!display) return undefined;
	const tokensPerSecond = rate(estimatedTokensFromChars(sample.visibleChars), sample.firstOutputAtMs === undefined ? null : nowMs - sample.firstOutputAtMs);
	return tokensPerSecond === null ? "⚡ decoding…" : `⚡ ${tokensPerSecond.toFixed(1)} tok/s live`;
}

export function createTokpsLifecycle() {
	let display = false;
	let current: DecodeSample | undefined;
	let pending: PendingRecord | undefined;
	let last: DecodeSpeedRecord | undefined;

	function statusEffect(): TokpsEffect {
		return { type: "setStatus", text: statusText(display, last) };
	}

	function appendPending(session: TokpsSessionSnapshot): TokpsEffect[] {
		if (!pending) return [];
		last = withSessionMetadata(pending.record, session, pending.message);
		pending = undefined;
		return [{ type: "append", customType: SPEED_ENTRY, data: last }, statusEffect()];
	}

	return {
		sessionLoaded(session: TokpsSessionSnapshot, fallbackDisplay: boolean): TokpsEffect[] {
			display = restoreDisplay(session.entries, fallbackDisplay);
			last = latestRecord(session.entries);
			return [statusEffect()];
		},

		messageStarted(message: TokpsMessage, nowMs = Date.now(), wallMs = nowMs): TokpsEffect[] {
			if (!isAssistant(message)) return [];
			current = startDecodeSample(nowMs, wallMs);
			return [];
		},

		messageUpdated(message: TokpsMessage, event: TokpsStreamEvent, nowMs = Date.now()): TokpsEffect[] {
			if (!current || !isAssistant(message)) return [];
			observeStreamEvent(current, event, nowMs);
			const text = liveStatusText(display, current, nowMs);
			return text === undefined ? [] : [{ type: "setStatus", text }];
		},

		messageEnded(message: TokpsMessage, nowMs = Date.now(), wallMs = nowMs): TokpsEffect[] {
			if (!current || !isAssistant(message)) return [];
			pending = { record: finishDecodeSpeed(current, message, nowMs, wallMs), message };
			current = undefined;
			last = pending.record;
			return [statusEffect()];
		},

		turnEnded(message: TokpsMessage, session: TokpsSessionSnapshot): TokpsEffect[] {
			if (!isAssistant(message)) return [];
			return appendPending(session);
		},

		agentEnded(session: TokpsSessionSnapshot): TokpsEffect[] {
			return appendPending(session);
		},

		command(args: string): TokpsEffect[] {
			const action = args.trim().toLowerCase() || "status";

			if (action === "on" || action === "off" || action === "toggle") {
				display = action === "toggle" ? !display : action === "on";
				return [
					{ type: "append", customType: STATE_ENTRY, data: { display } },
					statusEffect(),
					{ type: "notify", message: `tokps display: ${display ? "on" : "off"}`, level: "info" },
				];
			}

			if (action !== "status") return [{ type: "notify", message: "Usage: /tokps [on|off|toggle|status]", level: "warning" }];

			return [{ type: "notify", message: `${formatRecord(last)}; display ${display ? "on" : "off"}`, level: "info" }];
		},
	};
}
