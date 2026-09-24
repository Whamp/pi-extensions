import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const REPORT_TEXT = "Offline compatibility handoff complete.";
const LOCAL_HOST = "127.0.0.1";
const API_KEY = "offline-fixture";
const ASSISTANT_USAGE = { prompt_tokens: 17, completion_tokens: 7, total_tokens: 24 };

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function createPi087CompatibilityHarness({
  packageRoot,
  piCliPath,
  hostManifestPath,
}) {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-sidekick-pi087-"));
  const projectDir = join(tempRoot, "project");
  const homeDir = join(tempRoot, "home");
  const agentDir = join(tempRoot, "agent");
  const cliSessionDir = join(tempRoot, "cli-sessions");
  const parentSessionDir = join(tempRoot, "parent-sessions");
  const xdgConfigDir = join(tempRoot, "xdg-config");
  const xdgCacheDir = join(tempRoot, "xdg-cache");
  const tmpDir = join(tempRoot, "tmp");
  for (const directory of [
    projectDir,
    homeDir,
    agentDir,
    cliSessionDir,
    parentSessionDir,
    xdgConfigDir,
    xdgCacheDir,
    tmpDir,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const requests = [];
  const unexpectedRequests = [];
  const protocolEvents = [];
  const milestones = [];
  const toolExecutionEvents = [];
  const workers = [];
  let runner;
  let port;

  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", `http://${LOCAL_HOST}`).pathname;
      if (request.method === "GET" && path === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model" }] }),
        );
        return;
      }
      if (request.method !== "POST" || path !== "/v1/chat/completions") {
        unexpectedRequests.push(`${request.method} ${path}`);
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Unexpected fixture path" } }));
        return;
      }
      const body = JSON.parse(await readRequestBody(request));
      requests.push({
        path,
        model: body.model,
        stream: body.stream,
        roles: Array.isArray(body.messages) ? body.messages.map((message) => message.role) : [],
        authorization: request.headers.authorization,
      });
      const id = `chatcmpl-fixture-${requests.length}`;
      const chunk = (choices, usage) => ({
        id,
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture",
        choices,
        ...(usage ? { usage } : {}),
      });
      const events = [
        chunk([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]),
        chunk([{ index: 0, delta: { content: REPORT_TEXT }, finish_reason: null }]),
        chunk([{ index: 0, delta: {}, finish_reason: "stop" }]),
        chunk([], ASSISTANT_USAGE),
      ];
      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      });
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "Fixture server error");
    }
  });

  let store;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (runner) await runner.close();
      else store?.release();
    } finally {
      try {
        await closeServer(server);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  };

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOCAL_HOST, resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    port = address.port;
    writeFileSync(
      join(agentDir, "models.json"),
      `${JSON.stringify(
        {
          providers: {
            "sidekick-offline": {
              baseUrl: `http://${LOCAL_HOST}:${port}/v1`,
              api: "openai-completions",
              apiKey: API_KEY,
              models: [
                {
                  id: "fixture",
                  name: "Offline fixture",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 32768,
                  maxTokens: 1024,
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    const hostManifest = JSON.parse(readFileSync(hostManifestPath, "utf8"));
    assert.equal(hostManifest.version, "0.87.1");

    const [configModule, promptModule, selectorModule, storeModule, rpcModule, runnerModule] =
      await Promise.all(
        [
          "src/config.ts",
          "src/prompt-profiles/pi-prompts.ts",
          "src/prompt-profiles/selectors.ts",
          "src/store.ts",
          "src/sidekick/rpc.ts",
          "src/sidekick/runner.ts",
        ].map((path) => import(pathToFileURL(join(packageRoot, path)).href)),
      );

    const parentId = "pi-087-offline-compatibility";
    const parentSessionManager = SessionManager.create(projectDir, parentSessionDir, {
      id: parentId,
    });
    parentSessionManager.appendMessage({
      role: "user",
      content: "Sidekick host compatibility parent session",
      timestamp: Date.now(),
    });
    parentSessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Parent fixture" }],
      api: "pi-messages",
      provider: "fixture",
      model: "lead-fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    store = new storeModule.SidekickStore(tempRoot, tempRoot, parentId, {
      sessionDir: parentSessionManager.getSessionDir(),
      parentSessionFile: parentSessionManager.getSessionFile(),
    });
    store.acquire();
    const snapshot = store.load();
    const config = {
      ...structuredClone(configModule.DEFAULT_CONFIG),
      enabled: true,
      sidekick: { provider: "sidekick-offline", id: "fixture" },
      thinking: "off",
      tools: ["read"],
    };
    const profile = selectorModule.selectSidekickPromptProfile({
      activeToolNames: config.tools,
      preferExec: config.sidekickPreferExec,
    });
    snapshot.frozenSidekickPrompt = promptModule.freezePiSidekickPrompt(profile, config);
    store.save(snapshot);

    const envCleared = Object.fromEntries(Object.keys(process.env).map((key) => [key, ""]));
    const safeEnv = {
      ...envCleared,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: homeDir,
      TMPDIR: tmpDir,
      TEMP: tmpDir,
      TMP: tmpDir,
      TERM: "xterm-256color",
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: cliSessionDir,
      XDG_CONFIG_HOME: xdgConfigDir,
      XDG_CACHE_HOME: xdgCacheDir,
      PI_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      XAI_API_KEY: "",
      GROQ_API_KEY: "",
      MISTRAL_API_KEY: "",
      OPENROUTER_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      TOGETHER_API_KEY: "",
      FIREWORKS_API_KEY: "",
      CEREBRAS_API_KEY: "",
      AZURE_OPENAI_API_KEY: "",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_SESSION_TOKEN: "",
      AWS_PROFILE: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
    };

    runner = new runnerModule.SidekickRunner({
      store,
      snapshot,
      config,
      trusted: false,
      parentSessionManager,
      rpcFactory: (args, env) => {
        const rpc = new rpcModule.PiRpc({
          launch: { command: process.execPath, args: [piCliPath, "--offline"] },
          args,
          cwd: projectDir,
          env: { ...safeEnv, ...env },
          requestTimeoutMs: 20000,
          killGraceMs: 100,
        });
        workers.push(rpc);
        rpc.on("event", (event) => {
          if (
            (event.type === "message_start" || event.type === "message_end") &&
            (event.message?.role === "system" ||
              event.message?.role === "user" ||
              event.message?.role === "custom")
          ) {
            protocolEvents.push({ type: event.type, role: event.message.role });
          }
          if (event.type === "tool_execution_start") toolExecutionEvents.push(event.type);
          if (event.type === "turn_end" || event.type === "agent_settled") {
            const latest = runner?.handoff;
            milestones.push({
              type: event.type,
              status: latest?.status,
              report: latest?.report,
            });
          }
        });
        return rpc;
      },
    });

    const finalEvidence = (handoffs) => ({
      hostPiVersion: hostManifest.version,
      provider: "sidekick-offline",
      model: "fixture",
      configuredTools: ["read"],
      apiKey: API_KEY,
      serverRequests: requests,
      unexpectedRequests,
      protocolEvents,
      milestones,
      toolExecutionEvents,
      childPids: workers.map((worker) => worker.pid),
      handoffs,
    });

    return {
      runner,
      requests,
      unexpectedRequests,
      protocolEvents,
      milestones,
      toolExecutionEvents,
      workers,
      tempRoot,
      projectDir,
      agentDir,
      port,
      finalEvidence,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
