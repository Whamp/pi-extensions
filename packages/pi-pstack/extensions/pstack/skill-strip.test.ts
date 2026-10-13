import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { stripSkillsByLocationPrefix } from "./skill-strip.ts";

const HEADER =
	"The following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.";

function skill(name: string, description: string, location: string): string {
	return `  <skill>\n    <name>${name}</name>\n    <description>${description}</description>\n    <location>${location}</location>\n  </skill>\n`;
}

const PSTACK_PREFIX = "/tmp/fake/pkg/skills";

function fixture(entries: string): string {
	return `\n\n${HEADER}\n\n<available_skills>\n${entries}</available_skills>`;
}

void describe("stripSkillsByLocationPrefix", () => {
	for (const linkKind of ["file", "directory"] as const) {
		void it(`removes a package skill advertised through a shared ${linkKind} symlink`, (context) => {
			const root = mkdtempSync(join(tmpdir(), "pstack-skill-strip-"));
			context.after(() => rmSync(root, { recursive: true, force: true }));
			const packageSkills = join(root, "package", "skills");
			const reviewDirectory = join(packageSkills, "review & design");
			const sharedDirectory = join(root, "shared");
			mkdirSync(reviewDirectory, { recursive: true });
			mkdirSync(sharedDirectory);
			const reviewFile = join(reviewDirectory, "SKILL.md");
			writeFileSync(reviewFile, "Review code.");
			const sharedLocation = join(sharedDirectory, "review", "SKILL.md");
			if (linkKind === "directory") {
				symlinkSync(reviewDirectory, join(sharedDirectory, "review"), "dir");
			} else {
				mkdirSync(join(sharedDirectory, "review"));
				symlinkSync(reviewFile, sharedLocation, "file");
			}
			const unrelatedFile = join(sharedDirectory, "unrelated.md");
			writeFileSync(unrelatedFile, "Custom skill.");
			const unrelated = skill("unrelated", "Custom.", unrelatedFile);
			const prompt = fixture(skill("review", "Review.", sharedLocation) + unrelated);
			const result = stripSkillsByLocationPrefix(prompt, packageSkills);
			assert.equal(result.removed, 1);
			assert.equal(result.prompt, fixture(unrelated));
		});
	}

	void it("resolves a linked package root and preserves skills linked outside it", (context) => {
		const root = mkdtempSync(join(tmpdir(), "pstack-skill-root-"));
		context.after(() => rmSync(root, { recursive: true, force: true }));
		const packageSkills = join(root, "skills & package");
		mkdirSync(packageSkills);
		const linkedRoot = join(root, "linked-root");
		symlinkSync(packageSkills, linkedRoot, "dir");
		const ownedFile = join(packageSkills, "SKILL.md");
		writeFileSync(ownedFile, "Owned.");
		const unrelatedFile = join(root, "custom.md");
		writeFileSync(unrelatedFile, "Custom.");
		const outsideLink = join(packageSkills, "custom.md");
		symlinkSync(unrelatedFile, outsideLink, "file");
		const siblingFile = join(root, "skills & package-other.md");
		writeFileSync(siblingFile, "Sibling.");
		const kept =
			skill("custom", "Custom.", outsideLink) + skill("sibling", "Sibling.", siblingFile);
		const owned = skill("owned", "Owned.", ownedFile.replaceAll("&", "&amp;"));
		const missing = skill("missing", "Synthetic.", join(linkedRoot, "missing", "SKILL.md"));
		const result = stripSkillsByLocationPrefix(fixture(owned + missing + kept), linkedRoot);
		assert.equal(result.removed, 2);
		assert.equal(result.prompt, fixture(kept));
	});

	void it("uses lexical fallback for a non-directory component", (context) => {
		const root = mkdtempSync(join(tmpdir(), "pstack-skill-file-"));
		context.after(() => rmSync(root, { recursive: true, force: true }));
		const prefix = join(root, "file");
		writeFileSync(prefix, "Not a directory.");
		const prompt = fixture(skill("synthetic", "Synthetic.", join(prefix, "SKILL.md")));
		assert.equal(stripSkillsByLocationPrefix(prompt, prefix).removed, 1);
	});

	void it("propagates filesystem errors other than missing or non-directory paths", (context) => {
		const root = mkdtempSync(join(tmpdir(), "pstack-skill-loop-"));
		context.after(() => rmSync(root, { recursive: true, force: true }));
		const loop = join(root, "loop");
		symlinkSync(loop, loop);
		const prompt = fixture(skill("loop", "Loop.", loop));
		assert.throws(() => stripSkillsByLocationPrefix(prompt, root), { code: "ELOOP" });
		assert.throws(() => stripSkillsByLocationPrefix(prompt, loop), { code: "ELOOP" });
	});

	void it("returns input unchanged with removed 0 when no skills block exists", () => {
		const prompt = "\n\nYou are a coding agent.\n\n<other_section>hello</other_section>";
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});

	void it("removes only pstack entries and keeps foreign entries byte-identical", () => {
		const architect = skill(
			"architect",
			"Sketch types, signatures, and module structure before code.",
			`${PSTACK_PREFIX}/architect/SKILL.md`,
		);
		const tdd = skill(
			"tdd",
			"Red, green, refactor with failing tests first.",
			`${PSTACK_PREFIX}/tdd/SKILL.md`,
		);
		const echo = skill("echo", "Echo text back.", "/tmp/other/skills/echo/SKILL.md");
		const prompt = fixture(architect + tdd + echo);
		const result = stripSkillsByLocationPrefix(prompt, `${PSTACK_PREFIX}/`);
		assert.equal(result.removed, 2);
		assert.equal(result.prompt, fixture(echo));
		assert.ok(result.prompt.includes("/tmp/other/skills/echo/SKILL.md"));
		assert.ok(!result.prompt.includes(PSTACK_PREFIX));
	});

	void it("removes the whole section including the header sentence when every entry is pstack", () => {
		const entries =
			skill("architect", "Design first.", `${PSTACK_PREFIX}/architect/SKILL.md`) +
			skill("tdd", "Tests first.", `${PSTACK_PREFIX}/tdd/SKILL.md`);
		const prompt = fixture(entries);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 2);
		assert.ok(!result.prompt.includes("<available_skills>"));
		assert.ok(!result.prompt.includes("</available_skills>"));
		assert.ok(!result.prompt.includes("The following skills provide specialized instructions"));
		assert.equal(
			stripSkillsByLocationPrefix(
				fixture(skill("only", "one", `${PSTACK_PREFIX}/x/SKILL.md`)),
				PSTACK_PREFIX,
			).removed,
			1,
		);
	});

	void it("parses escaped descriptions without breaking or leaking unescaped entities", () => {
		const tricky = skill(
			"tricky",
			"Handles a &amp; b &lt;tag&gt; inputs.",
			`${PSTACK_PREFIX}/tricky/SKILL.md`,
		);
		const kept = skill("kept", "Plain.", "/tmp/other/skills/kept/SKILL.md");
		const prompt = fixture(tricky + kept);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 1);
		assert.equal(result.prompt, fixture(kept));
	});

	void it("removes even the five Discoverable pstack skills", () => {
		const echo = skill("echo", "Echo text back.", "/tmp/other/skills/echo/SKILL.md");
		const prompt = fixture(
			skill("code-review", "Review.", `${PSTACK_PREFIX}/code-review/SKILL.md`) +
				skill("how", "How.", `${PSTACK_PREFIX}/how/SKILL.md`) +
				skill("why", "Why.", `${PSTACK_PREFIX}/why/SKILL.md`) +
				skill("unslop", "Unslop.", `${PSTACK_PREFIX}/unslop/SKILL.md`) +
				skill(
					"typescript-best-practices",
					"TS.",
					`${PSTACK_PREFIX}/typescript-best-practices/SKILL.md`,
				) +
				echo,
		);
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.removed, 5);
		assert.equal(result.prompt, fixture(echo));
	});

	void it("returns input unchanged for an empty prefix", () => {
		const prompt = fixture(skill("architect", "Design.", `${PSTACK_PREFIX}/architect/SKILL.md`));
		const result = stripSkillsByLocationPrefix(prompt, "");
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});

	void it("returns input unchanged when the closing tag is missing", () => {
		const prompt = `\n\n<available_skills>\n${skill("architect", "Design.", `${PSTACK_PREFIX}/architect/SKILL.md`)}`;
		const result = stripSkillsByLocationPrefix(prompt, PSTACK_PREFIX);
		assert.equal(result.prompt, prompt);
		assert.equal(result.removed, 0);
	});
});
