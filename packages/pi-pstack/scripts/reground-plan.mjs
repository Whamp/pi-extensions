import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { refreshSkillNames } from "./reground-generic-seams.mjs";
import {
	DEST_ONLY_NEVER,
	DISCOVERABLE,
	asRelPath,
	classify,
	matchesAny,
	walkFiles,
} from "./reground-path-policy.mjs";

export function parseArgs(argv) {
	let from;
	let to;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from") {
			from = argv[++i];
		} else if (arg === "--to") {
			to = argv[++i];
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else {
			throw new Error(`unknown arg: ${arg}`);
		}
	}
	if (!from || !to) {
		throw new Error("usage: --from <cursor-pstack> --to <pi-pstack> [--dry-run]");
	}
	from = resolve(from);
	to = resolve(to);
	if (!existsSync(join(from, "skills"))) {
		throw new Error(`no skills/ in ${from}`);
	}
	if (!existsSync(join(to, "skills"))) {
		throw new Error(`no skills/ in ${to}`);
	}
	return { from, to, dryRun };
}

function skillDirsAfter(to, actions) {
	const dir = join(to, "skills");
	const dirs = new Set(
		readdirSync(dir, { withFileTypes: true })
			.filter((ent) => ent.isDirectory())
			.map((ent) => ent.name),
	);
	for (const action of actions) {
		const rel = action.rel;
		if (!rel) continue;
		const m = /^skills\/([^/]+)\//.exec(rel);
		if (!m) continue;
		if (action.kind === "write") dirs.add(m[1]);
		if (action.kind === "delete" && rel === `skills/${m[1]}/SKILL.md`) dirs.delete(m[1]);
	}
	return dirs;
}

function playbookCountAfter(to, actions) {
	const dir = join(to, "skills/poteto-mode/playbooks");
	const files = new Set(
		existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : [],
	);
	for (const action of actions) {
		const m = action.rel && /^skills\/poteto-mode\/playbooks\/([^/]+\.md)$/.exec(action.rel);
		if (!m) continue;
		if (action.kind === "write") files.add(m[1]);
		if (action.kind === "delete") files.delete(m[1]);
	}
	return files.size;
}

function readOptional(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function needsCatalogCounts(to, counts) {
	const text = readOptional(join(to, "extensions/pstack/skill-catalog.test.ts"));
	return (
		!text.includes(`assert.equal(skills.length, ${counts.total})`) ||
		!text.includes(
			`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`,
		) ||
		!text.includes(`assert.equal(hidden.length, ${counts.hidden})`)
	);
}

function needsReadmeCounts(to, counts) {
	const text = readOptional(join(to, "README.md"));
	return (
		!text.includes(`**${counts.total} skills**`) ||
		!text.includes(`${counts.playbooks} playbooks`) ||
		!text.includes(`${counts.principles} principle skills`) ||
		!text.includes(`not all ${counts.total}`)
	);
}

export function plan(paths) {
	refreshSkillNames(paths.from, paths.to);
	const cursorRels = walkFiles(paths.from);
	const cursorSet = new Set(cursorRels);
	const actions = [];

	for (const rel of cursorRels) {
		const fileClass = classify(rel);
		if (fileClass === "never-copy" || fileClass === "pi-only") {
			actions.push({ kind: "skip", rel, class: fileClass });
			continue;
		}
		actions.push({
			kind: "write",
			rel,
			dest: join(paths.to, rel),
			class: fileClass,
		});
	}

	const destSkillRoot = join(paths.to, "skills");
	const destRels = existsSync(destSkillRoot)
		? walkFiles(destSkillRoot).map((rel) => asRelPath(`skills/${rel}`))
		: [];
	for (const rel of destRels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only") continue;
		const counterpart = cursorSet.has(rel) ? classify(rel) : null;
		if (counterpart === "copy" || counterpart === "adapt") continue;
		if (counterpart === "pi-only") continue;
		actions.push({ kind: "delete", dest: join(paths.to, rel), rel });
	}

	const dirs = skillDirsAfter(paths.to, actions);
	const counts = {
		total: dirs.size,
		discoverable: DISCOVERABLE.length,
		hidden: dirs.size - DISCOVERABLE.length,
		principles: [...dirs].filter((name) => name.startsWith("principle-")).length,
		playbooks: playbookCountAfter(paths.to, actions),
	};

	if (needsCatalogCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "extensions/pstack/skill-catalog.test.ts"),
			derived: "catalog-counts",
		});
	}
	if (needsReadmeCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "README.md"),
			derived: "readme-counts",
		});
	}
	return { paths, actions, counts };
}

export function printPlan(planned) {
	const tallies = { write: 0, delete: 0, patch: 0, skip: 0 };
	for (const action of planned.actions) {
		tallies[action.kind] += 1;
		if (action.kind === "write") {
			console.log(`write\t${action.class}\t${action.rel}`);
		} else if (action.kind === "delete") {
			console.log(`delete\t\t${action.rel}`);
		} else if (action.kind === "patch") {
			console.log(`patch\t${action.derived}\t${action.dest}`);
		} else {
			console.log(`skip\t${action.class}\t${action.rel}`);
		}
	}
	console.log(
		`# ${tallies.write} write, ${tallies.delete} delete, ${tallies.patch} patch, ${tallies.skip} skip`,
	);
	console.log(
		`# catalog ${planned.counts.total}/${planned.counts.discoverable}/${planned.counts.hidden} principles ${planned.counts.principles} playbooks ${planned.counts.playbooks}`,
	);
}

