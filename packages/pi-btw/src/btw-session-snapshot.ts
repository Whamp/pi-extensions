import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Clone the active Pi session branch through an isolated manager, leaving the parent runtime untouched. */
export function cloneActivePiSessionBranch(sourceSessionFile: string): string {
	if (!existsSync(sourceSessionFile)) {
		throw new Error(
			"BTW session snapshot failed: the parent session is not persisted yet; wait for its first assistant response",
		);
	}

	const isolatedSessionManager = SessionManager.open(
		sourceSessionFile,
		dirname(sourceSessionFile),
	);
	const activeLeafId = isolatedSessionManager.getLeafId();
	if (!activeLeafId) {
		throw new Error(
			"BTW session snapshot failed: the parent session has no active conversation branch",
		);
	}

	const snapshotSessionFile = isolatedSessionManager.createBranchedSession(activeLeafId);
	if (!snapshotSessionFile) {
		throw new Error("BTW session snapshot failed: Pi did not create a persisted session clone");
	}

	return snapshotSessionFile;
}
