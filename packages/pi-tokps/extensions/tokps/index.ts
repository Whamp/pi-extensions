import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTokpsLifecycle, type TokpsEffect, type TokpsSessionSnapshot } from "./lifecycle.ts";

function sessionSnapshot(ctx: ExtensionContext): TokpsSessionSnapshot {
	return {
		entries: ctx.sessionManager.getBranch() as TokpsSessionSnapshot["entries"],
		sessionFile: ctx.sessionManager.getSessionFile(),
		sessionId: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
	};
}

function applyEffects(pi: ExtensionAPI, ctx: ExtensionContext, effects: TokpsEffect[]): void {
	for (const effect of effects) {
		if (effect.type === "append") {
			pi.appendEntry(effect.customType, effect.data);
			continue;
		}
		if (effect.type === "setStatus") {
			if (ctx.hasUI) ctx.ui.setStatus("tokps", effect.text);
			continue;
		}
		ctx.ui.notify(effect.message, effect.level);
	}
}

export default function (pi: ExtensionAPI) {
	const lifecycle = createTokpsLifecycle();

	pi.registerFlag("tokps-display", {
		type: "boolean",
		default: false,
		description: "Show latest model decode speed in the status bar",
	});

	pi.on("session_start", (_event, ctx) => {
		applyEffects(pi, ctx, lifecycle.sessionLoaded(sessionSnapshot(ctx), pi.getFlag("tokps-display") === true));
	});

	pi.on("session_tree", (_event, ctx) => {
		applyEffects(pi, ctx, lifecycle.sessionLoaded(sessionSnapshot(ctx), pi.getFlag("tokps-display") === true));
	});

	pi.on("message_start", (event, ctx) => {
		applyEffects(pi, ctx, lifecycle.messageStarted(event.message));
	});

	pi.on("message_update", (event, ctx) => {
		applyEffects(pi, ctx, lifecycle.messageUpdated(event.message, event.assistantMessageEvent));
	});

	pi.on("message_end", (event, ctx) => {
		applyEffects(pi, ctx, lifecycle.messageEnded(event.message));
	});

	pi.on("turn_end", (event, ctx) => {
		applyEffects(pi, ctx, lifecycle.turnEnded(event.message, sessionSnapshot(ctx)));
	});

	pi.on("agent_end", (_event, ctx) => {
		applyEffects(pi, ctx, lifecycle.agentEnded(sessionSnapshot(ctx)));
	});

	pi.registerCommand("tokps", {
		description: "Show or toggle model decode tokens/sec tracking",
		handler: async (args, ctx) => {
			applyEffects(pi, ctx, lifecycle.command(args));
		},
	});
}
