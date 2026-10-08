#!/usr/bin/env node
import { lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillsRoot = fileURLToPath(new URL("../skills/", import.meta.url));
const sharedSkillsRoot = join(homedir(), ".agents", "skills");

function findExistingSkill(destination) {
	try {
		return lstatSync(destination);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

function linkSharedSkill(name) {
	const source = join(skillsRoot, name);
	const destination = join(sharedSkillsRoot, name);
	const existing = findExistingSkill(destination);
	if (existing) {
		if (
			existing.isSymbolicLink() &&
			resolve(dirname(destination), readlinkSync(destination)) === resolve(source)
		) {
			return;
		}
		console.warn(`pi-pstack: preserved existing shared skill at ${destination}`);
		return;
	}
	// Never remove an existing entry: an overlapping install must not replace it.
	try {
		symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST") {
			console.warn(`pi-pstack: preserved concurrent shared skill at ${destination}`);
			return;
		}
		throw error;
	}
}

if (process.env.PI_PSTACK_SKIP_SKILL_LINKS !== "1") {
	const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				findExistingSkill(join(skillsRoot, entry.name, "SKILL.md"))?.isFile(),
		)
		.map((entry) => entry.name)
		.sort();
	mkdirSync(sharedSkillsRoot, { recursive: true });
	for (const name of skillNames) {
		linkSharedSkill(name);
	}
}
