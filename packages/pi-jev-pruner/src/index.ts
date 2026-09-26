/**
 * @whamp/pi-jev-pruner — prune large bash output with TypeSafe Jev before the model reads it.
 *
 * pi's bash tool truncates a long result to its last 2000 lines and saves the complete stream to a
 * temporary file. That keeps the tail, which for a build log is rarely where the answer is. This
 * extension reads the complete stream, asks Jev one noul question per chunk — "does any line here
 * need to remain available?" — against the conversation, and replaces the chunks that score below
 * the threshold with a marker naming the file the dropped lines are still in.
 *
 * Everything is fail-safe: binary, structured, credential-like, and short output is never sent to
 * Jev, and any read, scoring, or archive failure leaves the tool result exactly as pi produced it.
 * Requests go through Agent Vault, so the TypeSafe credential is attached by the proxy and never
 * held here; the proxy token comes from the `AGENT_VAULT_TOKEN` environment variable or Proton
 * Pass via `pass-cli`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CONFIG_DIR_NAME, isBashToolResult } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveAgentVaultAccess } from "./agent-vault-access.ts";
import type { AgentVaultProbe, AgentVaultUnavailableReason } from "./agent-vault-access.ts";
import { createAgentVaultDispatcher } from "./agent-vault-proxy.ts";
import { pruneBashOutput } from "./bash-output-pruner.ts";
import type { BashOutputPruneResult } from "./bash-output-pruner.ts";
import { createJevAsker } from "./jev-http-asker.ts";
import type { JevAsker } from "./jev-asker.ts";
import { createUndiciJevTransport } from "./jev-undici-transport.ts";
import {
	formatJevPrunerHelp,
	formatJevPrunerStatus,
	parseJevPrunerCommand,
} from "./jev-pruner-command.ts";
import type { JevPrunerLastRun } from "./jev-pruner-command.ts";
import {
	expandHomePath,
	jevPrunerCaCachePath,
	jevPrunerConfigPath,
	loadJevPrunerConfig,
	saveJevPrunerConfig,
} from "./jev-pruner-config.ts";
import { estimateOutputTokens } from "./output-token-estimate.ts";
import { writeOutputArchive } from "./output-archive.ts";
import { pruneOptionsFromConfig } from "./output-pruner.ts";
import type { OutputPruneOptions } from "./output-pruner.ts";
import { conversationTurnsFromSession } from "./session-history.ts";

const STATUS_KEY = "jev-pruner";
/** How long a failed credential resolution is remembered before it is retried. */
const RETRY_ACCESS_AFTER_MS = 300_000;

/** The process-backed parts of the extension that tests replace. */
export interface JevPrunerRuntime {
	/** Reads the environment, files, and commands Agent Vault access is resolved from. */
	probe: AgentVaultProbe;
	/** Builds a Jev asker, or returns undefined when credentials are unavailable. */
	resolveAsker(ctx: ExtensionContext): Promise<JevAsker | undefined>;
	/** Why Jev is unreachable right now, for the status command. */
	accessFailure(): AgentVaultUnavailableReason | undefined;
}

interface ResolvedDispatcher {
	dispatcher: ReturnType<typeof createAgentVaultDispatcher> | undefined;
	validUntilMs: number;
}

function textFromBashResult(content: readonly { type: string }[]): string {
	const parts: string[] = [];
	for (const part of content) {
		if (part.type === "text" && "text" in part && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("\n");
}

function statusText(result: BashOutputPruneResult): string | undefined {
	if (result.outcome.kind !== "pruned") {
		return undefined;
	}
	const { keptChunks, totalChunks, droppedLines } = result.outcome;
	return `kept ${keptChunks}/${totalChunks} chunks, dropped ${droppedLines} lines`;
}

/** Builds the runtime that talks to the operating system and to Agent Vault. */
export function createJevPrunerRuntime(pi: ExtensionAPI): JevPrunerRuntime {
	const location = loadJevPrunerConfig();
	const caCachePath = jevPrunerCaCachePath();
	let accessFailure: AgentVaultUnavailableReason | undefined;
	let resolved: ResolvedDispatcher | undefined;
	const probe: AgentVaultProbe = {
		readEnv(name) {
			return process.env[name];
		},
		async readFile(path) {
			try {
				return await readFile(expandHomePath(path), "utf8");
			} catch {
				return undefined;
			}
		},
		async writeFile(path, text) {
			const target = expandHomePath(path);
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, text, { mode: 0o600 });
		},
		async runCommand(command, args, timeoutMs) {
			try {
				const result = await pi.exec(command, [...args], { timeout: timeoutMs });
				return result.code === 0 ? result.stdout : undefined;
			} catch {
				return undefined;
			}
		},
	};
	return {
		probe,
		accessFailure: () => accessFailure,
		async resolveAsker(ctx) {
			const now = Date.now();
			if (resolved === undefined || resolved.validUntilMs <= now) {
				let dispatcher: ResolvedDispatcher["dispatcher"];
				try {
					const outcome = await resolveAgentVaultAccess(probe, location, caCachePath);
					if (outcome.kind === "resolved") {
						dispatcher = createAgentVaultDispatcher(outcome.access);
						accessFailure = undefined;
					} else {
						accessFailure = outcome.reason;
					}
				} catch {
					accessFailure = "dispatcher-unavailable";
				}
				resolved = {
					dispatcher,
					validUntilMs:
						dispatcher === undefined
							? now + RETRY_ACCESS_AFTER_MS
							: now + Number.MAX_SAFE_INTEGER,
				};
			}
			if (resolved.dispatcher === undefined) {
				return undefined;
			}
			return createJevAsker(
				createUndiciJevTransport({
					dispatcher: resolved.dispatcher,
					...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
				}),
			);
		},
	};
}

/** Registers the bash output pruner and its `/jev-pruner` command. */
export default function jevPrunerExtension(
	pi: ExtensionAPI,
	runtime: JevPrunerRuntime = createJevPrunerRuntime(pi),
): void {
	const configPath = jevPrunerConfigPath();
	let config = loadJevPrunerConfig(configPath);
	let lastRun: JevPrunerLastRun | undefined;

	async function handleBashResult(
		content: readonly { type: string }[],
		command: string,
		fullOutputPath: string | undefined,
		toolCallId: string,
		ctx: ExtensionContext,
		options: OutputPruneOptions,
	): Promise<BashOutputPruneResult | undefined> {
		const contentText = textFromBashResult(content);
		if (fullOutputPath === undefined && estimateOutputTokens(contentText) <= config.minTokens) {
			return undefined;
		}
		const asker = await runtime.resolveAsker(ctx);
		if (asker === undefined) {
			return undefined;
		}
		const history = conversationTurnsFromSession(ctx.sessionManager.buildContextEntries());
		return await pruneBashOutput(
			{
				command,
				toolCallId,
				contentText,
				fullOutputPath,
				history,
				projectConfigDir: CONFIG_DIR_NAME,
				options,
			},
			{
				readFileText: runtime.probe.readFile,
				writeArchive: (target, text) => writeOutputArchive(target, text, runtime.probe.writeFile),
				asker,
				now: Date.now,
			},
		);
	}

	pi.on("tool_result", async (event, ctx) => {
		if (!config.enabled || !isBashToolResult(event) || event.isError) {
			return undefined;
		}
		const command = typeof event.input.command === "string" ? event.input.command : "";
		try {
			const result = await handleBashResult(
				event.content,
				command,
				event.details?.fullOutputPath,
				event.toolCallId,
				ctx,
				pruneOptionsFromConfig(config),
			);
			if (result === undefined) {
				return undefined;
			}
			lastRun = { command, outcome: result.outcome };
			const status = statusText(result);
			if (status !== undefined) {
				ctx.ui.setStatus(STATUS_KEY, status);
			}
			return result.contentText === undefined
				? undefined
				: { content: [{ type: "text" as const, text: result.contentText }] };
		} catch (error) {
			lastRun = {
				command,
				outcome: {
					kind: "failed",
					reason: error instanceof Error ? error.message : String(error),
				},
			};
			return undefined;
		}
	});

	pi.registerCommand("jev-pruner", {
		description: "Prune large bash output with Jev (on, off, status)",
		handler: async (argument, ctx) => {
			const request = parseJevPrunerCommand(argument);
			switch (request.action) {
				case "on":
				case "off": {
					config = { ...config, enabled: request.action === "on" };
					const saved = saveJevPrunerConfig(config, configPath);
					ctx.ui.notify(
						saved
							? `jev-pruner ${request.action}`
							: `jev-pruner ${request.action} for this session only: writing ${configPath} failed`,
						saved ? "info" : "error",
					);
					return;
				}
				case "help": {
					ctx.ui.notify(formatJevPrunerHelp(), "info");
					return;
				}
				case "invalid": {
					ctx.ui.notify(
						`unknown argument "${request.argument}"\n\n${formatJevPrunerHelp()}`,
						"error",
					);
					return;
				}
				case "status": {
					ctx.ui.notify(
						formatJevPrunerStatus({
							config,
							configPath,
							lastRun,
							accessFailure: runtime.accessFailure(),
						}),
						"info",
					);
					return;
				}
				default: {
					const exhaustive: never = request.action;
					return exhaustive;
				}
			}
		},
	});
}
