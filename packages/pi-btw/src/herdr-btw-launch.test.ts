import assert from "node:assert/strict";
import test from "node:test";

import {
	launchHerdrBtwSideSession,
	type BtwCommandExecutionResult,
	type HerdrBtwLaunchDependencies,
} from "./herdr-btw-launch.ts";

interface RecordedCommand {
	command: string;
	args: string[];
	timeout: number;
}

function successfulCommand(stdout = ""): BtwCommandExecutionResult {
	return { code: 0, stdout, stderr: "", killed: false };
}

function shellProcessInfo(shellReady: boolean): BtwCommandExecutionResult {
	return successfulCommand(
		JSON.stringify({
			result: {
				process_info: {
					shell_pid: 42,
					foreground_processes: [{ pid: shellReady ? 42 : 99 }],
				},
			},
		}),
	);
}

test("launchHerdrBtwSideSession submits shell-unsafe side questions after Pi starts", async () => {
	const commands: RecordedCommand[] = [];
	const dependencies: HerdrBtwLaunchDependencies = {
		cloneActiveSessionBranch: () => "/tmp/btw-snapshot.jsonl",
		executeCommand: async (command, args, timeout) => {
			commands.push({ command, args, timeout });
			if (args[0] === "tab") {
				return successfulCommand(
					JSON.stringify({
						result: {
							tab: { tab_id: "w1:t2" },
							root_pane: { pane_id: "w1:p2" },
						},
					}),
				);
			}
			if (args[0] === "pane") return shellProcessInfo(true);
			return successfulCommand();
		},
		sleep: async () => undefined,
	};

	const result = await launchHerdrBtwSideSession(
		{
			sourceSessionFile: "/tmp/parent.jsonl",
			cwd: "/work/project",
			workspaceId: "w1",
			agentName: "btw-session-1",
			modelRef: "openai/gpt-test",
			thinkingLevel: "high",
			question: "Why isn't this branch active?",
		},
		dependencies,
	);

	assert.deepEqual(result, {
		snapshotSessionFile: "/tmp/btw-snapshot.jsonl",
		tabId: "w1:t2",
		paneId: "w1:p2",
	});
	assert.deepEqual(commands, [
		{
			command: "herdr",
			args: [
				"tab",
				"create",
				"--workspace",
				"w1",
				"--cwd",
				"/work/project",
				"--label",
				"btw",
				"--focus",
			],
			timeout: 10_000,
		},
		{
			command: "herdr",
			args: ["pane", "process-info", "--pane", "w1:p2"],
			timeout: 5_000,
		},
		{
			command: "herdr",
			args: [
				"agent",
				"start",
				"btw-session-1",
				"--kind",
				"pi",
				"--pane",
				"w1:p2",
				"--timeout",
				"30000",
				"--",
				"--session",
				"/tmp/btw-snapshot.jsonl",
				"--model",
				"openai/gpt-test",
				"--thinking",
				"high",
			],
			timeout: 35_000,
		},
		{
			command: "herdr",
			args: [
				"agent",
				"prompt",
				"btw-session-1",
				"You are in a cloned side conversation. The parent session is still running independently. Answer only this side question; do not continue the parent's active task unless the question asks you to.\n\nWhy isn't this branch active?",
			],
			timeout: 10_000,
		},
	]);
});

test("launchHerdrBtwSideSession retries agent start while the new tab shell initializes", async () => {
	let starts = 0;
	const sleepDelays: number[] = [];
	const dependencies: HerdrBtwLaunchDependencies = {
		cloneActiveSessionBranch: () => "/tmp/btw-snapshot.jsonl",
		executeCommand: async (_command, args) => {
			if (args[0] === "tab") {
				return successfulCommand(
					JSON.stringify({
						result: {
							tab: { tab_id: "w1:t2" },
							root_pane: { pane_id: "w1:p2" },
						},
					}),
				);
			}
			if (args[0] === "pane") return shellProcessInfo(true);
			starts += 1;
			if (starts === 1) {
				return {
					code: 1,
					stdout: "",
					stderr: JSON.stringify({
						error: { message: "agent target pane w1:p2 is not an available shell" },
					}),
					killed: false,
				};
			}
			return successfulCommand();
		},
		sleep: async (delayMs) => {
			sleepDelays.push(delayMs);
		},
	};

	await launchHerdrBtwSideSession(
		{
			sourceSessionFile: "/tmp/parent.jsonl",
			cwd: "/work/project",
			workspaceId: "w1",
			agentName: "btw-session-1",
			question: "",
		},
		dependencies,
	);

	assert.equal(starts, 2);
	assert.deepEqual(sleepDelays, [500]);
});

test("launchHerdrBtwSideSession waits for Herdr's shell-ready process invariant before agent start", async () => {
	let processChecks = 0;
	let starts = 0;
	const sleepDelays: number[] = [];
	const dependencies: HerdrBtwLaunchDependencies = {
		cloneActiveSessionBranch: () => "/tmp/btw-snapshot.jsonl",
		executeCommand: async (_command, args) => {
			if (args[0] === "tab") {
				return successfulCommand(
					JSON.stringify({
						result: {
							tab: { tab_id: "w1:t2" },
							root_pane: { pane_id: "w1:p2" },
						},
					}),
				);
			}
			if (args[0] === "pane") {
				processChecks += 1;
				return shellProcessInfo(processChecks > 1);
			}
			starts += 1;
			return successfulCommand();
		},
		sleep: async (delayMs) => {
			sleepDelays.push(delayMs);
		},
	};

	await launchHerdrBtwSideSession(
		{
			sourceSessionFile: "/tmp/parent.jsonl",
			cwd: "/work/project",
			workspaceId: "w1",
			agentName: "btw-session-1",
			question: "",
		},
		dependencies,
	);

	assert.equal(processChecks, 2);
	assert.equal(starts, 1);
	assert.deepEqual(sleepDelays, [500]);
});
