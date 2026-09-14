import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
	applyBodyTransforms,
	applyFrontmatterPolicy,
	patchPotetoModePi,
} from "./reground-content-transforms.mjs";
import { refreshSkillNames } from "./reground-generic-seams.mjs";

export function renderWrite(action, paths) {
	const src = join(paths.from, action.rel);
	let text = readFileSync(src, "utf8");
	const parts = action.rel.split("/");
	const base = parts[parts.length - 1];
	const skillDir = parts[0] === "skills" ? parts[1] : "";
	if (base === "SKILL.md") {
		text = applyFrontmatterPolicy(text, skillDir);
	}
	if (action.rel === "skills/poteto-mode/SKILL.md") {
		text = patchPotetoModePi(text);
	}
	if (action.class === "adapt") {
		text = applyBodyTransforms(text, action.rel);
	}
	return text;
}

function writeIfChanged(dest, text, modeSrc) {
	mkdirSync(dirname(dest), { recursive: true });
	if (existsSync(dest) && readFileSync(dest, "utf8") === text) return false;
	const opts = {};
	if (modeSrc && existsSync(modeSrc)) {
		opts.mode = lstatSync(modeSrc).mode & 0o777;
	} else if (existsSync(dest)) {
		opts.mode = lstatSync(dest).mode & 0o777;
	}
	writeFileSync(dest, text, opts);
	return true;
}

function patchCatalogCounts(text, counts) {
	return text
		.replace(
			/assert\.equal\(skills\.length, \d+\)/g,
			`assert.equal(skills.length, ${counts.total})`,
		)
		.replace(
			/assert\.equal\(skills\.filter\(\(skill\) => skill\.hidden\)\.length, \d+\)/g,
			`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`,
		)
		.replace(
			/assert\.equal\(hidden\.length, \d+\)/g,
			`assert.equal(hidden.length, ${counts.hidden})`,
		);
}

function patchReadmeCounts(text, counts) {
	return text
		.replace(/\*\*\d+ skills\*\*/g, `**${counts.total} skills**`)
		.replace(/not all \d+/g, `not all ${counts.total}`)
		.replace(/\d+ playbooks/g, `${counts.playbooks} playbooks`)
		.replace(/\d+ principle skills/g, `${counts.principles} principle skills`);
}

export function applyDerivedPatch(kind, destRoot, counts) {
	if (kind === "catalog-counts") {
		const dest = join(destRoot, "extensions/pstack/skill-catalog.test.ts");
		writeIfChanged(dest, patchCatalogCounts(readFileSync(dest, "utf8"), counts));
		return;
	}
	if (kind === "readme-counts") {
		const dest = join(destRoot, "README.md");
		writeIfChanged(dest, patchReadmeCounts(readFileSync(dest, "utf8"), counts));
	}
}

export function apply(planned) {
	refreshSkillNames(planned.paths.from, planned.paths.to);
	for (const action of planned.actions) {
		if (action.kind === "skip") continue;
		if (action.kind === "write") {
			writeIfChanged(
				action.dest,
				renderWrite(action, planned.paths),
				join(planned.paths.from, action.rel),
			);
			continue;
		}
		if (action.kind === "delete") {
			if (existsSync(action.dest)) unlinkSync(action.dest);
			continue;
		}
		if (action.kind === "patch") {
			applyDerivedPatch(action.derived, planned.paths.to, planned.counts);
		}
	}
}

