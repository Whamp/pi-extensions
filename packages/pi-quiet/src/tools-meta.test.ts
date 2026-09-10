import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	FOREIGN_KIND_EMOJI,
	foreignToolsQuietEnabled,
	isQuietToolName,
	QUIET_TOOL_NAMES,
	registerFallbackQuietBuiltinTools,
	setForeignToolsQuiet,
	setQuietBuiltinToolNames,
	toolParticipatesInQuiet,
	verbGroupJoins,
	verbGroupKind,
} from "./tools-meta.ts";

afterEach(() => {
	setForeignToolsQuiet(false);
	setQuietBuiltinToolNames(QUIET_TOOL_NAMES);
});

describe("toolParticipatesInQuiet", () => {
	it("built-ins participate by default", () => {
		assert.equal(toolParticipatesInQuiet("read"), true);
		assert.equal(isQuietToolName("read"), true);
		assert.equal(toolParticipatesInQuiet("mcp"), false);
		assert.equal(foreignToolsQuietEnabled(), false);
	});

	it("Foreign Tools participate only when enabled", () => {
		setForeignToolsQuiet(true);
		assert.equal(foreignToolsQuietEnabled(), true);
		assert.equal(toolParticipatesInQuiet("mcp"), true);
		assert.equal(toolParticipatesInQuiet("subagent"), true);
		assert.equal(toolParticipatesInQuiet(""), false);
	});

	it("excludes skipped fallback overrides from Quiet compaction", () => {
		setQuietBuiltinToolNames(["bash", "edit"]);
		assert.equal(toolParticipatesInQuiet("read"), false);
		assert.equal(toolParticipatesInQuiet("bash"), true);
	});

	it("exports the Foreign Kind Emoji", () => {
		assert.equal(FOREIGN_KIND_EMOJI, "🧩");
	});
});

describe("registerFallbackQuietBuiltinTools", () => {
	it("registers only quiet tools still owned by Pi", () => {
		const registered: string[] = [];
		const selected = registerFallbackQuietBuiltinTools(
			[
				{ name: "read", sourceInfo: { source: "/extensions/read-long-lines/index.ts" } },
				{ name: "bash", sourceInfo: { source: "builtin" } },
				{ name: "edit", sourceInfo: { source: "builtin" } },
				{ name: "custom", sourceInfo: { source: "/extensions/custom.ts" } },
			],
			(name) => registered.push(name),
		);

		assert.deepEqual(selected, ["bash", "edit"]);
		assert.deepEqual(registered, selected);
	});

	it("keeps every quiet tool when Pi still owns each implementation", () => {
		const registered: string[] = [];
		const selected = registerFallbackQuietBuiltinTools(
			QUIET_TOOL_NAMES.map((name) => ({ name, sourceInfo: { source: "builtin" } })),
			(name) => registered.push(name),
		);

		assert.deepEqual(selected, QUIET_TOOL_NAMES);
		assert.deepEqual(registered, selected);
	});
});

describe("verbGroupKind", () => {
	it("maps tools to semantic kinds", () => {
		assert.equal(verbGroupKind("read"), "file");
		assert.equal(verbGroupKind("grep"), "search");
		assert.equal(verbGroupKind("find"), "search");
		assert.equal(verbGroupKind("ls"), "dir");
		assert.equal(verbGroupKind("bash"), "command");
		assert.equal(verbGroupKind("edit"), "editFile");
		assert.equal(verbGroupKind("write"), "editFile");
		assert.equal(verbGroupKind("mcp"), "other");
	});

	it("only explore + other kinds join Verb Groups", () => {
		assert.equal(verbGroupJoins("file"), true);
		assert.equal(verbGroupJoins("search"), true);
		assert.equal(verbGroupJoins("dir"), true);
		assert.equal(verbGroupJoins("other"), true);
		assert.equal(verbGroupJoins("command"), false);
		assert.equal(verbGroupJoins("editFile"), false);
	});
});
