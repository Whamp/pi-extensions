import { createHash } from "node:crypto";
import type { SidekickConfig } from "../config.ts";
import type { FrozenSidekickPrompt } from "../types.ts";
import type { RenderedPromptProfile } from "./types.ts";

/** Returns final lead instructions with the existing system-prompt separator. */
export function composePiLeadSystemPrompt(profile: RenderedPromptProfile): string {
  return `\n${profile.text}`;
}

/** Freezes final sidekick instructions and configured capabilities for one child epoch. */
export function freezePiSidekickPrompt(
  profile: RenderedPromptProfile,
  config: SidekickConfig,
): FrozenSidekickPrompt {
  if (!config.sidekick) {
    throw new Error("Cannot freeze a sidekick prompt without an exact sidekick model.");
  }
  return {
    profileId: profile.id,
    effectiveSha256: createHash("sha256").update(profile.text).digest("hex"),
    effectiveText: profile.text,
    activeToolNames: [...new Set(config.tools)].sort((left, right) => left.localeCompare(right)),
    model: structuredClone(config.sidekick),
    thinking: config.thinking,
    sidekickExtensions: [...config.sidekickExtensions],
    sidekickSkills: [...config.sidekickSkills],
  };
}
