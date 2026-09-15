import assert from "node:assert/strict";
import { createJiti } from "/home/will/.local/share/mise/installs/node/24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: false });
const lifecycleMod = await jiti.import("./lifecycle.ts");
const adapterMod = await jiti.import("./index.ts");

const assistant = {
	role: "assistant",
	provider: "p",
	model: "m",
	api: "a",
	stopReason: "stop",
	usage: { output: 75 },
	timestamp: 456,
};
const session = {
	entries: [
		{ type: "message", id: "u1", message: { role: "user", content: "make it fast" } },
		{ type: "message", id: "a1", message: assistant },
	],
	sessionFile: "/tmp/session.jsonl",
	sessionId: "sid",
	cwd: "/tmp/project",
};

const lifecycle = lifecycleMod.createTokpsLifecycle();
assert.deepEqual(lifecycle.sessionLoaded({ ...session, entries: [] }, false), [{ type: "setStatus", text: undefined }]);
assert.deepEqual(lifecycle.command("on"), [
	{ type: "append", customType: "tokps-state", data: { display: true } },
	{ type: "setStatus", text: undefined },
	{ type: "notify", message: "tokps display: on", level: "info" },
]);

assert.deepEqual(lifecycle.messageStarted(assistant, 1_000, 1_700_000_000_000), []);
assert.deepEqual(lifecycle.messageUpdated(assistant, { type: "start" }, 1_100), [{ type: "setStatus", text: "⚡ decoding…" }]);
assert.deepEqual(lifecycle.messageUpdated(assistant, { type: "text_delta", delta: "hello" }, 1_500), [{ type: "setStatus", text: "⚡ decoding…" }]);
assert.deepEqual(lifecycle.messageUpdated(assistant, { type: "text_delta", delta: " world" }, 2_500), [{ type: "setStatus", text: "⚡ 3.0 tok/s live" }]);
assert.deepEqual(lifecycle.messageEnded(assistant, 3_000, 1_700_000_002_000), [{ type: "setStatus", text: "⚡ 50.0 tok/s" }]);

const appendEffects = lifecycle.turnEnded(assistant, session);
assert.equal(appendEffects.length, 2);
assert.equal(appendEffects[0].type, "append");
assert.equal(appendEffects[0].customType, "tokps-decode-speed");
assert.equal(appendEffects[1].type, "setStatus");
assert.equal(appendEffects[1].text, "⚡ 50.0 tok/s");

const record = appendEffects[0].data;
assert.equal(record.decodeDurationMs, 1_500);
assert.equal(record.wallDurationMs, 2_000);
assert.equal(record.outputTokens, 75);
assert.equal(record.outputTokensEstimated, false);
assert.equal(record.tokensPerSecond, 50);
assert.equal(record.wallTokensPerSecond, 37.5);
assert.equal(record.visibleChars, 11);
assert.equal(record.assistantEntryId, "a1");
assert.equal(record.previousUserEntryId, "u1");
assert.equal(record.previousUserPreview, "make it fast");
assert.equal(record.sessionFile, "/tmp/session.jsonl");
assert.equal(record.sessionId, "sid");
assert.equal(record.cwd, "/tmp/project");

assert.deepEqual(lifecycle.agentEnded(session), []);
assert.deepEqual(lifecycle.command("status"), [{ type: "notify", message: "tokps: 50.0 tok/s (75 tok/1500ms) p/m; display on", level: "info" }]);
assert.deepEqual(lifecycle.command("wat"), [{ type: "notify", message: "Usage: /tokps [on|off|toggle|status]", level: "warning" }]);

const restored = lifecycleMod.createTokpsLifecycle();
assert.deepEqual(
	restored.sessionLoaded({ ...session, entries: [...session.entries, { type: "custom", customType: "tokps-state", data: { display: true } }, { type: "custom", customType: "tokps-decode-speed", data: record }] }, false),
	[{ type: "setStatus", text: "⚡ 50.0 tok/s" }],
);

const estimatedLifecycle = lifecycleMod.createTokpsLifecycle();
const estimatedMessage = { role: "assistant", content: [{ type: "text", text: "12345678" }] };
estimatedLifecycle.messageStarted(estimatedMessage, 0, 0);
estimatedLifecycle.messageEnded(estimatedMessage, 1_000, 1_000);
const estimatedAppend = estimatedLifecycle.agentEnded({ entries: [{ type: "message", id: "a2", message: estimatedMessage }] });
assert.equal(estimatedAppend[0].data.outputTokens, 2);
assert.equal(estimatedAppend[0].data.outputTokensEstimated, true);
assert.equal(estimatedAppend[0].data.tokensPerSecond, null);

const handlers = new Map();
const commands = new Map();
const appends = [];
const statuses = [];
const notices = [];
const pi = {
	on(name, handler) {
		handlers.set(name, handler);
	},
	registerFlag(name) {
		assert.equal(name, "tokps-display");
	},
	getFlag() {
		return true;
	},
	appendEntry(customType, data) {
		appends.push({ customType, data });
	},
	registerCommand(name, command) {
		commands.set(name, command);
	},
};
adapterMod.default(pi);

const ctx = {
	hasUI: true,
	cwd: session.cwd,
	ui: {
		setStatus(name, text) {
			statuses.push({ name, text });
		},
		notify(message, level) {
			notices.push({ message, level });
		},
	},
	sessionManager: {
		getBranch() {
			return session.entries;
		},
		getSessionFile() {
			return session.sessionFile;
		},
		getSessionId() {
			return session.sessionId;
		},
	},
};

for (const name of ["session_start", "session_tree", "message_start", "message_update", "message_end", "turn_end", "agent_end"]) {
	assert.equal(typeof handlers.get(name), "function", `${name} registered`);
}
assert.equal(typeof commands.get("tokps")?.handler, "function");

handlers.get("session_start")({}, ctx);
handlers.get("message_start")({ message: assistant }, ctx);
handlers.get("message_update")({ message: assistant, assistantMessageEvent: { type: "text_delta", delta: "ok" } }, ctx);
handlers.get("message_end")({ message: assistant }, ctx);
handlers.get("turn_end")({ message: assistant }, ctx);
await commands.get("tokps").handler("toggle", ctx);

assert.equal(appends[0].customType, "tokps-decode-speed");
assert.equal(appends[0].data.assistantEntryId, "a1");
assert.equal(appends[0].data.previousUserEntryId, "u1");
assert.equal(appends[1].customType, "tokps-state");
assert.equal(appends[1].data.display, false);
assert.deepEqual(notices.at(-1), { message: "tokps display: off", level: "info" });
assert.equal(statuses.some((status) => status.text === "⚡ decoding…"), true);
assert.equal(statuses.every((status) => status.name === "tokps"), true);
