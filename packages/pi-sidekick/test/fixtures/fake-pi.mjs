// A deterministic, local protocol fixture. No models, credentials, or network calls.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const arg = (key, fallback = "") => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : fallback;
};
const scenario = arg("--scenario", "normal");
const journal = arg("--journal");
const session = arg("--session");
const record = (x) => {
  if (journal) appendFileSync(journal, JSON.stringify(x) + "\n");
};
const sessionRecords =
  session && existsSync(session)
    ? readFileSync(session, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
let count = sessionRecords.filter(
  (entry) => entry.type === "message" && entry.message?.role === "user",
).length;
let lastSessionEntryId = sessionRecords.at(-1)?.id ?? null;
const appendSessionMessage = (message) => {
  if (!session) return;
  const entry = {
    type: "message",
    id: randomUUID(),
    parentId: lastSessionEntryId,
    timestamp: new Date().toISOString(),
    message,
  };
  appendFileSync(session, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  lastSessionEntryId = entry.id;
};
record({ type: "spawn", args, pid: process.pid });
const handshakePath = process.env.PI_SIDEKICK_CAPABILITY_HANDSHAKE;
const handshakeNonce = process.env.PI_SIDEKICK_CAPABILITY_NONCE;
if (handshakePath && handshakeNonce) {
  const activeToolNames = arg("--tools").split(",").filter(Boolean).sort();
  if (scenario === "missing-tool") activeToolNames.pop();
  const payload =
    scenario === "malformed-handshake"
      ? "{not-json\n"
      : `${JSON.stringify({ nonce: handshakeNonce, pid: process.pid, activeToolNames })}\n`;
  writeFileSync(`${handshakePath}.tmp`, payload, { mode: 0o600 });
  renameSync(`${handshakePath}.tmp`, handshakePath);
}
let streaming = false;
let timers = [];
const later = (fn, ms) => {
  const t = setTimeout(fn, ms);
  timers.push(t);
};
const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const emit = (x) => {
  if (scenario === "compatibility-messages" && ["message_start", "message_end"].includes(x.type)) {
    record({ type: "event", eventType: x.type, message: x.message });
  }
  if (x.type === "message_end" && x.message?.role === "assistant") {
    appendSessionMessage(x.message);
    const u = x.message.usage;
    for (const k of ["input", "output", "cacheRead", "cacheWrite"]) usageTotals[k] += u[k] || 0;
    usageTotals.cost += u.cost?.total || 0;
  }
  process.stdout.write(JSON.stringify(x) + "\n");
};
const response = (req, data = {}) =>
  emit({ type: "response", id: req.id, command: req.type, success: true, data });
const message = (text, stopReason = "stop", cost = 0.01, tools = false) => ({
  role: "assistant",
  content: tools
    ? [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "test.txt" } }]
    : [{ type: "text", text }],
  api: "pi-messages",
  provider: arg("--provider", "test"),
  model: arg("--model", "worker"),
  usage: {
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 5,
    totalTokens: 155,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  },
  stopReason,
  errorMessage: stopReason === "error" ? "Transient test error" : undefined,
  timestamp: Date.now(),
});
const compatibilityMessages = {
  "message-system-string": [
    {
      role: "system",
      content: "",
      sections: { system: "" },
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
  ],
  "message-system-blocks": [
    {
      role: "system",
      content: [{ type: "text", text: "system message block" }],
      sections: { system: "system message block" },
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
  ],
  "message-user-string": [
    {
      role: "user",
      content: "user message content",
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
  ],
  "message-custom-string": [
    {
      role: "custom",
      content: "custom message content",
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
  ],
  "compatibility-messages": [
    {
      role: "system",
      content: "",
      sections: { system: "" },
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
    {
      role: "user",
      content: "user message content",
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
    {
      role: "custom",
      content: "custom message content",
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
    {
      role: "system",
      content: [{ type: "text", text: "system message block" }],
      sections: { system: "system message block" },
      usage: { input: 900, output: 800, cacheRead: 700, cacheWrite: 600, cost: { total: 90 } },
    },
  ],
};
const malformedMessages = {
  "invalid-assistant-string": { role: "assistant", content: "not a block array" },
  "invalid-tool-result-string": { role: "toolResult", content: "not a block array" },
  "invalid-numeric-content": { role: "user", content: 42 },
  "invalid-object-content": { role: "custom", content: { type: "text", text: "not an array" } },
};
function finish(text, reason = "stop", cost = 0.01) {
  const m = message(text, reason, cost);
  emit({ type: "message_end", message: m });
  emit({ type: "turn_end", message: m, toolResults: [] });
  if (scenario === "compaction") {
    usageTotals.input += 200;
    usageTotals.cost += 0.03;
  }
  if (scenario === "expensive-reconciled") usageTotals.cost += 3;
  emit({ type: "agent_end", messages: [m], willRetry: false });
  streaming = false;
  emit({ type: "agent_settled" });
}
function handle(req) {
  record(req);
  if (req.type === "get_state") {
    if (malformedMessages[scenario]) {
      emit({ type: "message_start", message: malformedMessages[scenario] });
      return;
    }
    if (scenario === "missing-response-id") {
      emit({ type: "response" });
      return;
    }
    if (scenario === "bad-start") {
      process.stdout.write("not json\n");
      return;
    }
    response(req, {
      model: {
        provider: arg("--provider", "test"),
        id: scenario === "wrong-model" ? "wrong" : arg("--model", "worker"),
      },
      isStreaming: streaming,
    });
  } else if (req.type === "get_session_stats") {
    response(req, { tokens: usageTotals, cost: usageTotals.cost });
  } else if (req.type === "prompt") {
    if (scenario === "reject") {
      emit({
        type: "response",
        id: req.id,
        command: req.type,
        success: false,
        error: "Rejected test prompt",
      });
      return;
    }
    if (streaming) {
      emit({
        type: "response",
        id: req.id,
        command: req.type,
        success: false,
        error: "Already streaming",
      });
      return;
    }
    count++;
    appendSessionMessage({ role: "user", content: req.message, timestamp: Date.now() });
    streaming = true;
    if (scenario === "settle-before-ack") {
      emit({ type: "agent_start" });
      finish(`Report ${count}: early completion`);
      response(req);
      return;
    }
    if (scenario === "delayed-prompt-ack") {
      streaming = true;
      emit({ type: "agent_start" });
      later(() => response(req), 60);
      return;
    }
    response(req);
    emit({ type: "agent_start" });
    if (compatibilityMessages[scenario]) {
      for (const compatibilityMessage of compatibilityMessages[scenario]) {
        emit({ type: "message_start", message: compatibilityMessage });
        emit({ type: "message_end", message: compatibilityMessage });
      }
      if (scenario === "compatibility-messages") {
        const finalMessage = message(`Report ${count}: compatibility messages ignored`);
        emit({ type: "message_end", message: finalMessage });
        later(() => {
          emit({ type: "turn_end", message: finalMessage, toolResults: [] });
          emit({ type: "agent_end", messages: [finalMessage], willRetry: false });
          streaming = false;
          emit({ type: "agent_settled" });
        }, 120);
      } else {
        finish(`Report ${count}: compatibility messages ignored`);
      }
      return;
    }
    if (scenario === "report-then-hang") {
      emit({
        type: "message_end",
        message: message(`Report ${count}: persisted while running`),
      });
      return;
    }
    if (scenario === "delayed-progress") {
      later(() => {
        emit({
          type: "tool_execution_start",
          toolCallId: "read-delayed",
          toolName: "read",
          args: { path: "delayed.ts" },
        });
        later(() => finish(`Report ${count}: delayed progress`), 20);
      }, 25);
      return;
    }
    if (scenario === "hang" || scenario === "delayed-steer-ack-running") {
      return;
    }
    if (scenario === "crash") {
      later(() => {
        process.stderr.write("fixture crash");
        process.exit(17);
      }, 20);
      return;
    }
    if (scenario === "no-report") {
      later(() => {
        streaming = false;
        emit({ type: "agent_settled" });
      }, 15);
      return;
    }
    if (scenario === "length") {
      later(() => finish("truncated response", "length"), 15);
      return;
    }
    if (scenario === "oversized-report") {
      later(() => finish(`Report ${count}: ${"x".repeat(60_000)}`), 35);
      return;
    }
    if (scenario === "retry") {
      const m = message("temporary failure", "error");
      emit({ type: "message_end", message: m });
      emit({ type: "agent_end", messages: [m], willRetry: true });
      emit({ type: "auto_retry_start", attempt: 1 });
      later(() => finish(`Report ${count}: recovered after retry`), 80);
      return;
    }
    if (scenario === "many-turns") {
      for (let turn = 0; turn < 41; turn++) {
        const m = message("", "toolUse", 0.001, true);
        emit({ type: "message_end", message: m });
        emit({ type: "turn_end", message: m, toolResults: [] });
      }
      finish(`Report ${count}: completed after 41 tool-using turns`);
      return;
    }
    if (scenario === "expensive" || scenario === "expensive-reconciled") {
      later(() => finish(`Report ${count}: expensive but complete`, "stop", 6), 35);
      return;
    }
    emit({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "file.ts" },
    });
    if (scenario === "confirm")
      emit({
        type: "extension_ui_request",
        id: "approval-1",
        method: "confirm",
        title: "Allow destructive operation?",
      });
    later(
      () =>
        finish(
          `Report ${count}: verified fixture; π and Unicode separators \u2028 and \u2029 stay inside JSON strings.`,
        ),
      scenario === "slow" ? 250 : 35,
    );
  } else if (req.type === "clear_queue") response(req, { steering: [], followUp: [] });
  else if (req.type === "abort") {
    timers.forEach(clearTimeout);
    timers = [];
    if (streaming) {
      streaming = false;
      emit({ type: "agent_end", messages: [] });
      emit({ type: "agent_settled" });
    }
    later(() => response(req), 25);
  } else if (req.type === "steer") {
    if (scenario === "delayed-steer-ack" || scenario === "delayed-steer-ack-running") {
      later(() => response(req), 60);
    } else if (scenario === "steer-reject-after-settle") {
      finish(`Report ${count}: settled before steer`);
      later(
        () =>
          emit({
            type: "response",
            id: req.id,
            command: req.type,
            success: false,
            error: "Steer arrived after settlement",
          }),
        20,
      );
    } else {
      response(req);
    }
  } else if (req.type === "extension_ui_response") {
    /* Recorded above. */
  } else if (req.type === "bad_record") process.stdout.write("{not-json\n");
  else if (req.type === "oversized")
    process.stdout.write(JSON.stringify({ type: "noise", text: "x".repeat(3000) }) + "\n");
  else if (req.type === "unterminated") process.stdout.write("x".repeat(3000));
  else if (req.type === "never_respond") {
    /* Deliberate timeout. */
  } else if (req.type === "unicode") {
    const line = Buffer.from(
      JSON.stringify({
        type: "response",
        id: req.id,
        command: req.type,
        success: true,
        data: { text: "Aπ😀\u2028B\u2029C" },
      }) + "\r\n",
    );
    const offset = line.indexOf(Buffer.from("😀"));
    process.stdout.write(line.subarray(0, offset + 1));
    later(() => process.stdout.write(line.subarray(offset + 1, offset + 3)), 2);
    later(() => process.stdout.write(line.subarray(offset + 3)), 4);
  } else response(req, { echo: req });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
