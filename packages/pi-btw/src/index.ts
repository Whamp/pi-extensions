import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBtwOverlay } from "./btw-overlay.ts";
import { registerHerdrBranchTabCommand } from "./herdr-branch-tab-command.ts";

/** Registers the in-session BTW overlay and the separate Herdr branch command. */
export function registerBtwExtension(pi: ExtensionAPI): void {
	registerBtwOverlay(pi);
	registerHerdrBranchTabCommand(pi);
}

export default registerBtwExtension;
