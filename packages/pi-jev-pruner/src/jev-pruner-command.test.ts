import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatJevPrunerHelp, formatJevPrunerStatus, parseJevPrunerCommand } from "./jev-pruner-command.ts";
import { defaultJevPrunerConfig } from "./jev-pruner-config.ts";

describe("parseJevPrunerCommand", () => {
	it("reports status when no argument is given", () => {
		assert.equal(parseJevPrunerCommand("").action, "status");
		assert.equal(parseJevPrunerCommand("  status ").action, "status");
	});

	it("recognizes the toggles and help", () => {
		assert.equal(parseJevPrunerCommand("on").action, "on");
		assert.equal(parseJevPrunerCommand("off").action, "off");
		assert.equal(parseJevPrunerCommand("help").action, "help");
		assert.equal(parseJevPrunerCommand("--help").action, "help");
	});

	it("reports an unknown argument with the text that produced it", () => {
		const request = parseJevPrunerCommand("maybe");
		assert.equal(request.action, "invalid");
		assert.equal(request.argument, "maybe");
	});
});

describe("formatJevPrunerStatus", () => {
	it("shows the switch, the config path, and the tuning", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/home/will/.pi/agent/extensions/jev-pruner.json",
			lastRun: undefined,
			accessFailure: undefined,
		});
		assert.match(text, /^jev-pruner: on$/m);
		assert.match(text, /\/home\/will\/\.pi\/agent\/extensions\/jev-pruner\.json/);
		assert.match(text, /gate: prune above 4000 estimated tokens/);
		assert.match(text, /no bash output has been considered yet/);
	});

	it("summarizes the last pruned run", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: {
				command: "npm test",
				outcome: {
					kind: "pruned",
					output: "",
					totalChunks: 20,
					keptChunks: 3,
					droppedLines: 340,
					probabilities: [],
				},
			},
			accessFailure: undefined,
		});
		assert.match(text, /kept 3\/20 chunks, dropped 340 lines/);
	});

	it("explains why output was left alone", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: { command: "cat data.json", outcome: { kind: "unpruned", reason: "structured" } },
			accessFailure: undefined,
		});
		assert.match(text, /left untouched \(structured\)/);
	});

	it("surfaces a failure reason", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: { command: "npm test", outcome: { kind: "failed", reason: "Jev request failed with 401" } },
			accessFailure: undefined,
		});
		assert.match(text, /failed: Jev request failed with 401/);
	});
});

describe("formatJevPrunerStatus credentials", () => {
	it("says credentials resolved when Agent Vault is reachable", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: undefined,
			accessFailure: undefined,
		});
		assert.match(text, /credentials: resolved/);
	});

	it("names the repair when the proxy token is missing", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: undefined,
			accessFailure: "no-proxy-token",
		});
		assert.match(text, /credentials: no Agent Vault proxy token/);
		assert.match(text, /AGENT_VAULT_TOKEN/);
	});

	it("names the repair when the root CA is missing", () => {
		const text = formatJevPrunerStatus({
			config: defaultJevPrunerConfig(),
			configPath: "/tmp/config.json",
			lastRun: undefined,
			accessFailure: "no-root-ca",
		});
		assert.match(text, /credentials: no Agent Vault root CA/);
	});
});

describe("formatJevPrunerHelp", () => {
	it("lists the commands and the config file", () => {
		const text = formatJevPrunerHelp();
		assert.match(text, /\/jev-pruner on\|off/);
		assert.match(text, /jev-pruner\.json/);
	});
});
