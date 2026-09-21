const HERDR_TAB_CREATE_TIMEOUT_MS = 10_000;
const HERDR_PROCESS_INFO_TIMEOUT_MS = 5_000;
const HERDR_AGENT_START_TIMEOUT_MS = 35_000;
const HERDR_AGENT_PROMPT_TIMEOUT_MS = 10_000;
const HERDR_AGENT_READY_TIMEOUT_MS = 30_000;
const HERDR_SHELL_RETRY_DELAY_MS = 500;
const HERDR_SHELL_READY_ATTEMPTS = 60;
const HERDR_SHELL_START_ATTEMPTS = 10;

const SIDE_QUESTION_PREFIX =
	"You are in a cloned side conversation. The parent session is still running independently. Answer only this side question; do not continue the parent's active task unless the question asks you to.";

/** External command result. */
export interface BtwCommandExecutionResult {
	code: number;
	stdout: string;
	stderr: string;
	killed: boolean;
}

/** BTW launcher dependencies. */
export interface HerdrBtwLaunchDependencies {
	cloneActiveSessionBranch: (sourceSessionFile: string) => string;
	executeCommand: (
		command: string,
		args: string[],
		timeoutMs: number,
	) => Promise<BtwCommandExecutionResult>;
	sleep: (delayMs: number) => Promise<void>;
}

/** BTW launch input. */
export interface HerdrBtwLaunchRequest {
	sourceSessionFile: string;
	cwd: string;
	workspaceId: string;
	agentName: string;
	modelRef?: string;
	thinkingLevel?: string;
	question: string;
}

/** Created BTW resources. */
export interface HerdrBtwLaunchResult {
	snapshotSessionFile: string;
	tabId: string;
	paneId: string;
}

interface HerdrTabCreateEnvelope {
	result?: {
		tab?: { tab_id?: unknown };
		root_pane?: { pane_id?: unknown };
	};
	error?: { code?: unknown; message?: unknown };
}

interface HerdrProcessInfoEnvelope {
	result?: {
		process_info?: {
			shell_pid?: unknown;
			foreground_processes?: Array<{ pid?: unknown }>;
		};
	};
}

function parseHerdrTabCreateResult(stdout: string): { tabId: string; paneId: string } {
	const envelope = JSON.parse(stdout) as HerdrTabCreateEnvelope;

	const tabId = envelope.result?.tab?.tab_id;
	const paneId = envelope.result?.root_pane?.pane_id;
	if (typeof tabId !== "string" || typeof paneId !== "string") {
		throw new Error(
			"BTW Herdr tab creation failed: Herdr did not return tab and root pane IDs",
		);
	}

	return { tabId, paneId };
}

function extractHerdrCommandError(result: BtwCommandExecutionResult): string {
	const rawError = result.stderr.trim() || result.stdout.trim();
	if (!rawError) return `Herdr exited with code ${result.code}`;

	return rawError;
}

function parseHerdrShellReady(stdout: string): boolean {
	const envelope = JSON.parse(stdout) as HerdrProcessInfoEnvelope;

	const processInfo = envelope.result?.process_info;
	if (
		typeof processInfo?.shell_pid !== "number" ||
		!Array.isArray(processInfo.foreground_processes)
	) {
		throw new Error(
			"BTW Herdr shell readiness failed: Herdr returned incomplete process information",
		);
	}

	return processInfo.foreground_processes.some(
		(foregroundProcess) => foregroundProcess.pid === processInfo.shell_pid,
	);
}

async function waitForHerdrShellReady(
	paneId: string,
	dependencies: HerdrBtwLaunchDependencies,
): Promise<void> {
	let lastProcessError: string | undefined;
	for (let attempt = 1; attempt <= HERDR_SHELL_READY_ATTEMPTS; attempt += 1) {
		const processInfoResult = await dependencies.executeCommand(
			"herdr",
			["pane", "process-info", "--pane", paneId],
			HERDR_PROCESS_INFO_TIMEOUT_MS,
		);
		if (processInfoResult.code === 0) {
			if (parseHerdrShellReady(processInfoResult.stdout)) return;
			lastProcessError = "the shell process is not in the foreground";
		} else {
			lastProcessError = extractHerdrCommandError(processInfoResult);
		}

		if (attempt < HERDR_SHELL_READY_ATTEMPTS) {
			await dependencies.sleep(HERDR_SHELL_RETRY_DELAY_MS);
		}
	}

	throw new Error(
		`BTW Herdr shell readiness failed: ${lastProcessError ?? "the new tab did not become ready"}`,
	);
}

function buildPiSideSessionArguments(
	request: HerdrBtwLaunchRequest,
	snapshotSessionFile: string,
): string[] {
	const piArguments = ["--session", snapshotSessionFile];
	if (request.modelRef) piArguments.push("--model", request.modelRef);
	if (request.thinkingLevel) piArguments.push("--thinking", request.thinkingLevel);
	return piArguments;
}

/** Open a focused Herdr tab and start Pi on a non-mutating clone of the parent's active branch. */
export async function launchHerdrBtwSideSession(
	request: HerdrBtwLaunchRequest,
	dependencies: HerdrBtwLaunchDependencies,
): Promise<HerdrBtwLaunchResult> {
	const snapshotSessionFile = dependencies.cloneActiveSessionBranch(request.sourceSessionFile);
	const tabCreateResult = await dependencies.executeCommand(
		"herdr",
		[
			"tab",
			"create",
			"--workspace",
			request.workspaceId,
			"--cwd",
			request.cwd,
			"--label",
			"btw",
			"--focus",
		],
		HERDR_TAB_CREATE_TIMEOUT_MS,
	);
	if (tabCreateResult.code !== 0) {
		throw new Error(
			`BTW Herdr tab creation failed: ${extractHerdrCommandError(tabCreateResult)}`,
		);
	}

	const { tabId, paneId } = parseHerdrTabCreateResult(tabCreateResult.stdout);
	await waitForHerdrShellReady(paneId, dependencies);

	const agentStartArguments = [
		"agent",
		"start",
		request.agentName,
		"--kind",
		"pi",
		"--pane",
		paneId,
		"--timeout",
		String(HERDR_AGENT_READY_TIMEOUT_MS),
		"--",
		...buildPiSideSessionArguments(request, snapshotSessionFile),
	];

	let agentStarted = false;
	for (let attempt = 1; attempt <= HERDR_SHELL_START_ATTEMPTS; attempt += 1) {
		const agentStartResult = await dependencies.executeCommand(
			"herdr",
			agentStartArguments,
			HERDR_AGENT_START_TIMEOUT_MS,
		);
		if (agentStartResult.code === 0) {
			agentStarted = true;
			break;
		}

		const errorMessage = extractHerdrCommandError(agentStartResult);
		if (
			!/agent_pane_busy|not an available shell/i.test(errorMessage) ||
			attempt === HERDR_SHELL_START_ATTEMPTS
		) {
			throw new Error(`BTW Pi agent start failed: ${errorMessage}`);
		}
		await dependencies.sleep(HERDR_SHELL_RETRY_DELAY_MS);
	}

	if (!agentStarted) {
		throw new Error("BTW Pi agent start failed: exhausted shell readiness retries");
	}

	const question = request.question.trim();
	if (question) {
		const promptResult = await dependencies.executeCommand(
			"herdr",
			["agent", "prompt", request.agentName, `${SIDE_QUESTION_PREFIX}\n\n${question}`],
			HERDR_AGENT_PROMPT_TIMEOUT_MS,
		);
		if (promptResult.code !== 0) {
			throw new Error(
				`BTW side question submission failed: ${extractHerdrCommandError(promptResult)}`,
			);
		}
	}

	return { snapshotSessionFile, tabId, paneId };
}
