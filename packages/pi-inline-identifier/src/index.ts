import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAgentIdentifierFeature } from "./agent.ts";
import { registerInlineIdentifierCoordinator } from "./core.ts";
import { createPromptIdentifierFeature } from "./prompt.ts";
import { createSkillIdentifierFeature } from "./skill.ts";

/** Register inline skills, trusted agents, and prompt templates in one coordinator. */
export default function inlineIdentifierExtension(pi: ExtensionAPI): void {
	registerInlineIdentifierCoordinator(pi, [
		createSkillIdentifierFeature(pi),
		createAgentIdentifierFeature(pi),
		createPromptIdentifierFeature(pi),
	]);
}
