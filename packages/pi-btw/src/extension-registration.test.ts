import assert from "node:assert/strict";
import test from "node:test";

import registerBtwExtension from "./index.ts";

test("the package registers overlay BTW and Herdr branch commands", () => {
	const commands: string[] = [];
	const events: string[] = [];
	const pi = {
		registerCommand: (name: string) => commands.push(name),
		on: (event: string) => events.push(event),
		getThinkingLevel: () => "off",
	};

	registerBtwExtension(pi as never);

	assert.deepEqual(commands.sort(), ["branch-tab", "btw"]);
	assert.deepEqual(events.sort(), ["session_shutdown", "session_start", "session_tree"]);
});
