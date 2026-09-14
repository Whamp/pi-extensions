import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	DEST_ONLY_NEVER,
	DISCOVERABLE,
	asRelPath,
	classify,
	matchesAny,
	walkFiles,
} from "./reground-path-policy.mjs";

const LEGACY_PI_CALLER_GUIDANCE_RULES = [
	{
		id: "legacy-flat-subagent-call",
		pattern: /subagent\(\s*\{(?!\s*action\s*:)/,
	},
	{
		id: "cursor-run-in-background-field",
		pattern: /\brun_in_background\s*:/,
	},
	{
		id: "cursor-environment-field",
		pattern: /\benvironment`?\s*:/,
	},
	{
		id: "cursor-environment-schema",
		pattern: /catalog schema including `environment`/,
	},
	{
		id: "cursor-runtime-guidance",
		pattern: /\bCursor (?:dashboard|restart)\b/,
	},
	{
		id: "cursor-readonly-field",
		pattern: /\breadonly`?\s*:/,
	},
	{
		id: "cursor-cloud-base-branch-field",
		pattern: /\bcloud_base_branch\b/,
	},
	{
		id: "object-form-runs-run",
		pattern: /\bruns\.run\(\s*\{/,
	},
	{
		id: "unawaited-runs-all-guidance",
		pattern: /\b(?:In `workflowScript`, (?:use|launch)[^`\n]*|Inside the script, use|Use) `runs\.all\(\[/,
	},
	{
		id: "task-tool-launch-language",
		pattern:
			/\b(?:[Ll]aunch|[Ss]pawn|[Rr]esume|[Dd]rain|[Ee]xecute|[Rr]un)(?:ed|ing|es|s)?\b[^\n]{0,80}\bTask(?: tool)?\b|\b(?:using|through|via)\s+(?:the\s+)?Task tool\b|\bTask (?:response body|schema)\b/,
	},
];

function isExecutablePiGuidance(rel) {
	return (
		rel === "README.md" ||
		/^skills\/[^/]+\/SKILL\.md$/.test(rel) ||
		/^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(rel)
	);
}

const HISTORICAL_GUIDANCE_LINE = /\b(?:deprecated|historical|legacy|previously|removed)\b/i;

/** Reject stale executable Pi caller examples without scanning historical or third-party reference prose. */
export function assertNoLegacyPiCallerGuidance(destRoot) {
	const rels = walkFiles(destRoot).filter(isExecutablePiGuidance);
	const findings = [];
	for (const rel of rels) {
		const text = readFileSync(join(destRoot, rel), "utf8");
		for (const rule of LEGACY_PI_CALLER_GUIDANCE_RULES) {
			const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
			for (const match of text.matchAll(pattern)) {
				const lineStart = text.lastIndexOf("\n", match.index) + 1;
				const lineEnd = text.indexOf("\n", match.index);
				const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
				if (HISTORICAL_GUIDANCE_LINE.test(lineText)) continue;
				const line = text.slice(0, match.index).split("\n").length;
				findings.push(`${rel}:${line}: ${rule.id}`);
			}
		}
	}
	if (findings.length > 0) {
		throw new Error(`legacy Pi caller guidance remains:\n${findings.join("\n")}`);
	}
}

export function assertNoCursorSeams(destRoot) {
	const skillsRoot = join(destRoot, "skills");
	const rels = walkFiles(skillsRoot).map((rel) => asRelPath(`skills/${rel}`));
	const leftover = [];
	for (const rel of rels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only" || fileClass === "never-copy") continue;
		const text = readFileSync(join(destRoot, rel), "utf8");
		if (text.includes("AskQuestion")) leftover.push(`${rel}: AskQuestion`);
		if (text.includes("subagent_type")) leftover.push(`${rel}: subagent_type`);
		if (text.includes("~/.cursor/rules/pstack-models.mdc"))
			leftover.push(`${rel}: pstack-models.mdc`);
		if (text.includes("cursor-team-kit")) leftover.push(`${rel}: cursor-team-kit`);
		if (text.includes("<<<<<<<")) leftover.push(`${rel}: merge marker`);
		if (text.includes("Task subagent")) leftover.push(`${rel}: Task subagent`);
		if (text.includes("$HOME/.cursor")) leftover.push(`${rel}: $HOME/.cursor`);
		if (text.includes("@cursor-skill")) leftover.push(`${rel}: @cursor-skill`);
		if (/from \./.test(text)) leftover.push(`${rel}: from .`);
		const parts = rel.split("/");
		if (parts[parts.length - 1] !== "SKILL.md") continue;
		const skillDir = parts[1];
		const close = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
		const fm = close === -1 ? "" : text.slice(4, close);
		const hidden = /^disable-model-invocation:\s*true\s*$/m.test(fm);
		if (DISCOVERABLE.includes(skillDir)) {
			if (/^disable-model-invocation\s*:/m.test(fm)) {
				leftover.push(`${rel}: Discoverable skill must omit disable-model-invocation`);
			}
		} else if (!hidden) {
			leftover.push(`${rel}: Hidden skill missing disable-model-invocation`);
		}
	}
	if (leftover.length) {
		throw new Error(`cursor seams remain:\n${leftover.join("\n")}`);
	}
}

