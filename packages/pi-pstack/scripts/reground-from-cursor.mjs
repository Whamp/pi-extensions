#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { apply } from "./reground-apply.mjs";
import { assertNoCursorSeams, assertNoLegacyPiCallerGuidance } from "./reground-audit.mjs";
import { parseArgs, plan, printPlan } from "./reground-plan.mjs";

export { apply, applyDerivedPatch, renderWrite } from "./reground-apply.mjs";
export { assertNoCursorSeams, assertNoLegacyPiCallerGuidance } from "./reground-audit.mjs";
export { applyPiCallerGuidanceTransforms } from "./reground-caller-guidance.mjs";
export {
	applyAtomicRoleTransforms,
	applyBodyTransforms,
	applyFrontmatterPolicy,
} from "./reground-content-transforms.mjs";
export { SEAMS } from "./reground-generic-seams.mjs";
export { CLASS_RULES, DISCOVERABLE, asRelPath, classify } from "./reground-path-policy.mjs";
export { parseArgs, plan, printPlan } from "./reground-plan.mjs";

export function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const planned = plan(args);
	if (args.dryRun) {
		printPlan(planned);
		return;
	}
	apply(planned);
	assertNoCursorSeams(args.to);
	assertNoLegacyPiCallerGuidance(args.to);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	}
}
