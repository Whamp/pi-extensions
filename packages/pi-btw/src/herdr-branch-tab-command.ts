import { randomUUID } from "node:crypto";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { cloneActivePiSessionBranch } from "./btw-session-snapshot.ts";
import {
	launchHerdrBtwSideSession,
	type HerdrBtwLaunchRequest,
	type HerdrBtwLaunchResult,
} from "./herdr-btw-launch.ts";

/** Herdr branch-tab command dependencies. */
export interface RegisterHerdrBranchTabDependencies {
	environment: Readonly<Record<string, string | undefined>>;
	createAgentName: () => string;
	launchSideSession: (request: HerdrBtwLaunchRequest) => Promise<HerdrBtwLaunchResult>;
}

function createDefaultBranchTabDependencies(pi: ExtensionAPI): RegisterHerdrBranchTabDependencies {
	return {
		environment: process.env,
		createAgentName: () => `branch-${randomUUID().slice(0, 8)}`,
		launchSideSession: (request) =>
			launchHerdrBtwSideSession(request, {
				cloneActiveSessionBranch: cloneActivePiSessionBranch,
				executeCommand: async (command, args, timeoutMs) => {
					const result = await pi.exec(command, args, { timeout: timeoutMs });
					return {
						code: result.code,
						stdout: result.stdout,
						stderr: result.stderr,
						killed: result.killed,
					};
				},
				sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
			}),
	};
}

/** Registers `/branch-tab`, which launches a cloned Pi session in a new Herdr tab. */
export function registerHerdrBranchTabCommand(
	pi: ExtensionAPI,
	dependencies: RegisterHerdrBranchTabDependencies = createDefaultBranchTabDependencies(pi),
): void {
	pi.registerCommand("branch-tab", {
		description: "Open a cloned side conversation in a new Herdr tab",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/branch-tab requires Pi interactive mode", "error");
				return;
			}
			if (dependencies.environment.HERDR_ENV !== "1") {
				ctx.ui.notify("/branch-tab requires Pi to be running inside Herdr", "error");
				return;
			}

			const workspaceId = dependencies.environment.HERDR_WORKSPACE_ID;
			if (!workspaceId) {
				ctx.ui.notify(
					"/branch-tab could not determine the current Herdr workspace",
					"error",
				);
				return;
			}

			const sourceSessionFile = ctx.sessionManager.getSessionFile();
			if (!sourceSessionFile) {
				ctx.ui.notify("/branch-tab requires a persisted parent session", "error");
				return;
			}

			try {
				const result = await dependencies.launchSideSession({
					sourceSessionFile,
					cwd: ctx.cwd,
					workspaceId,
					agentName: dependencies.createAgentName(),
					...(ctx.model ? { modelRef: `${ctx.model.provider}/${ctx.model.id}` } : {}),
					...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
					question: args,
				});
				ctx.ui.notify(`Opened branch side session in Herdr tab ${result.tabId}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
			}
		},
	});
}
