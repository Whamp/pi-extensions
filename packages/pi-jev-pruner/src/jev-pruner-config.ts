import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentVaultLocation } from "./agent-vault-access.ts";

/** Everything the extension can be configured with, all of it optional on disk. */
export interface JevPrunerConfig extends AgentVaultLocation {
	/** When false, tool output is never inspected. */
	enabled: boolean;
	/** Estimated token count above which output is worth pruning. */
	minTokens: number;
	/** Lines per chunk before the chunk cap widens them. */
	chunkLines: number;
	/** Noul probability at or above which a chunk is kept. */
	keepThreshold: number;
	/** Token budget one Jev request's state may use. */
	maxStateTokens: number;
	/** Maximum Jev requests one prune run may make. */
	maxScoringRequests: number;
	/** Jev model name. */
	model: string;
}

export const CONFIG_FILENAME = "jev-pruner.json";
export const CA_CACHE_FILENAME = "jev-pruner-agent-vault-ca.pem";
export const MAX_CONFIG_BYTES = 100_000;
/**
 * Agent Vault's conventional local proxy address, used until the configuration names another host.
 */
export const DEFAULT_PROXY_URL = "http://127.0.0.1:14322";

/** The configuration used when the file is missing or a field is invalid. */
export function defaultJevPrunerConfig(): JevPrunerConfig {
	return {
		enabled: true,
		minTokens: 4_000,
		chunkLines: 20,
		keepThreshold: 0.5,
		maxStateTokens: 25_000,
		maxScoringRequests: 8,
		model: "jev-latest",
		proxyUrl: DEFAULT_PROXY_URL,
		passVaultName: "",
		passItemTitle: "",
		agentVaultSshTarget: "",
	};
}

/** Path of the configuration file, honouring `PI_CODING_AGENT_DIR`. */
export function jevPrunerConfigPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_FILENAME);
}

/** Path of the cached Agent Vault root CA, inside the same config directory. */
export function jevPrunerCaCachePath(): string {
	return join(getAgentDir(), "extensions", CA_CACHE_FILENAME);
}

function numberField(raw: Readonly<Record<string, unknown>>, key: string, fallback: number, min: number, max: number): number {
	const value = raw[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}

function stringField(raw: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
	const value = raw[key];
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Reads a field whose empty value is meaningful, such as an Agent Vault location that switches a
 * lookup off. Only a non-string falls back.
 */
function passthroughField(
	raw: Readonly<Record<string, unknown>>,
	key: string,
	fallback: string,
): string {
	const value = raw[key];
	return typeof value === "string" ? value : fallback;
}

/**
 * Reads a configuration document, falling back per field rather than for the whole file.
 *
 * A typo in one field therefore cannot disable pruning silently: the other fields still apply, and
 * the invalid one keeps its default.
 */
export function parseJevPrunerConfig(text: string): JevPrunerConfig {
	const defaults = defaultJevPrunerConfig();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return defaults;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return defaults;
	}
	const raw = parsed as Readonly<Record<string, unknown>>;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : defaults.enabled,
		minTokens: numberField(raw, "minTokens", defaults.minTokens, 200, 200_000),
		chunkLines: Math.floor(numberField(raw, "chunkLines", defaults.chunkLines, 1, 500)),
		keepThreshold: numberField(raw, "keepThreshold", defaults.keepThreshold, 0, 1),
		maxStateTokens: numberField(raw, "maxStateTokens", defaults.maxStateTokens, 1_000, 200_000),
		maxScoringRequests: Math.floor(numberField(raw, "maxScoringRequests", defaults.maxScoringRequests, 1, 64)),
		model: stringField(raw, "model", defaults.model),
		proxyUrl: stringField(raw, "proxyUrl", defaults.proxyUrl),
		passVaultName: passthroughField(raw, "passVaultName", defaults.passVaultName),
		passItemTitle: passthroughField(raw, "passItemTitle", defaults.passItemTitle),
		agentVaultSshTarget: passthroughField(raw, "agentVaultSshTarget", defaults.agentVaultSshTarget),
	};
}

/** Loads the configuration from disk, returning defaults for a missing, invalid, or oversized file. */
export function loadJevPrunerConfig(path: string = jevPrunerConfigPath()): JevPrunerConfig {
	try {
		if (!existsSync(path)) {
			return defaultJevPrunerConfig();
		}
		const stats = lstatSync(path);
		if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
			return defaultJevPrunerConfig();
		}
		return parseJevPrunerConfig(readFileSync(path, "utf8"));
	} catch {
		return defaultJevPrunerConfig();
	}
}

/**
 * Writes the configuration through a temporary file and a rename, mode 0600.
 *
 * Returns false instead of throwing: a configuration write that fails must not break the command
 * that requested it.
 */
export function saveJevPrunerConfig(
	config: JevPrunerConfig,
	path: string = jevPrunerConfigPath(),
): boolean {
	const body = `${JSON.stringify(config, null, "\t")}\n`;
	const directory = dirname(path);
	const temporary = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (existsSync(path) && !lstatSync(path).isFile()) {
			return false;
		}
		writeFileSync(temporary, body, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
		return true;
	} catch {
		try {
			if (existsSync(temporary)) {
				unlinkSync(temporary);
			}
		} catch {
			// Best-effort cleanup; the temporary file is not worth failing the command over.
		}
		return false;
	}
}

/** Home directory used when resolving a `~`-prefixed path from configuration. */
export function expandHomePath(path: string): string {
	return path.replace(/^~(?=\/|$)/, homedir());
}
