import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAgentVaultAccess } from "./agent-vault-access.ts";
import type { AgentVaultProbe } from "./agent-vault-access.ts";

const PROXY_URL = "http://127.0.0.1:14322";
const CA_CACHE_PATH = "/home/will/.pi/agent/extensions/jev-pruner-agent-vault-ca.pem";
const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";
const PASS_CLI_JSON = JSON.stringify({
	item: { content: { content: { Login: { password: "av_agt_token" } } } },
});

interface FakeWorld {
	env: Record<string, string>;
	files: Record<string, string>;
	commandResults: Record<string, string | undefined>;
}

interface FakeProbe {
	probe: AgentVaultProbe;
	commands: string[];
	written: Record<string, string>;
}

function fakeProbe(world: FakeWorld): FakeProbe {
	const commands: string[] = [];
	const written: Record<string, string> = {};
	const probe: AgentVaultProbe = {
		readEnv(name) {
			return world.env[name];
		},
		async readFile(path) {
			return world.files[path];
		},
		async writeFile(path, text) {
			written[path] = text;
			world.files[path] = text;
		},
		async runCommand(command, args) {
			commands.push([command, ...args].join(" "));
			return world.commandResults[command];
		},
	};
	return { probe, commands, written };
}

describe("resolveAgentVaultAccess", () => {
	it("prefers the environment token and an environment CA path", async () => {
		const { probe, commands } = fakeProbe({
			env: { AGENT_VAULT_TOKEN: "env-token", NODE_EXTRA_CA_CERTS: "/etc/av-ca.pem" },
			files: { "/etc/av-ca.pem": CA_PEM },
			commandResults: {},
		});
		const outcome = await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH);
		assert.deepEqual(outcome, {
			kind: "resolved",
			access: { proxyUrl: PROXY_URL, token: "env-token", caPem: CA_PEM },
		});
		assert.deepEqual(commands, [], "no shell command is needed when both values are present");
	});

	it("reads the proxy token from Proton Pass when the environment has none", async () => {
		const { probe, commands } = fakeProbe({
			env: {},
			files: { CA_CACHE_PATH },
			commandResults: { "pass-cli": PASS_CLI_JSON, ssh: CA_PEM },
		});
		const outcome = await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH);
		assert.equal(outcome.kind === "resolved" ? outcome.access.token : undefined, "av_agt_token");
		assert.match(commands[0] ?? "", /^pass-cli item view --vault-name Agent Secrets/);
	});

	it("uses the cached CA before reaching for SSH", async () => {
		const { probe, commands } = fakeProbe({
			env: { AGENT_VAULT_TOKEN: "token" },
			files: { [CA_CACHE_PATH]: CA_PEM },
			commandResults: { ssh: CA_PEM },
		});
		const outcome = await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH);
		assert.equal(outcome.kind === "resolved" ? outcome.access.caPem : undefined, CA_PEM);
		assert.deepEqual(commands, []);
	});

	it("fetches and caches the CA when nothing else supplies it", async () => {
		const { probe, commands, written } = fakeProbe({
			env: { AGENT_VAULT_TOKEN: "token" },
			files: {},
			commandResults: { ssh: CA_PEM },
		});
		const outcome = await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH);
		assert.equal(outcome.kind === "resolved" ? outcome.access.caPem : undefined, CA_PEM);
		assert.match(commands[0] ?? "", /^ssh .* root@endurance docker exec Agent-Vault agent-vault ca fetch$/);
		assert.equal(written[CA_CACHE_PATH], CA_PEM);
	});

	it("gives up when no proxy token can be found", async () => {
		const { probe } = fakeProbe({
			env: {},
			files: { [CA_CACHE_PATH]: CA_PEM },
			commandResults: { "pass-cli": undefined },
		});
		assert.deepEqual(await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH), {
			kind: "unavailable",
			reason: "no-proxy-token",
		});
	});

	it("gives up when the Proton Pass answer is not the expected document", async () => {
		const { probe } = fakeProbe({
			env: {},
			files: { [CA_CACHE_PATH]: CA_PEM },
			commandResults: { "pass-cli": "not json" },
		});
		assert.deepEqual(await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH), {
			kind: "unavailable",
			reason: "no-proxy-token",
		});
	});

	it("gives up when no root CA can be found", async () => {
		const { probe } = fakeProbe({
			env: { AGENT_VAULT_TOKEN: "token" },
			files: { [CA_CACHE_PATH]: "not a certificate" },
			commandResults: { ssh: "permission denied" },
		});
		assert.deepEqual(await resolveAgentVaultAccess(probe, PROXY_URL, CA_CACHE_PATH), {
			kind: "unavailable",
			reason: "no-root-ca",
		});
	});
});
