import assert from "node:assert/strict";
import test from "node:test";

import {
	registerHerdrBranchTabCommand,
	type RegisterHerdrBranchTabDependencies,
} from "./herdr-branch-tab-command.ts";

test("the branch-tab command launches from command context without replacing or waiting for the parent session", async () => {
	let commandHandler: ((args: string, context: unknown) => Promise<void>) | undefined;
	const notifications: Array<{ message: string; level: string }> = [];
	const launches: unknown[] = [];
	const pi = {
		registerCommand: (
			name: string,
			command: { handler: (args: string, context: unknown) => Promise<void> },
		) => {
			assert.equal(name, "branch-tab");
			commandHandler = command.handler;
		},
	};
	const dependencies: RegisterHerdrBranchTabDependencies = {
		environment: {
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w1",
		},
		createAgentName: () => "btw-session-1",
		launchSideSession: async (request) => {
			launches.push(request);
			return {
				snapshotSessionFile: "/tmp/snapshot.jsonl",
				tabId: "w1:t2",
				paneId: "w1:p2",
			};
		},
	};

	registerHerdrBranchTabCommand(pi as never, dependencies);
	assert.ok(commandHandler);

	await commandHandler("What changed?", {
		mode: "tui",
		cwd: "/work/project",
		model: { provider: "openai", id: "gpt-test" },
		thinkingLevel: "high",
		sessionManager: {
			getSessionFile: () => "/tmp/parent.jsonl",
		},
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
		},
	});

	assert.deepEqual(launches, [
		{
			sourceSessionFile: "/tmp/parent.jsonl",
			cwd: "/work/project",
			workspaceId: "w1",
			agentName: "btw-session-1",
			modelRef: "openai/gpt-test",
			thinkingLevel: "high",
			question: "What changed?",
		},
	]);
	assert.deepEqual(notifications, [
		{ message: "Opened branch side session in Herdr tab w1:t2", level: "info" },
	]);
});
