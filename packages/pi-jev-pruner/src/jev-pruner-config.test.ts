import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	defaultJevPrunerConfig,
	expandHomePath,
	loadJevPrunerConfig,
	parseJevPrunerConfig,
	saveJevPrunerConfig,
} from "./jev-pruner-config.ts";

describe("parseJevPrunerConfig", () => {
	it("returns defaults for text that is not JSON", () => {
		assert.deepEqual(parseJevPrunerConfig("{ not json"), defaultJevPrunerConfig());
		assert.deepEqual(parseJevPrunerConfig("[]"), defaultJevPrunerConfig());
	});

	it("keeps valid fields and defaults only the invalid one", () => {
		const config = parseJevPrunerConfig('{"enabled":false,"chunkLines":"many","model":"jev-preview"}');
		assert.equal(config.enabled, false);
		assert.equal(config.chunkLines, defaultJevPrunerConfig().chunkLines);
		assert.equal(config.model, "jev-preview");
	});

	it("clamps numbers into a usable range", () => {
		const config = parseJevPrunerConfig(
			'{"minTokens":1,"keepThreshold":5,"maxScoringRequests":0,"maxStateTokens":1}',
		);
		assert.equal(config.minTokens, 200);
		assert.equal(config.keepThreshold, 1);
		assert.equal(config.maxScoringRequests, 1);
		assert.equal(config.maxStateTokens, 1_000);
	});

	it("ignores an empty model or proxy URL", () => {
		const config = parseJevPrunerConfig('{"model":"","proxyUrl":""}');
		assert.equal(config.model, defaultJevPrunerConfig().model);
		assert.equal(config.proxyUrl, defaultJevPrunerConfig().proxyUrl);
	});
});

describe("loadJevPrunerConfig", () => {
	it("returns defaults when the file does not exist", () => {
		assert.deepEqual(loadJevPrunerConfig("/nonexistent/jev-pruner.json"), defaultJevPrunerConfig());
	});

	it("round-trips a saved configuration", () => {
		const path = `${process.env.TMPDIR ?? "/tmp"}/jev-pruner-test-${process.pid}/config.json`;
		const config = { ...defaultJevPrunerConfig(), enabled: false, chunkLines: 40 };
		assert.equal(saveJevPrunerConfig(config, path), true);
		assert.deepEqual(loadJevPrunerConfig(path), config);
	});
});

describe("expandHomePath", () => {
	it("expands only a leading home reference", () => {
		assert.match(expandHomePath("~/.agent-vault/mitm-ca.pem"), /^\/.+\.agent-vault\/mitm-ca\.pem$/);
		assert.equal(expandHomePath("/etc/ssl/ca.pem"), "/etc/ssl/ca.pem");
	});
});
