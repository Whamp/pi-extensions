const GITHUB_PATH = "skills/poteto-mode/scripts/watch-pr/github.ts";
const TYPES_PATH = "skills/poteto-mode/scripts/watch-pr/types.ts";

const CHANGED_BRANCHES = [
	["  ", 'state === "ACTION_REQUIRED"', 'return gateOr("failed", details, state);'],
	["  ", 'bucket === "pending"', 'return gateOr("pending", details, state);'],
	["    ", 'status !== "COMPLETED"', 'return gateOr("pending", { ...details, link }, "PENDING");'],
	[
		"    ",
		'conclusion === "ACTION_REQUIRED"',
		'return gateOr("failed", { ...details, link }, conclusion);',
	],
	[
		"  ",
		'state === "PENDING" || state === "EXPECTED"',
		'return gateOr("pending", { ...details, link }, "PENDING");',
	],
	[
		"  ",
		'typeof page.hasNextPage !== "boolean"',
		'missing("reviewThreads.pageInfo.hasNextPage", page.hasNextPage);',
	],
	["    ", "after !== null", 'argv.push("-f", `after=${after}`);'],
];

const EXPORT_DOCS = [
	[
		GITHUB_PATH,
		"export function parseReviewThreadPage",
		"/** Read and validate one GitHub review-thread page. */",
	],
	[
		GITHUB_PATH,
		"export function buildReviewThreads",
		"/** Assign review-pass identities across the complete set of thread pages. */",
	],
	[
		GITHUB_PATH,
		"export async function resolveReviewThreads",
		"/** Collect every review-thread page before assigning review-pass identities. */",
	],
	[
		TYPES_PATH,
		"export interface RawReviewThread",
		"/** A review thread before cross-page pass identities are assigned. */",
	],
	[
		TYPES_PATH,
		"export interface ReviewThreadPage",
		"/** One validated review-thread page and its continuation cursor. */",
	],
];

/** Apply the adopted TypeScript rules to new watcher branches and exports. */
export function adaptWatcherTypescript(text, rel) {
	if (rel === GITHUB_PATH) {
		for (const [indent, condition, statement] of CHANGED_BRANCHES) {
			const head = `${indent}if (${condition})`;
			const block = `${head} {\n${indent}  ${statement}\n${indent}}`;
			text = text.replaceAll(`${head} ${statement}`, block);
			text = text.replaceAll(`${head}\n${indent}  ${statement}`, block);
		}
	}
	for (const [path, declaration, doc] of EXPORT_DOCS) {
		if (path === rel && !text.includes(`${doc}\n${declaration}`)) {
			text = text.replace(declaration, `${doc}\n${declaration}`);
		}
	}
	return text;
}
