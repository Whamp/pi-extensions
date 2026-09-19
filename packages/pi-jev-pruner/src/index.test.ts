import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import jevPrunerExtension from "./index.ts";
import type { JevPrunerRuntime } from "./index.ts";
import type { JevAsker } from "./jev-asker.ts";
import type { AgentVaultUnavailableReason } from "./agent-vault-access.ts";

/** 80 lines of progress noise: enough to clear the configuration's minimum gate of 200 tokens. */
const OUTPUT = Array.from({ length: 80 }, (_, index) => `progress step ${index + 1} complete`).join("\n");

const alwaysDrop: JevAsker = {
	async askChunkRelevance(_request, expectedQuestionIds) {
		return new Map(expectedQuestionIds.map((id) => [id, 0]));
	},
};

const failingAsker: JevAsker = {
	async askChunkRelevance() {
		throw new Error("Jev request failed with 401");
	},
};

interface Harness {
	toolResult(): Promise<unknown>;
	command(argument: string): Promise<void>;
	statuses: string[];
	notices: string[];
	agentDir: string;
}

/** Builds the extension against a fake pi and a replaced runtime, in an isolated agent directory. */
function buildHarness(options: {
	asker: JevAsker | undefined;
	accessFailure?: AgentVaultUnavailableReason;
}): Harness {
	const agentDir = mkdtempSync(join(tmpdir(), "jev-pruner-test-"));
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(
		join(agentDir, "extensions", "jev-pruner.json"),
		JSON.stringify({ minTokens: 200, chunkLines: 2 }),
	);
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const statuses: string[] = [];
	const notices: string[] = [];
	let toolResultHandler: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
	let commandHandler: ((argument: string, ctx: unknown) => Promise<void>) | undefined;

	// SAFETY: the fake implements only the members the extension touches; pi's API is far larger.
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) {
			if (event === "tool_result") {
				toolResultHandler = handler;
			}
		},
		registerCommand(_name: string, config: { handler: (argument: string, ctx: unknown) => Promise<void> }) {
			commandHandler = config.handler;
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
	} as unknown as ExtensionAPI;

	const runtime: JevPrunerRuntime = {
		probe: {
			readEnv: () => undefined,
			readFile: async () => undefined,
			writeFile: async () => undefined,
			runCommand: async () => undefined,
		},
		resolveAsker: async () => options.asker,
		accessFailure: () => options.accessFailure,
	};
	jevPrunerExtension(pi, runtime);

	// SAFETY: the fake context implements only the members the extension touches.
	const ctx = {
		ui: {
			setStatus: (_key: string, text: string) => statuses.push(text),
			notify: (message: string) => notices.push(message),
		},
		sessionManager: { buildContextEntries: () => [] },
	} as unknown as ExtensionContext;

	const event = {
		type: "tool_result",
		toolName: "bash",
		toolCallId: "call_1",
		input: { command: "npm test" },
		content: [{ type: "text", text: OUTPUT }],
		isError: false,
		details: undefined,
	};

	return {
		agentDir,
		statuses,
		notices,
		async toolResult() {
			if (toolResultHandler === undefined) {
				throw new Error("the extension registered no tool_result handler");
			}
			return await toolResultHandler(event, ctx);
		},
		async command(argument: string) {
			if (commandHandler === undefined) {
				throw new Error("the extension registered no command handler");
			}
			await commandHandler(argument, ctx);
		},
	};
}

function restoreAgentDir(harness: Harness): void {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(harness.agentDir, { recursive: true, force: true });
}

describe("jevPrunerExtension tool_result", () => {
	it("replaces large output with the kept chunks and a marker", async () => {
		const harness = buildHarness({ asker: alwaysDrop });
		try {
			const patch = (await harness.toolResult()) as { content: { type: string; text: string }[] };
			const text = patch.content[0]?.text ?? "";
			assert.match(text, /progress step 1 complete/);
			assert.match(text, /\[jev-pruner dropped 76 lines/);
			assert.equal(harness.statuses.length, 1);
			assert.match(harness.statuses[0] ?? "", /kept 2\/40 chunks, dropped 76 lines/);
		} finally {
			restoreAgentDir(harness);
		}
	});

	it("leaves the result alone when Jev fails", async () => {
		const harness = buildHarness({ asker: failingAsker });
		try {
			assert.equal(await harness.toolResult(), undefined);
			assert.deepEqual(harness.statuses, []);
			await harness.command("status");
			assert.match(harness.notices.join("\n"), /failed: Jev request failed with 401/);
		} finally {
			restoreAgentDir(harness);
		}
	});

	it("leaves the result alone when credentials are unavailable", async () => {
		const harness = buildHarness({ asker: undefined, accessFailure: "no-proxy-token" });
		try {
			assert.equal(await harness.toolResult(), undefined);
			await harness.command("status");
			assert.match(harness.notices.join("\n"), /credentials: no Agent Vault proxy token/);
		} finally {
			restoreAgentDir(harness);
		}
	});
});

describe("jevPrunerExtension command", () => {
	it("stops pruning when switched off, and records it in the config file", async () => {
		const harness = buildHarness({ asker: alwaysDrop });
		try {
			await harness.command("off");
			assert.equal(await harness.toolResult(), undefined, "a disabled extension touches nothing");
			assert.match(harness.notices.join("\n"), /jev-pruner off/);
			const config = JSON.parse(
				readFileSync(join(harness.agentDir, "extensions", "jev-pruner.json"), "utf8"),
			) as { enabled?: boolean };
			assert.equal(config.enabled, false);

			await harness.command("on");
			assert.ok((await harness.toolResult()) !== undefined, "switching back on resumes pruning");
		} finally {
			restoreAgentDir(harness);
		}
	});

	it("explains an unknown argument instead of ignoring it", async () => {
		const harness = buildHarness({ asker: alwaysDrop });
		try {
			await harness.command("maybe");
			assert.match(harness.notices.join("\n"), /unknown argument "maybe"/);
		} finally {
			restoreAgentDir(harness);
		}
	});

	it("reports the active configuration", async () => {
		const harness = buildHarness({ asker: alwaysDrop });
		try {
			await harness.command("");
			const status = harness.notices.join("\n");
			assert.match(status, /jev-pruner: on/);
			assert.match(status, /gate: prune above 200 estimated tokens/);
			assert.match(status, /credentials: resolved/);
		} finally {
			restoreAgentDir(harness);
		}
	});
});
