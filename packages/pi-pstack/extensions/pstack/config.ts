import { homedir } from "node:os";
import { join } from "node:path";

const DANGEROUS_KEY_PARTS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_MODEL_KEY_LENGTH = 256;
const INHERIT_SELECTORS = new Set(["inherit-parent", "auto"]);

/** Resolve the Pi coding-agent directory, expanding PI_CODING_AGENT_DIR and ~. */
export function getAgentDir(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	return envDir ? envDir.replace(/^~(\/|$)/, `${home()}$1`) : join(home(), ".pi", "agent");
}

/** Path to ~/.pi/agent/pstack/models.json. */
export function configPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	return join(getAgentDir(env, home), "pstack", "models.json");
}

/** Path to leftover ~/.pi/agent/pstack-models.md. */
export function legacyMarkdownPath(
	env: NodeJS.ProcessEnv = process.env,
	home: () => string = homedir,
): string {
	return join(getAgentDir(env, home), "pstack-models.md");
}

/** True when value is inherit-parent, auto, or a provider/id selector without dangerous segments. */
export function isSafeModelSelector(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (INHERIT_SELECTORS.has(value)) return true;
	if (!value || value.length > MAX_MODEL_KEY_LENGTH) return false;
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (character === "\\" || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f)
			return false;
	}

	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return false;

	const provider = value.slice(0, slash);
	const id = value.slice(slash + 1);
	if (!provider || !id) return false;

	for (const part of value.split("/")) {
		if (!part || DANGEROUS_KEY_PARTS.has(part)) return false;
	}
	return true;
}
