import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const skillsRoot = join(packageRoot, "skills");

function withIsolatedHome(run) {
	const home = mkdtempSync(join(tmpdir(), "pstack-skills-"));
	try {
		run(home, join(home, ".agents", "skills"));
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function runPostinstall(cwd, home, extraEnv = {}) {
	const result = spawnSync("npm", ["run", "postinstall", "--silent"], {
		cwd,
		env: {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			PI_PSTACK_SKIP_SKILL_LINKS: "0",
			...extraEnv,
		},
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	return result;
}

function assertSharedSkills(sharedRoot) {
	const names = readdirSync(skillsRoot);
	assert.equal(names.length, 48);
	assert.deepEqual(readdirSync(sharedRoot).sort(), names.sort());
	for (const name of names) {
		assert.ok(lstatSync(join(sharedRoot, name)).isSymbolicLink());
		assert.equal(realpathSync(join(sharedRoot, name)), realpathSync(join(skillsRoot, name)));
	}
	assert.match(
		readFileSync(join(sharedRoot, "bro", "SKILL.md"), "utf8"),
		/disable-model-invocation: true/,
	);
	assert.equal(
		readFileSync(join(sharedRoot, "poteto-mode", "playbooks", "bug-fix.md"), "utf8"),
		readFileSync(join(skillsRoot, "poteto-mode", "playbooks", "bug-fix.md"), "utf8"),
	);
}

describe("Pstack shared skill installation", () => {
	for (const [name, root] of [
		["Git repository", repositoryRoot],
		["npm package", packageRoot],
	]) {
		it(`links all skills through the ${name} lifecycle hook and is repeatable`, () => {
			withIsolatedHome((home, sharedRoot) => {
				runPostinstall(root, home);
				assertSharedSkills(sharedRoot);
				assert.equal(runPostinstall(root, home).stderr, "");
				assertSharedSkills(sharedRoot);
			});
		});
	}

	it("preserves existing directories, files, and dangling or foreign symlinks", () => {
		withIsolatedHome((home, sharedRoot) => {
			mkdirSync(join(sharedRoot, "bro"), { recursive: true });
			writeFileSync(join(sharedRoot, "bro", "SKILL.md"), "user-owned bro");
			writeFileSync(join(sharedRoot, "how"), "user-owned file");
			symlinkSync(join(home, "missing"), join(sharedRoot, "unslop"), "dir");
			mkdirSync(join(home, "foreign"));
			symlinkSync(join(home, "foreign"), join(sharedRoot, "why"), "dir");
			const result = runPostinstall(packageRoot, home);
			assert.equal(readFileSync(join(sharedRoot, "bro", "SKILL.md"), "utf8"), "user-owned bro");
			assert.equal(readFileSync(join(sharedRoot, "how"), "utf8"), "user-owned file");
			assert.ok(lstatSync(join(sharedRoot, "unslop")).isSymbolicLink());
			assert.equal(realpathSync(join(sharedRoot, "why")), join(home, "foreign"));
			assert.equal(result.stderr.split("preserved existing shared skill").length - 1, 4);
			assert.equal(
				realpathSync(join(sharedRoot, "poteto-mode")),
				realpathSync(join(skillsRoot, "poteto-mode")),
			);
		});
	});

	it("supports opting out without creating the shared directory", () => {
		withIsolatedHome((home, sharedRoot) => {
			runPostinstall(packageRoot, home, { PI_PSTACK_SKIP_SKILL_LINKS: "1" });
			assert.throws(() => lstatSync(sharedRoot), { code: "ENOENT" });
		});
	});

	it("reports filesystem failures instead of claiming installation succeeded", () => {
		withIsolatedHome((home) => {
			writeFileSync(join(home, ".agents"), "not a directory");
			const result = spawnSync(
				process.execPath,
				[join(packageRoot, "scripts", "install-shared-skills.mjs")],
				{
					env: { ...process.env, HOME: home, USERPROFILE: home, PI_PSTACK_SKIP_SKILL_LINKS: "0" },
					encoding: "utf8",
				},
			);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /ENOTDIR/);
		});
	});

	it("includes the installer in the published tarball", () => {
		const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
			cwd: packageRoot,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const [archive] = JSON.parse(result.stdout);
		assert.ok(archive.files.some((file) => file.path === "scripts/install-shared-skills.mjs"));
	});
});
