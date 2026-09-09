import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { configPath, legacyMarkdownPath } from "./config.ts";
import {
	decodePstackConfigText,
	decodePstackLegacyMarkdownText,
	defaultPstackRoleConfig,
	pstackConfigDiagnostic,
	type PstackConfigReadResult,
	type PstackConfigWriteResult,
} from "./pstack-role-config.ts";
import { PSTACK_ROLES, isPstackRoleName, type PstackRoleConfig } from "./pstack-roles.ts";

const MAX_CONFIG_BYTES = 100_000;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function readFailure(path: string): PstackConfigReadResult {
	return {
		config: defaultPstackRoleConfig(),
		source: "invalid",
		diagnostics: [
			pstackConfigDiagnostic("config-read-failed", "error", `Failed to read ${path}. Using default inherited roles.`),
		],
	};
}

function notRegularFile(path: string): PstackConfigReadResult {
	return {
		config: defaultPstackRoleConfig(),
		source: "invalid",
		diagnostics: [
			pstackConfigDiagnostic("not-regular-file", "error", `${path} is not a regular file. Using default inherited roles.`),
		],
	};
}

function tooLarge(path: string): PstackConfigReadResult {
	return {
		config: defaultPstackRoleConfig(),
		source: "invalid",
		diagnostics: [
			pstackConfigDiagnostic(
				"config-too-large",
				"error",
				`${path} exceeds ${MAX_CONFIG_BYTES} bytes. Using default inherited roles.`,
			),
		],
	};
}

function loadMarkdownOrMissing(jsonPath: string, markdownPath: string): PstackConfigReadResult {
	let st: ReturnType<typeof lstatSync>;
	try {
		st = lstatSync(markdownPath);
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") {
			return { config: defaultPstackRoleConfig(), source: "missing", diagnostics: [] };
		}
		return readFailure(markdownPath);
	}
	if (!st.isFile()) return notRegularFile(markdownPath);
	if (st.size > MAX_CONFIG_BYTES) return tooLarge(markdownPath);
	let text: string;
	try {
		text = readFileSync(markdownPath, "utf8");
	} catch {
		return readFailure(markdownPath);
	}
	if (text.length > MAX_CONFIG_BYTES) return tooLarge(markdownPath);
	const migrated = decodePstackLegacyMarkdownText(text, markdownPath);
	return { ...migrated, source: "markdown" };
}

function readPstackRoleConfigFile(path: string, markdownPath: string): PstackConfigReadResult {
	let st: ReturnType<typeof lstatSync>;
	try {
		st = lstatSync(path);
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return loadMarkdownOrMissing(path, markdownPath);
		return readFailure(path);
	}
	if (!st.isFile()) return notRegularFile(path);
	if (st.size > MAX_CONFIG_BYTES) return tooLarge(path);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return readFailure(path);
	}
	if (text.length > MAX_CONFIG_BYTES) return tooLarge(path);
	return decodePstackConfigText(text, path);
}

/** Load pstack role config. Missing files are silent inherit-all. Never throws or rewrites on read. */
export function loadPstackRoleConfig(
	path: string = configPath(),
	markdownPath: string = legacyMarkdownPath(),
): PstackConfigReadResult {
	try {
		return readPstackRoleConfigFile(path, markdownPath);
	} catch {
		return readFailure(path);
	}
}

function serializePstackRoleConfig(config: PstackRoleConfig): string {
	const roles: Record<string, string | readonly string[]> = {};
	for (const name of Object.keys(PSTACK_ROLES).filter(isPstackRoleName)) {
		const value = config.roles[name];
		if (value === undefined || value === "inherit-parent") continue;
		roles[name] = value;
	}
	return `${JSON.stringify({ version: 2, roles, skillsEnabled: config.skillsEnabled }, null, 2)}\n`;
}

function writeAtomicUtf8File(path: string, body: string): { ok: true } | { ok: false; message: string } {
	const dir = dirname(path);
	const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		try {
			const st = lstatSync(path);
			if (!st.isFile()) return { ok: false, message: `${path} is not a regular file.` };
		} catch (error) {
			if (!(isErrnoException(error) && error.code === "ENOENT")) {
				return { ok: false, message: `Failed to write ${path}.` };
			}
		}
		writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
		renameSync(tmp, path);
		return { ok: true };
	} catch {
		try {
			if (existsSync(tmp)) unlinkSync(tmp);
		} catch {
			// best-effort temp cleanup
		}
		return { ok: false, message: `Failed to write ${path}.` };
	}
}

/** Save a normalized v2 config with 0600 atomic replace. */
export function savePstackRoleConfig(
	config: PstackRoleConfig,
	path: string = configPath(),
): PstackConfigWriteResult {
	const written = writeAtomicUtf8File(path, serializePstackRoleConfig(config));
	if (written.ok) return { ok: true, path };
	return {
		ok: false,
		diagnostics: [pstackConfigDiagnostic("config-write-failed", "error", written.message)],
	};
}

/** Exclusive 0600 backup of verified source bytes, then atomic v2 save. */
export function backupPstackConfigThenSave(input: {
	originalBytes: string;
	config: PstackRoleConfig;
	path: string;
	sourcePath?: string;
	backupPath?: string;
}): PstackConfigWriteResult {
	const sourcePath = input.sourcePath ?? input.path;
	const backupPath = input.backupPath ?? `${sourcePath}.bak`;
	let currentBytes: string;
	try {
		const st = lstatSync(sourcePath);
		if (!st.isFile()) {
			return {
				ok: false,
				diagnostics: [pstackConfigDiagnostic("not-regular-file", "error", `${sourcePath} is not a regular file.`)],
			};
		}
		currentBytes = readFileSync(sourcePath, "utf8");
	} catch {
		return {
			ok: false,
			diagnostics: [
				pstackConfigDiagnostic(
					"config-write-failed",
					"error",
					`Failed to verify ${sourcePath}. Left ${input.path} unchanged.`,
				),
			],
		};
	}
	if (currentBytes !== input.originalBytes) {
		return {
			ok: false,
			diagnostics: [
				pstackConfigDiagnostic(
					"config-changed",
					"error",
					`${sourcePath} changed after it was loaded. Reload before saving.`,
				),
			],
		};
	}

	try {
		writeFileSync(backupPath, currentBytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
	} catch {
		return {
			ok: false,
			diagnostics: [
				pstackConfigDiagnostic(
					"config-write-failed",
					"error",
					`Failed to create exclusive backup ${backupPath}. Left ${input.path} unchanged.`,
				),
			],
		};
	}

	const saved = savePstackRoleConfig(input.config, input.path);
	if (!saved.ok) return saved;
	return { ok: true, path: input.path, backupPath };
}
