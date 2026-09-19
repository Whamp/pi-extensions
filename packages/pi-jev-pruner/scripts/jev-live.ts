/**
 * Live check: scores a real noisy install log with Jev through Agent Vault.
 *
 * This is the only check that exercises the credential path, the proxy tunnel, and the real
 * System One contract. It makes a handful of billable Jev requests and requires Agent Vault to be
 * reachable, so it does not run as part of the offline suite.
 *
 *   node --experimental-strip-types scripts/jev-live.ts
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveAgentVaultAccess } from "../src/agent-vault-access.ts";
import type { AgentVaultProbe } from "../src/agent-vault-access.ts";
import { createAgentVaultDispatcher } from "../src/agent-vault-proxy.ts";
import { createJevAsker } from "../src/jev-http-asker.ts";
import { createUndiciJevTransport } from "../src/jev-undici-transport.ts";
import { pruneOptionsFromConfig, pruneOutputWithJev } from "../src/output-pruner.ts";
import { loadJevPrunerConfig } from "../src/jev-pruner-config.ts";

const NEEDLE = "vite@5.4.11";
const GOAL =
	"Confirm the dependency install finished cleanly, then tell me which version of vite was installed.";

const config = loadJevPrunerConfig();
const options = pruneOptionsFromConfig(config);

function runFile(command: string, args: readonly string[], timeoutMs: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, [...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolve(error === null ? stdout : undefined);
		});
	});
}

const probe: AgentVaultProbe = {
	readEnv: (name) => process.env[name],
	async readFile(path) {
		try {
			return await readFile(path.replace(/^~(?=\/|$)/, homedir()), "utf8");
		} catch {
			return undefined;
		}
	},
	async writeFile(path, text) {
		await writeFile(path.replace(/^~(?=\/|$)/, homedir()), text, { mode: 0o600 });
	},
	runCommand: (command, args, timeoutMs) => runFile(command, args, timeoutMs),
};

/** A 200-line install log whose only task-relevant line sits in the middle. */
function buildInstallLog(): string {
	const lines: string[] = [];
	for (let index = 1; index <= 200; index += 1) {
		if (index === 97) {
			lines.push(`npm http fetch GET 200 https://registry.npmjs.org/${NEEDLE} 45ms (cache miss)`);
		} else if (index === 98) {
			lines.push("npm info run esbuild@0.24.0 postinstall node_modules/esbuild");
		} else {
			lines.push(
				`npm http fetch GET 200 https://registry.npmjs.org/pkg-${index}/-/${index}.tgz 12ms (cache hit)`,
			);
		}
	}
	return lines.join("\n");
}

async function main(): Promise<void> {
	const accessOutcome = await resolveAgentVaultAccess(
		probe,
		config,
		`${homedir()}/.pi/agent/extensions/jev-pruner-agent-vault-ca.pem`,
	);
	if (accessOutcome.kind === "unavailable") {
		throw new Error(`could not resolve Agent Vault access: ${accessOutcome.reason}`);
	}
	const access = accessOutcome.access;
	console.log(`resolved Agent Vault proxy ${access.proxyUrl}, CA ${access.caPem.length} bytes`);

	const asker = createJevAsker(
		createUndiciJevTransport({ dispatcher: createAgentVaultDispatcher(access) }),
	);
	const output = buildInstallLog();
	const outcome = await pruneOutputWithJev(
		{
			command: "npm install",
			output,
			history: [{ role: "user", text: GOAL }],
			archive: { path: "/tmp/pi-bash-live.log", alreadyWritten: false },
		},
		asker,
		options,
	);

	if (outcome.kind !== "pruned") {
		throw new Error(`expected a pruned result, got ${outcome.kind}/${outcome.reason}`);
	}
	console.log(
		`kept ${outcome.keptChunks}/${outcome.totalChunks} chunks, dropped ${outcome.droppedLines} lines`,
	);
	console.log(`probabilities: ${outcome.probabilities.map((value) => value.toFixed(2)).join(", ")}`);
	console.log(`marker present: ${outcome.output.includes("jev-pruner dropped")}`);
	console.log(`task-relevant line kept: ${outcome.output.includes(NEEDLE)}`);
	if (!outcome.output.includes(NEEDLE)) {
		throw new Error(`Jev dropped the line the task asked about (${NEEDLE})`);
	}
	if (!/jev-pruner dropped/.test(outcome.output)) {
		throw new Error("pruned output carries no marker");
	}
}

await main();
console.log("live check passed");
