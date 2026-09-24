import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Parse } from "typebox/value";
import type { Launch, RpcOutboundRecord, RpcRequestBody } from "../types.ts";
import { errorMessage, hasErrorCode, normalizeError } from "../errors.ts";
import { cleanDisplay } from "../prompts.ts";

const STRING_ARRAY_SCHEMA = Type.Array(Type.String());
const RPC_DATA_SCHEMA = Type.Object(
  {
    model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })),
    tokens: Type.Optional(
      Type.Object({
        input: Type.Optional(Type.Number()),
        output: Type.Optional(Type.Number()),
        cacheRead: Type.Optional(Type.Number()),
        cacheWrite: Type.Optional(Type.Number()),
      }),
    ),
    cost: Type.Optional(Type.Number()),
    echo: Type.Optional(Type.Object({ x: Type.Optional(Type.Number()) })),
    text: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const RPC_BLOCK_MESSAGE_SCHEMA = Type.Object(
  {
    role: Type.Optional(Type.String()),
    stopReason: Type.Optional(Type.String()),
    errorMessage: Type.Optional(Type.String()),
    content: Type.Optional(
      Type.Array(
        Type.Object(
          { type: Type.String(), text: Type.Optional(Type.String()) },
          { additionalProperties: true },
        ),
      ),
    ),
    usage: Type.Optional(
      Type.Object(
        {
          input: Type.Optional(Type.Number()),
          output: Type.Optional(Type.Number()),
          cacheRead: Type.Optional(Type.Number()),
          cacheWrite: Type.Optional(Type.Number()),
          cost: Type.Optional(Type.Object({ total: Type.Optional(Type.Number()) })),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);
const RPC_MESSAGE_SCHEMA = Type.Union([
  RPC_BLOCK_MESSAGE_SCHEMA,
  Type.Object(
    {
      role: Type.Union([Type.Literal("system"), Type.Literal("user"), Type.Literal("custom")]),
      content: Type.String(),
    },
    { additionalProperties: true },
  ),
]);
const RPC_EVENT_SCHEMA = Type.Object(
  {
    type: Type.String(),
    id: Type.Optional(Type.String()),
    success: Type.Optional(Type.Boolean()),
    data: Type.Optional(RPC_DATA_SCHEMA),
    error: Type.Optional(Type.String()),
    command: Type.Optional(Type.String()),
    method: Type.Optional(Type.String()),
    message: Type.Optional(RPC_MESSAGE_SCHEMA),
    toolName: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

/** Runtime-validated data returned by Pi RPC requests. */
export type RpcResponseData = Static<typeof RPC_DATA_SCHEMA>;
/** Runtime-validated event emitted by Pi RPC mode. */
export type RpcEvent = Static<typeof RPC_EVENT_SCHEMA>;

/** Configures one bounded Pi RPC child process. */
export interface RpcOptions {
  launch: Launch;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxRecordBytes?: number;
  killGraceMs?: number;
}
interface Pending {
  resolve(value: RpcResponseData): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
/** Resolves a shell-free Pi executable and argument vector. */
export function resolveLaunch(
  env = process.env,
  argv = process.argv,
  executable = process.execPath,
): Launch {
  if (env.PI_SIDEKICK_PI) {
    let args: string[] = [];
    if (env.PI_SIDEKICK_PI_ARGS) {
      try {
        args = Parse(STRING_ARRAY_SCHEMA, JSON.parse(env.PI_SIDEKICK_PI_ARGS));
      } catch (error) {
        throw new Error("PI_SIDEKICK_PI_ARGS must be a JSON string array, not a shell command.", {
          cause: normalizeError(error),
        });
      }
    }
    if (args.some((argument) => argument.includes("\0"))) {
      throw new Error("PI_SIDEKICK_PI_ARGS must be a JSON string array.");
    }
    if (process.platform === "win32" && /\.(cmd|bat)$/iu.test(env.PI_SIDEKICK_PI))
      throw new Error(
        'On Windows, set PI_SIDEKICK_PI to node.exe and PI_SIDEKICK_PI_ARGS to ["C:\\\\path\\\\to\\\\pi\\\\dist\\\\bundle\\\\cli.js"].',
      );
    return { command: env.PI_SIDEKICK_PI, args };
  }
  if (argv[1] && /^(cli|pi)\.(mjs|cjs|js)$/iu.test(basename(argv[1])))
    return { command: executable, args: [argv[1]] };
  if (/^pi(?:\.exe)?$/iu.test(basename(executable))) return { command: executable, args: [] };
  return { command: "pi", args: [] };
}

/** LF-only, bounded JSONL transport. Prompt ACK is NOT task completion. */
export class PiRpc extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, Pending>();
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private stderr = "";
  private stopped = false;
  private dead = false;
  private closing?: Promise<void>;
  private exited?: Promise<void>;
  readonly options: RpcOptions;

  constructor(options: RpcOptions) {
    super();
    this.options = options;
  }
  get alive(): boolean {
    return !!this.child && !this.dead && !this.stopped;
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }
  async start(): Promise<RpcResponseData> {
    if (this.child) throw new Error("RPC process already started.");
    if (this.stopped) throw new Error("RPC process has been closed.");
    const child = spawn(
      this.options.launch.command,
      [...this.options.launch.args, ...this.options.args],
      {
        cwd: this.options.cwd,
        env: {
          ...process.env,
          ...this.options.env,
          PI_SIDEKICK_CHILD: "1",
          PI_SKIP_VERSION_CHECK: "1",
        },
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.dead = true;
        const diagnostic = cleanDisplay(this.stderr.trim()).slice(-3000);
        const error = new Error(
          `Sidekick process exited (${signal || code}).${diagnostic ? ` ${diagnostic}` : ""}`,
        );
        this.rejectAll(error);
        if (!this.stopped) this.emit("failure", error);
        resolve();
      });
    });
    child.on("error", (error) =>
      this.fail(new Error(`Cannot launch Pi sidekick: ${error.message}`)),
    );
    child.stdin.on("error", (error) => this.fail(new Error(`Sidekick stdin: ${error.message}`)));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-16000);
    });
    child.stdout.on("data", (chunk: Buffer) => this.parse(this.decoder.write(chunk)));
    try {
      return await this.request("get_state", {}, this.options.requestTimeoutMs ?? 20000);
    } catch (error) {
      await this.close();
      throw normalizeError(error);
    }
  }
  async request(
    type: string,
    body: RpcRequestBody = {},
    timeoutMs = this.options.requestTimeoutMs ?? 15000,
  ): Promise<RpcResponseData> {
    if (!this.alive) throw new Error("Sidekick RPC is not running.");
    const id = randomUUID();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sidekick RPC ${type} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ ...body, type, id });
    });
  }
  private write(record: RpcOutboundRecord): void {
    if (!this.child || this.dead) return;
    this.child.stdin.write(JSON.stringify(record) + "\n", (error) => {
      if (error) this.fail(error);
    });
  }
  private parse(chunk: string): void {
    if (this.dead || this.stopped) return;
    this.buffer += chunk;
    const max = this.options.maxRecordBytes ?? 16 * 1024 * 1024;
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, "utf8") > max) {
        this.fail(new Error("Sidekick RPC record exceeded the size limit."));
        return;
      }
      let data: RpcEvent;
      try {
        data = Parse(RPC_EVENT_SCHEMA, JSON.parse(line));
      } catch {
        this.fail(new Error(`Invalid sidekick JSONL: ${cleanDisplay(line).slice(0, 160)}`));
        return;
      }
      try {
        if (data.type === "response") {
          const responseId = Parse(Type.String(), data.id);
          const pending = this.pending.get(responseId);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(responseId);
          if (data.success === true) {
            pending.resolve(Parse(RPC_DATA_SCHEMA, data.data ?? {}));
          } else {
            const reason = data.error
              ? Parse(Type.String(), data.error)
              : `Sidekick RPC ${JSON.stringify(data.command)} failed.`;
            pending.reject(new Error(reason));
          }
        } else if (data.type === "extension_ui_request") {
          // Headless approval requests fail closed. Never implicitly grant permission.
          const requestId = Parse(Type.String(), data.id);
          const method = Parse(Type.String(), data.method);
          if (method === "confirm") {
            this.write({ type: "extension_ui_response", id: requestId, confirmed: false });
          } else if (["select", "input", "editor"].includes(method)) {
            this.write({ type: "extension_ui_response", id: requestId, cancelled: true });
          }
          this.emit("event", data);
        } else this.emit("event", data);
      } catch (error) {
        this.fail(new Error(`Cannot process sidekick JSONL record: ${errorMessage(error)}`));
        return;
      }
    }
    if (Buffer.byteLength(this.buffer, "utf8") > max)
      this.fail(new Error("Sidekick RPC record exceeded the size limit before LF."));
  }
  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  private fail(error: Error): void {
    if (this.dead || this.stopped) return;
    this.dead = true;
    this.rejectAll(error);
    this.emit("failure", error);
    void this.close();
  }
  /** Clear queued steering before aborting, otherwise Pi can continue queued work. */
  async abort(): Promise<void> {
    if (!this.alive) return;
    try {
      await this.request("clear_queue", {}, 1500);
      await this.request("abort", {}, 3000);
    } catch {
      await this.close();
    }
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = this.terminate();
    return this.closing;
  }
  private async terminate(): Promise<void> {
    this.stopped = true;
    this.rejectAll(new Error("Sidekick RPC closed."));
    const child = this.child;
    if (!child?.pid) return;
    const pid = child.pid;
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
        });
        killer.on("error", () => {
          child.kill();
          resolve();
        });
        killer.on("close", () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch (error) {
        if (!hasErrorCode(error, "ESRCH")) child.kill("SIGTERM");
      }
      // Keep the grace timer even when the group leader exits: descendants can remain.
      await new Promise((resolve) => setTimeout(resolve, this.options.killGraceMs ?? 200));
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (!hasErrorCode(error, "ESRCH")) child.kill("SIGKILL");
      }
    }
    if (this.exited) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }
}
