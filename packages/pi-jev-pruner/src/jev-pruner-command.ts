import type { AgentVaultUnavailableReason } from "./agent-vault-access.ts";
import type { OutputPruneOutcome } from "./output-pruner.ts";
import type { JevPrunerConfig } from "./jev-pruner-config.ts";

/** What the status command reports about the most recent prune attempt. */
export interface JevPrunerLastRun {
	/** Command whose output was considered. */
	command: string;
	/** Outcome of that attempt, or the failure message when it threw. */
	outcome: OutputPruneOutcome | { kind: "failed"; reason: string };
}

/** The parsed form of `/jev-pruner ...`. */
export interface JevPrunerCommandRequest {
	action: "on" | "off" | "status" | "help" | "invalid";
	/** Raw argument text that produced an `invalid` action. */
	argument: string;
}

/** Parses a `/jev-pruner` argument string. With no argument the command reports status. */
export function parseJevPrunerCommand(argument: string): JevPrunerCommandRequest {
	const trimmed = argument.trim();
	if (trimmed.length === 0 || trimmed === "status") {
		return { action: "status", argument: trimmed };
	}
	if (trimmed === "on") {
		return { action: "on", argument: trimmed };
	}
	if (trimmed === "off") {
		return { action: "off", argument: trimmed };
	}
	if (trimmed === "help" || trimmed === "--help") {
		return { action: "help", argument: trimmed };
	}
	return { action: "invalid", argument: trimmed };
}

/** Usage text shown by `/jev-pruner help`. */
export function formatJevPrunerHelp(): string {
	return [
		"jev-pruner — prune large bash output with TypeSafe Jev before the model sees it",
		"",
		"/jev-pruner            show configuration and the last prune attempt",
		"/jev-pruner on|off     enable or disable pruning, saved to the config file",
		"/jev-pruner help       show this text",
		"",
		"Configuration: ~/.pi/agent/extensions/jev-pruner.json",
	].join("\n");
}

/** Everything `/jev-pruner` reports, gathered by the extension. */
export interface JevPrunerStatusInput {
	/** Active configuration. */
	config: JevPrunerConfig;
	/** Where the configuration is read from and written to. */
	configPath: string;
	/** Most recent prune attempt this session. */
	lastRun: JevPrunerLastRun | undefined;
	/** Why Jev is unreachable, when Agent Vault access could not be resolved. */
	accessFailure: AgentVaultUnavailableReason | undefined;
}


/**
 * Names the repair for each way Agent Vault access can fail.
 *
 * A configured lookup is named, because that is the one the operator expects to work; an
 * unconfigured one points at the configuration field that would enable it.
 */
function accessFailureText(
	reason: AgentVaultUnavailableReason,
	config: JevPrunerConfig,
): string {
	switch (reason) {
		case "no-proxy-token":
			return config.passItemTitle.length > 0
				? `no Agent Vault proxy token: set AGENT_VAULT_TOKEN, or unlock the Proton Pass item "${config.passItemTitle}"`
				: "no Agent Vault proxy token: set AGENT_VAULT_TOKEN, or configure passVaultName and passItemTitle";
		case "no-root-ca":
			return config.agentVaultSshTarget.length > 0
				? `no Agent Vault root CA: set NODE_EXTRA_CA_CERTS, or allow ssh ${config.agentVaultSshTarget} to fetch it`
				: "no Agent Vault root CA: set NODE_EXTRA_CA_CERTS, or configure agentVaultSshTarget";
		case "dispatcher-unavailable":
			return "could not build the Agent Vault proxy client";
		default: {
			const exhaustive: never = reason;
			return exhaustive;
		}
	}
}

function describeOutcome(lastRun: JevPrunerLastRun | undefined): string {
	if (lastRun === undefined) {
		return "no bash output has been considered yet this session";
	}
	const { outcome } = lastRun;
	if (outcome.kind === "failed") {
		return `last attempt failed: ${outcome.reason}`;
	}
	if (outcome.kind === "unpruned") {
		return `last output left untouched (${outcome.reason})`;
	}
	const kept = outcome.keptChunks;
	const total = outcome.totalChunks;
	return `last output pruned: kept ${kept}/${total} chunks, dropped ${outcome.droppedLines} lines`;
}

/** Renders the configuration, credential state, and last-run summary that `/jev-pruner` prints. */
export function formatJevPrunerStatus(input: JevPrunerStatusInput): string {
	const { config, configPath, lastRun, accessFailure } = input;
	return [
		`jev-pruner: ${config.enabled ? "on" : "off"}`,
		`config: ${configPath}`,
		`gate: prune above ${config.minTokens} estimated tokens`,
		`chunks: ${config.chunkLines} lines, keep threshold ${config.keepThreshold}`,
		`state: ${config.maxStateTokens} tokens per request, max ${config.maxScoringRequests} requests`,
		`model: ${config.model}`,
		`proxy: ${config.proxyUrl}`,
		accessFailure === undefined
			? "credentials: resolved"
			: `credentials: ${accessFailureText(accessFailure, config)}`,
		describeOutcome(lastRun),
	].join("\n");
}
