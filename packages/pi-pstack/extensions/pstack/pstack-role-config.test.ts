import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	decodePstackConfigText,
	defaultPstackRoleConfig,
	type PstackConfigReadResult,
} from "./pstack-role-config.ts";
import {
	backupPstackConfigThenSave,
	loadPstackRoleConfig,
	savePstackRoleConfig,
	savePstackRoleConfigIfUnchanged,
} from "./pstack-role-config-store.ts";

const MAX_CONFIG_BYTES = 100_000;
const SELECTOR = "openai-codex/gpt-5.6-sol:high";
const SELECTOR_B = "xai/grok-4.6:high";
const SELECTOR_C = "zai/glm-5.3:max";

const V1_TARGETS: ReadonlyArray<readonly [string, readonly string[]]> = [
	["feature, refactoring", ["feature implementation", "refactoring implementation"]],
	["bug-fix", ["bug-fix"]],
	["perf-issue", ["perf-issue"]],
	["hillclimb", ["hillclimb"]],
	["judgment and prose", ["judgment", "prose"]],
	["hardest tasks", ["hardest tasks"]],
	["how explorer", ["how explorers"]],
	["how explainer", ["how explainer", "how synthesizer"]],
	["why investigators", ["why investigators"]],
	["why synthesizer", ["why synthesizer"]],
	["reflect tooling", ["reflect tooling reviewer"]],
	[
		"reflect judgment, divergent, synthesizer",
		["reflect judgment reviewer", "reflect divergent reviewer", "reflect synthesizer"],
	],
	["arena runners", ["arena runners"]],
	["arena cross-judge pool", ["arena judge pool"]],
	["swarm workers", ["swarm workers"]],
	["architect runners", ["architect runners"]],
	["interrogate reviewers", ["interrogate reviewers"]],
];

function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function decode(value: unknown): PstackConfigReadResult {
	return decodePstackConfigText(JSON.stringify(value));
}

function codes(result: PstackConfigReadResult): string[] {
	return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function diagnosticsWithCode(result: PstackConfigReadResult, code: string) {
	return result.diagnostics.filter((diagnostic) => diagnostic.code === code);
}

describe("defaultPstackRoleConfig", () => {
	it("is version 2 with omitted roles inheriting and skills on", () => {
		assert.deepEqual(defaultPstackRoleConfig(), { version: 2, roles: {}, skillsEnabled: true });
	});
});

describe("decodePstackConfigText v2", () => {
	it("keeps explicit selectors, effort suffixes, list order, and duplicates", () => {
		const result = decode({
			version: 2,
			roles: {
				"feature implementation": SELECTOR,
				"arena runners": [SELECTOR_B, SELECTOR, SELECTOR_B],
				"arena judge pool": [SELECTOR_C],
			},
			skillsEnabled: true,
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.version, 2);
		assert.equal(result.config.roles["feature implementation"], SELECTOR);
		assert.deepEqual(result.config.roles["arena runners"], [SELECTOR_B, SELECTOR, SELECTOR_B]);
		assert.deepEqual(result.config.roles["arena judge pool"], [SELECTOR_C]);
		assert.equal(result.config.roles.hillclimb, undefined);
		assert.equal(result.diagnostics.length, 0);
	});

	it("normalizes auto to inherit-parent by omitting the role", () => {
		const result = decode({
			version: 2,
			roles: {
				"bug-fix": "auto",
				prose: "inherit-parent",
				"perf-issue": SELECTOR,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["bug-fix"], undefined);
		assert.equal(result.config.roles.prose, undefined);
		assert.equal(result.config.roles["perf-issue"], SELECTOR);
		assert.equal(result.diagnostics.length, 0);
	});

	it("accepts top-level inherit-parent for fanout and pick-one roles", () => {
		const result = decode({
			version: 2,
			roles: {
				"arena runners": "inherit-parent",
				"arena judge pool": "auto",
				"architect runners": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.equal(result.config.roles["arena judge pool"], undefined);
		assert.deepEqual(codes(result), ["invalid-role-selection"]);
		assert.equal(result.diagnostics[0]?.role, "architect runners");
		assert.equal(result.config.roles["architect runners"], undefined);
	});

	it("accepts a one-entry Architect list because the registry does not own a two-candidate minimum", () => {
		const result = decode({
			version: 2,
			roles: { "architect runners": [SELECTOR] },
		});
		assert.equal(result.source, "v2");
		assert.deepEqual(result.config.roles["architect runners"], [SELECTOR]);
		assert.equal(result.diagnostics.length, 0);
	});

	it("rejects scalar/repeat arrays, empty lists, and inheritance aliases inside arrays", () => {
		const result = decode({
			version: 2,
			roles: {
				judgment: [SELECTOR, SELECTOR_B],
				hillclimb: [SELECTOR],
				"arena runners": [],
				"arena judge pool": [SELECTOR, "inherit-parent"],
				"swarm workers": "auto",
				"how explorers": SELECTOR,
				"interrogate reviewers": [SELECTOR, "auto", SELECTOR_B],
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles.judgment, undefined);
		assert.equal(result.config.roles.hillclimb, undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.equal(result.config.roles["arena judge pool"], undefined);
		assert.equal(result.config.roles["swarm workers"], undefined);
		assert.equal(result.config.roles["how explorers"], SELECTOR);
		assert.equal(result.config.roles["interrogate reviewers"], undefined);
		assert.deepEqual(new Set(codes(result)), new Set(["invalid-role-selection"]));
		assert.deepEqual(
			new Set(diagnosticsWithCode(result, "invalid-role-selection").map((diagnostic) => diagnostic.role)),
			new Set(["judgment", "hillclimb", "arena runners", "arena judge pool", "interrogate reviewers"]),
		);
	});

	it("reports unknown roles and invalid selectors without dropping unrelated valid roles", () => {
		const result = decode({
			version: 2,
			roles: {
				"bug-fix": SELECTOR,
				"not-a-role": SELECTOR_B,
				"how critics": SELECTOR_C,
				"how explainer": "no-slash",
				"why synthesizer": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.roles["bug-fix"], SELECTOR);
		assert.equal(result.config.roles["why synthesizer"], SELECTOR_B);
		assert.equal(result.config.roles["how explainer"], undefined);
		assert.ok(codes(result).includes("unknown-role"));
		assert.ok(codes(result).includes("retired-role"));
		assert.ok(codes(result).includes("invalid-selector"));
		assert.equal(diagnosticsWithCode(result, "retired-role")[0]?.role, "how critics");
		assert.equal(diagnosticsWithCode(result, "unknown-role")[0]?.role, "not-a-role");
	});

	it("keeps a valid skills flag when roles is not an object", () => {
		const result = decode({
			version: 2,
			roles: ["bug-fix", SELECTOR],
			skillsEnabled: false,
		});
		assert.equal(result.source, "v2");
		assert.equal(result.config.skillsEnabled, false);
		assert.deepEqual(result.config.roles, {});
		assert.ok(codes(result).includes("invalid-document"));
	});

	it("defaults an invalid skills flag to true and reports it", () => {
		const result = decode({
			version: 2,
			roles: { "bug-fix": SELECTOR },
			skillsEnabled: "off",
		});
		assert.equal(result.config.skillsEnabled, true);
		assert.equal(result.config.roles["bug-fix"], SELECTOR);
		assert.ok(codes(result).includes("invalid-skills-enabled"));
	});
});

describe("decodePstackConfigText v1 migration", () => {
	it("copies every v1 key onto the chosen v2 targets, including combined roles and effort suffixes", () => {
		const roles: Record<string, string> = {};
		for (const [legacyName] of V1_TARGETS) {
			roles[legacyName] = SELECTOR;
		}
		const result = decode({ version: 1, roles, skillsEnabled: false });
		assert.equal(result.source, "v1");
		assert.equal(result.config.version, 2);
		assert.equal(result.config.skillsEnabled, false);
		assert.ok(codes(result).includes("legacy-migrated"));
		const listRoles = new Set([
			"arena runners",
			"arena judge pool",
			"architect runners",
			"interrogate reviewers",
		]);
		for (const [, targets] of V1_TARGETS) {
			for (const target of targets) {
				if (listRoles.has(target)) {
					assert.deepEqual(result.config.roles[target], [SELECTOR]);
				} else {
					assert.equal(result.config.roles[target], SELECTOR);
				}
			}
		}
		assert.equal(Object.keys(result.config.roles).length, 22);
	});

	it("treats retired how critics as unknown with no replacement", () => {
		const result = decode({
			version: 1,
			roles: {
				"how critics": SELECTOR,
				"bug-fix": SELECTOR_B,
			},
		});
		assert.equal(result.source, "v1");
		assert.equal(result.config.roles["bug-fix"], SELECTOR_B);
		assert.equal(result.config.roles["interrogate reviewers"], undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		const retired = diagnosticsWithCode(result, "retired-role");
		assert.equal(retired.length, 1);
		assert.equal(retired[0]?.role, "how critics");
		assert.match(retired[0]?.message ?? "", /no replacement/);
	});

	it("treats atomic v2 names inside a v1 document as unknown", () => {
		const result = decode({
			version: 1,
			roles: {
				"feature implementation": SELECTOR,
				"bug-fix": SELECTOR_B,
			},
		});
		assert.equal(result.config.roles["feature implementation"], undefined);
		assert.equal(result.config.roles["bug-fix"], SELECTOR_B);
		assert.equal(diagnosticsWithCode(result, "unknown-role")[0]?.role, "feature implementation");
	});

	it("takes the first real selector from an ambiguous v1 array for scalar and repeat targets", () => {
		const result = decode({
			version: 1,
			roles: {
				"feature, refactoring": [SELECTOR, SELECTOR_B],
				hillclimb: ["inherit-parent", SELECTOR_C, SELECTOR],
				"how explorer": [SELECTOR_B],
			},
		});
		assert.equal(result.config.roles["feature implementation"], SELECTOR);
		assert.equal(result.config.roles["refactoring implementation"], SELECTOR);
		assert.equal(result.config.roles.hillclimb, SELECTOR_C);
		assert.equal(result.config.roles["how explorers"], SELECTOR_B);
		const ambiguous = diagnosticsWithCode(result, "ambiguous-legacy-selection");
		assert.deepEqual(
			new Set(ambiguous.map((diagnostic) => diagnostic.role)),
			new Set(["feature, refactoring", "hillclimb"]),
		);
		assert.match(ambiguous[0]?.message ?? "", /Retained 1 selector and discarded 1/);
	});

	it("keeps v1 list order, strips inherit aliases, and turns a scalar list role into a singleton list", () => {
		const result = decode({
			version: 1,
			roles: {
				"arena runners": ["auto", SELECTOR_B, "inherit-parent", SELECTOR_B],
				"arena cross-judge pool": SELECTOR_C,
				"architect runners": [SELECTOR],
				"interrogate reviewers": ["bad", SELECTOR, "__proto__/x"],
			},
		});
		assert.deepEqual(result.config.roles["arena runners"], [SELECTOR_B, SELECTOR_B]);
		assert.deepEqual(result.config.roles["arena judge pool"], [SELECTOR_C]);
		assert.deepEqual(result.config.roles["architect runners"], [SELECTOR]);
		assert.deepEqual(result.config.roles["interrogate reviewers"], [SELECTOR]);
		assert.ok(diagnosticsWithCode(result, "invalid-selector").some((diagnostic) => diagnostic.index === 0));
		assert.ok(diagnosticsWithCode(result, "invalid-selector").some((diagnostic) => diagnostic.role === "interrogate reviewers"));
	});

	it("falls back to inheritance when a v1 array has no real selectors", () => {
		const result = decode({
			version: 1,
			roles: {
				"bug-fix": ["no-slash", "auto"],
				"arena runners": ["inherit-parent", "auto"],
			},
		});
		assert.equal(result.config.roles["bug-fix"], undefined);
		assert.equal(result.config.roles["arena runners"], undefined);
		assert.ok(codes(result).includes("invalid-selector"));
	});
});

describe("decodePstackConfigText failures", () => {
	it("returns defaults for invalid JSON, documents, and versions without throwing", () => {
		const invalidJson = decodePstackConfigText("{not json");
		assert.equal(invalidJson.source, "invalid");
		assert.deepEqual(invalidJson.config, defaultPstackRoleConfig());
		assert.ok(codes(invalidJson).includes("invalid-json"));

		const invalidDocument = decodePstackConfigText("[]");
		assert.equal(invalidDocument.source, "invalid");
		assert.ok(codes(invalidDocument).includes("invalid-document"));

		const unsupported = decode({ version: 3, roles: { "bug-fix": SELECTOR } });
		assert.equal(unsupported.source, "invalid");
		assert.deepEqual(unsupported.config, defaultPstackRoleConfig());
		assert.ok(codes(unsupported).includes("unsupported-version"));
	});
});

describe("loadPstackRoleConfig / savePstackRoleConfig", () => {
	it("treats a missing file as normal silent inherit-all", () => {
		const dir = tempDir("pstack-v2-missing-");
		try {
			const result = loadPstackRoleConfig(join(dir, "models.json"), join(dir, "missing.md"));
			assert.equal(result.source, "missing");
			assert.deepEqual(result.config, defaultPstackRoleConfig());
			assert.deepEqual(result.diagnostics, []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not rewrite v1 or recovered bytes on read", () => {
		const dir = tempDir("pstack-v2-norewrite-");
		const path = join(dir, "models.json");
		const original = `${JSON.stringify(
			{
				version: 1,
				roles: {
					"feature, refactoring": [SELECTOR, SELECTOR_B],
					"how critics": SELECTOR_C,
				},
			},
			null,
			2,
		)}\n`;
		try {
			writeFileSync(path, original, "utf8");
			const result = loadPstackRoleConfig(path);
			assert.equal(result.source, "v1");
			assert.equal(result.config.roles["feature implementation"], SELECTOR);
			assert.ok(codes(result).includes("ambiguous-legacy-selection"));
			assert.ok(codes(result).includes("retired-role"));
			assert.equal(readFileSync(path, "utf8"), original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("round-trips a normalized v2 document including effort suffixes", () => {
		const dir = tempDir("pstack-v2-roundtrip-");
		const path = join(dir, "pstack", "models.json");
		try {
			const decoded = decode({
				version: 2,
				roles: {
					"feature implementation": SELECTOR,
					"arena runners": [SELECTOR_B, SELECTOR_C],
					hillclimb: SELECTOR,
				},
				skillsEnabled: false,
			});
			const saved = savePstackRoleConfig(decoded.config, path);
			assert.equal(saved.ok, true);
			const loaded = loadPstackRoleConfig(path);
			assert.equal(loaded.source, "v2");
			assert.deepEqual(loaded.config, decoded.config);
			assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
			if (process.platform !== "win32") {
				assert.equal(lstatSync(path).mode & 0o777, 0o600);
			}
			const again = decodePstackConfigText(readFileSync(path, "utf8"));
			assert.equal(again.source, "v2");
			assert.deepEqual(again.config, decoded.config);
			assert.equal(again.diagnostics.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads legacy markdown in memory when JSON is absent and leaves markdown bytes unchanged", () => {
		const dir = tempDir("pstack-v2-md-");
		const jsonPath = join(dir, "models.json");
		const mdPath = join(dir, "pstack-models.md");
		const markdown = `feature, refactoring: ${SELECTOR}\narena runners: ${SELECTOR_B}, ${SELECTOR_C}\nhow critics: ${SELECTOR}\n`;
		try {
			writeFileSync(mdPath, markdown, "utf8");
			const result = loadPstackRoleConfig(jsonPath, mdPath);
			assert.equal(result.source, "markdown");
			assert.equal(result.config.roles["feature implementation"], SELECTOR);
			assert.equal(result.config.roles["refactoring implementation"], SELECTOR);
			assert.deepEqual(result.config.roles["arena runners"], [SELECTOR_B, SELECTOR_C]);
			assert.ok(codes(result).includes("retired-role"));
			assert.equal(readFileSync(mdPath, "utf8"), markdown);
			assert.equal(loadPstackRoleConfig(jsonPath, mdPath).source, "markdown");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns diagnostics for a symlink, oversized file, and unreadable file", () => {
		const dir = tempDir("pstack-v2-files-");
		try {
			const target = join(dir, "target.json");
			const link = join(dir, "models.json");
			writeFileSync(target, JSON.stringify({ version: 2, roles: { "bug-fix": SELECTOR } }), "utf8");
			symlinkSync(target, link);
			const linked = loadPstackRoleConfig(link);
			assert.equal(linked.source, "invalid");
			assert.ok(codes(linked).includes("not-regular-file"));
			assert.deepEqual(linked.config, defaultPstackRoleConfig());

			const big = join(dir, "big.json");
			writeFileSync(big, "x".repeat(MAX_CONFIG_BYTES + 1), "utf8");
			const oversized = loadPstackRoleConfig(big);
			assert.equal(oversized.source, "invalid");
			assert.ok(codes(oversized).includes("config-too-large"));

			const unreadable = join(dir, "unreadable.json");
			writeFileSync(unreadable, JSON.stringify({ version: 2, roles: {} }), "utf8");
			chmodSync(unreadable, 0);
			try {
				const failed = loadPstackRoleConfig(unreadable);
				assert.equal(failed.source, "invalid");
				assert.ok(codes(failed).includes("config-read-failed"));
			} finally {
				chmodSync(unreadable, 0o600);
			}

			const saved = savePstackRoleConfig(defaultPstackRoleConfig(), link);
			assert.equal(saved.ok, false);
			assert.ok(saved.ok === false && saved.diagnostics.some((diagnostic) => diagnostic.code === "config-write-failed"));
			assert.equal(lstatSync(link).isSymbolicLink(), true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("savePstackRoleConfigIfUnchanged", () => {
	it("replaces matching bytes and refuses stale or unexpectedly created files", () => {
		const dir = tempDir("pstack-v2-unchanged-");
		const path = join(dir, "models.json");
		const original = `${JSON.stringify({ version: 2, roles: { "bug-fix": SELECTOR }, skillsEnabled: true }, null, 2)}\n`;
		const next = decode({ version: 2, roles: { "bug-fix": SELECTOR_B }, skillsEnabled: true }).config;
		try {
			writeFileSync(path, original, "utf8");
			assert.equal(savePstackRoleConfigIfUnchanged({ config: next, path, originalBytes: original }).ok, true);
			const saved = readFileSync(path, "utf8");
			assert.equal(loadPstackRoleConfig(path).config.roles["bug-fix"], SELECTOR_B);

			const stale = savePstackRoleConfigIfUnchanged({
				config: defaultPstackRoleConfig(),
				path,
				originalBytes: original,
			});
			assert.equal(stale.ok, false);
			assert.ok(stale.ok === false && stale.diagnostics.some((diagnostic) => diagnostic.code === "config-changed"));
			assert.equal(readFileSync(path, "utf8"), saved);

			const unexpected = savePstackRoleConfigIfUnchanged({ config: defaultPstackRoleConfig(), path });
			assert.equal(unexpected.ok, false);
			assert.equal(readFileSync(path, "utf8"), saved);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates a new config only while the destination is missing", () => {
		const dir = tempDir("pstack-v2-create-");
		const path = join(dir, "nested", "models.json");
		try {
			const result = savePstackRoleConfigIfUnchanged({ config: defaultPstackRoleConfig(), path });
			assert.equal(result.ok, true);
			assert.equal(loadPstackRoleConfig(path).source, "v2");
			if (process.platform !== "win32") assert.equal(lstatSync(path).mode & 0o777, 0o600);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("backupPstackConfigThenSave", () => {
	it("writes original bytes to an exclusive 0600 backup, then saves v2", () => {
		const dir = tempDir("pstack-v2-backup-");
		const path = join(dir, "models.json");
		const original = `${JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR } }, null, 2)}\n`;
		try {
			writeFileSync(path, original, { encoding: "utf8", mode: 0o644 });
			const v2 = decode({
				version: 1,
				roles: { "bug-fix": SELECTOR },
			}).config;
			const result = backupPstackConfigThenSave({
				originalBytes: original,
				config: v2,
				path,
			});
			assert.equal(result.ok, true);
			const backupPath = join(dir, "models.json.bak");
			assert.equal(readFileSync(backupPath, "utf8"), original);
			assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
			assert.equal(loadPstackRoleConfig(path).config.roles["bug-fix"], SELECTOR);
			if (process.platform !== "win32") {
				assert.equal(lstatSync(backupPath).mode & 0o777, 0o600);
				assert.equal(lstatSync(path).mode & 0o777, 0o600);
			}

			const blocked = backupPstackConfigThenSave({
				originalBytes: readFileSync(path, "utf8"),
				config: { version: 2, roles: { prose: SELECTOR_B }, skillsEnabled: true },
				path,
			});
			assert.equal(blocked.ok, false);
			assert.ok(blocked.ok === false && blocked.diagnostics.some((diagnostic) => diagnostic.code === "config-write-failed"));
			assert.equal(readFileSync(backupPath, "utf8"), original);
			assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
			assert.equal(loadPstackRoleConfig(path).config.roles.prose, undefined);
			assert.equal(loadPstackRoleConfig(path).config.roles["bug-fix"], SELECTOR);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("backs up legacy Markdown before creating the v2 JSON destination", () => {
		const dir = tempDir("pstack-v2-markdown-backup-");
		const path = join(dir, "models.json");
		const sourcePath = join(dir, "pstack-models.md");
		const original = `bug-fix: ${SELECTOR}\n`;
		try {
			writeFileSync(sourcePath, original, "utf8");
			const config = loadPstackRoleConfig(path, sourcePath).config;
			const result = backupPstackConfigThenSave({ originalBytes: original, config, path, sourcePath });
			assert.equal(result.ok, true);
			assert.equal(readFileSync(`${sourcePath}.bak`, "utf8"), original);
			assert.equal(loadPstackRoleConfig(path).config.roles["bug-fix"], SELECTOR);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to back up stale bytes or overwrite a concurrently changed source", () => {
		const dir = tempDir("pstack-v2-stale-backup-");
		const path = join(dir, "models.json");
		const original = `${JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR } }, null, 2)}\n`;
		const changed = `${JSON.stringify({ version: 1, roles: { "bug-fix": SELECTOR_B } }, null, 2)}\n`;
		try {
			writeFileSync(path, original, "utf8");
			const config = loadPstackRoleConfig(path).config;
			writeFileSync(path, changed, "utf8");
			const result = backupPstackConfigThenSave({ originalBytes: original, config, path });
			assert.equal(result.ok, false);
			assert.ok(result.ok === false && result.diagnostics.some((diagnostic) => diagnostic.code === "config-changed"));
			assert.equal(readFileSync(path, "utf8"), changed);
			assert.equal(existsSync(`${path}.bak`), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not overwrite the source when backup creation fails", () => {
		const dir = tempDir("pstack-v2-backup-fail-");
		const path = join(dir, "models.json");
		const backupPath = join(dir, "models.json.bak");
		const original = `${JSON.stringify({ version: 1, roles: { hillclimb: SELECTOR } }, null, 2)}\n`;
		try {
			writeFileSync(path, original, "utf8");
			mkdirSync(backupPath);
			const result = backupPstackConfigThenSave({
				originalBytes: original,
				config: {
					version: 2,
					roles: { hillclimb: SELECTOR_B },
					skillsEnabled: true,
				},
				path,
			});
			assert.equal(result.ok, false);
			assert.equal(readFileSync(path, "utf8"), original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
