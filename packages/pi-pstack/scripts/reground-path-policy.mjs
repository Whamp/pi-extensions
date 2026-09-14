import { readdirSync } from "node:fs";
import { join } from "node:path";

export const DISCOVERABLE = ["how", "typescript-best-practices", "unslop", "why"];

export const CLASS_RULES = [
	{ pattern: "skills/make-bot-ui/**", class: "never-copy" },
	{ pattern: "make-bot-ui/**", class: "never-copy" },
	{ pattern: "assets/**", class: "never-copy" },
	{ pattern: "automations/**", class: "never-copy" },
	{ pattern: "docs/**", class: "never-copy" },
	{ pattern: ".cursor-plugin/**", class: "never-copy" },
	{ pattern: "agents/**", class: "never-copy" },
	{ pattern: "README.md", class: "never-copy" },
	{ pattern: "LICENSE", class: "never-copy" },

	{ pattern: "skills/deslop/**", class: "pi-only" },
	{ pattern: "skills/setup-pstack/**", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.test.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/package.json", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/bun.lock", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/worktree-audit.sh", class: "pi-only" },

	{ pattern: "skills/principle-*/**", class: "copy" },
	{ pattern: "skills/typescript-best-practices/references/patterns.md", class: "copy" },

	{ pattern: "skills/**", class: "adapt" },
];

export const DEST_ONLY_NEVER = [
	"extensions/**",
	"package.json",
	"CHANGELOG.md",
	"agents/**",
	"README.md",
];

const KNOWN_TOP = new Set(
	CLASS_RULES.map((rule) => rule.pattern.split("/")[0].replaceAll("*", "")).filter(Boolean),
);

const SKIP_WALK = new Set([".git", "node_modules"]);

function matchGlob(rel, pattern) {
	let out = "";
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "*" && pattern[i + 1] === "*") {
			out += ".*";
			i++;
		} else if (pattern[i] === "*") {
			out += "[^/]*";
		} else if (".+^${}()|[]\\".includes(pattern[i])) {
			out += `\\${pattern[i]}`;
		} else {
			out += pattern[i];
		}
	}
	return new RegExp(`^${out}$`).test(rel);
}

export function matchesAny(rel, patterns) {
	return patterns.some((pattern) => matchGlob(rel, pattern));
}

export function asRelPath(value) {
	if (typeof value !== "string" || value === "") {
		throw new Error("rel path required");
	}
	if (value.includes("\\") || value.includes("..") || value.startsWith("/")) {
		throw new Error(`invalid rel path: ${value}`);
	}
	return value;
}

export function classify(rel) {
	rel = asRelPath(rel);
	for (const rule of CLASS_RULES) {
		if (matchGlob(rel, rule.pattern)) return rule.class;
	}
	if (rel === "skills" || rel.startsWith("skills/")) return "adapt";
	const top = rel.split("/")[0];
	if (rel.includes("/") && !top.startsWith(".") && !KNOWN_TOP.has(top)) {
		throw new Error(`unclassified Cursor path: ${rel}`);
	}
	return "never-copy";
}

export function walkFiles(root) {
	const out = [];
	function rec(dir, relBase) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP_WALK.has(ent.name)) continue;
			const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
			const abs = join(dir, ent.name);
			if (ent.isDirectory()) rec(abs, rel);
			else out.push(asRelPath(rel));
		}
	}
	rec(root, "");
	return out;
}

