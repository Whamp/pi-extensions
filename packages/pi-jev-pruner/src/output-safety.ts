import { simpleCommand } from "./simple-command.ts";

/**
 * Why an output was left exactly as the bash tool produced it.
 *
 * `empty` means there is nothing to prune, `binary` means the bytes are not text worth chunking,
 * `structured` means the caller is likely to parse the output as one document, and `secret` means
 * the command or its output looks credential-like.
 */
export interface OutputSkipDecision {
	/** Reason the output must not be pruned or archived. */
	reason: "empty" | "binary" | "structured" | "secret";
}

/** Output with NUL bytes or a high share of control bytes is not text worth chunking. */
function looksBinary(output: string): boolean {
	const sample = output.slice(0, 4_000);
	if (sample.includes("\u0000")) {
		return true;
	}
	let control = 0;
	for (const char of sample) {
		const code = char.charCodeAt(0);
		if (code < 9 || (code > 13 && code < 32) || code === 127) {
			control += 1;
		}
	}
	return control > sample.length * 0.05;
}

/**
 * Output the agent is likely to parse as one document — a file dump, a diff, a JSON blob.
 *
 * Cutting a hole in it leaves something that still looks complete but is not, so it is left alone.
 */
function looksStructuredOutput(command: string, output: string): boolean {
	const head = output.trimStart();
	if (head.startsWith("{") || head.startsWith("[")) {
		try {
			JSON.parse(output);
			return true;
		} catch {
			// Not valid JSON after all, so it is ordinary output.
		}
	}
	if (head.startsWith("<?xml") || head.startsWith("<!DOCTYPE") || head.startsWith("---\n")) {
		return true;
	}
	if (/^diff --git |^--- |^@@ /m.test(output)) {
		return true;
	}
	const WHOLE_DOCUMENT = /^(cat|bat|jq|yq|diff|git\s+(diff|show)|base64|openssl)(?:\s|$)/;
	if (WHOLE_DOCUMENT.test(simpleCommand(command))) {
		return true;
	}
	return /(^|[|;&]\s*)(cat|bat|jq|yq|git\s+(diff|show)|base64|openssl)\b/.test(command);
}

const SECRET_COMMAND =
	/(^|[|;&]\s*)(printenv|env)\b|\.env\b|\b(secret|secrets|credential|credentials|password|token|keychain|netrc|id_rsa|private[_-]?key)\b/i;
const SECRET_OUTPUT =
	/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(aws_secret_access_key|api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*\S|:\/\/[^\s:@/]+:[^\s:@/]+@/i;

/**
 * Detects credential-like commands and output.
 *
 * A match cancels the prune before any request is made or any file is written, so such output is
 * neither scored by Jev nor archived. It is not redacted; pi's result is left exactly as it was.
 */
function looksSecret(command: string, output: string): boolean {
	return SECRET_COMMAND.test(command) || SECRET_OUTPUT.test(output);
}

/**
 * Decides whether an output must be left untouched, one reason at a time, in priority order.
 *
 * Returns `undefined` when the output is a fair candidate for pruning. Callers treat every reason
 * as a hard skip, never as a hint.
 */
export function findOutputSkipReason(
	command: string,
	output: string,
): OutputSkipDecision | undefined {
	if (output.trim().length === 0) {
		return { reason: "empty" };
	}
	if (looksBinary(output)) {
		return { reason: "binary" };
	}
	if (looksStructuredOutput(command, output)) {
		return { reason: "structured" };
	}
	if (looksSecret(command, output)) {
		return { reason: "secret" };
	}
	return undefined;
}
