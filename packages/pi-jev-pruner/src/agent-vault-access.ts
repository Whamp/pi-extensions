/**
 * Resolves the Agent Vault forward proxy that attaches the TypeSafe credential to Jev requests.
 *
 * The extension never holds the TypeSafe key. It holds a proxy token instead: Agent Vault matches
 * the request host against its service table (`typesafe-api` → `api.typesafe.ai/v1/*`) and adds
 * the bearer credential on the way out. The token is a revocable, proxy-only agent token, so a
 * leaked copy cannot read credentials.
 */

/** Everything needed to send a request through Agent Vault. */
export interface AgentVaultAccess {
	/** Forward-proxy URL, for example `http://127.0.0.1:14322`. */
	proxyUrl: string;
	/** Value for the `Proxy-Authorization` header, as a bare token. */
	token: string;
	/** Agent Vault's root CA, in PEM form, so the tunnel honours the proxy's TLS certificate. */
	caPem: string;
}

/**
 * Why Agent Vault access is unavailable, as `/jev-pruner` reports it.
 *
 * `dispatcher-unavailable` covers a failure while building the proxy client, which is a different
 * repair from a missing credential.
 */
export type AgentVaultUnavailableReason =
	| "no-proxy-token"
	| "no-root-ca"
	| "dispatcher-unavailable";

/** The result of resolving Agent Vault access. */
export type AgentVaultAccessOutcome =
	| { kind: "resolved"; access: AgentVaultAccess }
	| { kind: "unavailable"; reason: AgentVaultUnavailableReason };

/** The shell and filesystem operations the resolver needs; tests supply fakes. */
export interface AgentVaultProbe {
	/** Reads a process environment variable. */
	readEnv(name: string): string | undefined;
	/** Reads a UTF-8 file, or returns undefined when it is missing or unreadable. */
	readFile(path: string): Promise<string | undefined>;
	/** Writes a UTF-8 file, creating parent directories as needed. */
	writeFile(path: string, text: string): Promise<void>;
	/** Runs a command and resolves with its stdout, or undefined when it fails. */
	runCommand(
		command: string,
		args: readonly string[],
		timeoutMs: number,
	): Promise<string | undefined>;
}

/** Proton Pass item holding the proxy-only agent token that Agent Vault accepts. */
export const AGENT_VAULT_TOKEN_ITEM_TITLE = "Endurance Agent Vault pi-zai-pilot";
/** Proton Pass vault holding that item. */
export const AGENT_VAULT_TOKEN_VAULT_NAME = "Agent Secrets";
/** Host running the Agent Vault container, with the user that owns the Docker daemon. */
export const AGENT_VAULT_SSH_TARGET = "root@endurance";
/** Docker container name of the Agent Vault server. */
export const AGENT_VAULT_CONTAINER = "Agent-Vault";

const TOKEN_ENV_NAMES = ["AGENT_VAULT_TOKEN"];
const CA_ENV_NAMES = ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "CURL_CA_BUNDLE"];
const COMMAND_TIMEOUT_MS = 15_000;

function isJsonPropertyBag(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reads the proxy token out of the Proton Pass item's login password field. */
function proxyTokenFromPassCliJson(stdout: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	if (!isJsonPropertyBag(parsed) || !isJsonPropertyBag(parsed.item)) {
		return undefined;
	}
	const content = parsed.item.content;
	if (!isJsonPropertyBag(content) || !isJsonPropertyBag(content.content)) {
		return undefined;
	}
	const login = content.content.Login;
	if (!isJsonPropertyBag(login)) {
		return undefined;
	}
	const password = login.password;
	return typeof password === "string" && password.length > 0 ? password : undefined;
}

async function readToken(probe: AgentVaultProbe): Promise<string | undefined> {
	for (const name of TOKEN_ENV_NAMES) {
		const token = probe.readEnv(name);
		if (token !== undefined && token.length > 0) {
			return token;
		}
	}
	const stdout = await probe.runCommand(
		"pass-cli",
		[
			"item",
			"view",
			"--vault-name",
			AGENT_VAULT_TOKEN_VAULT_NAME,
			"--item-title",
			AGENT_VAULT_TOKEN_ITEM_TITLE,
			"--output",
			"json",
		],
		COMMAND_TIMEOUT_MS,
	);
	return stdout === undefined ? undefined : proxyTokenFromPassCliJson(stdout);
}

async function readCertificateAuthority(
	probe: AgentVaultProbe,
	caCachePath: string,
): Promise<string | undefined> {
	for (const name of CA_ENV_NAMES) {
		const path = probe.readEnv(name);
		if (path === undefined || path.length === 0) {
			continue;
		}
		const pem = await probe.readFile(path);
		if (pem !== undefined && pem.includes("BEGIN CERTIFICATE")) {
			return pem;
		}
	}
	const cached = await probe.readFile(caCachePath);
	if (cached !== undefined && cached.includes("BEGIN CERTIFICATE")) {
		return cached;
	}
	const fetched = await probe.runCommand(
		"ssh",
		[
			"-o",
			"IdentitiesOnly=yes",
			"-o",
			"BatchMode=yes",
			AGENT_VAULT_SSH_TARGET,
			`docker exec ${AGENT_VAULT_CONTAINER} agent-vault ca fetch`,
		],
		COMMAND_TIMEOUT_MS,
	);
	if (fetched === undefined || !fetched.includes("BEGIN CERTIFICATE")) {
		return undefined;
	}
	await probe.writeFile(caCachePath, fetched);
	return fetched;
}

/**
 * Resolves the proxy URL, proxy token, and root CA.
 *
 * An unavailable result carries the reason, because "credentials are not set up" is the most
 * common way for pruning to do nothing, and the status command is the only place that can say so.
 * Callers leave tool output untouched either way, so a missing token, an unreachable Agent Vault
 * host, or a locked Proton Pass session degrades to pi's own behaviour instead of failing a tool
 * call.
 */
export async function resolveAgentVaultAccess(
	probe: AgentVaultProbe,
	proxyUrl: string,
	caCachePath: string,
): Promise<AgentVaultAccessOutcome> {
	const token = await readToken(probe);
	if (token === undefined) {
		return { kind: "unavailable", reason: "no-proxy-token" };
	}
	const caPem = await readCertificateAuthority(probe, caCachePath);
	if (caPem === undefined) {
		return { kind: "unavailable", reason: "no-root-ca" };
	}
	return { kind: "resolved", access: { proxyUrl, token, caPem } };
}
