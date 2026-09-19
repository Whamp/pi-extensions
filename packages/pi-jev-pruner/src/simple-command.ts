/**
 * Normalizes a shell command for pattern matching, or returns "" when it is not a simple invocation.
 *
 * Leading environment assignments are removed, and a path to the executable is reduced to its name
 * (`/usr/bin/npm test` becomes `npm test`). A command containing shell operators, substitutions, or
 * redirections returns "" so callers fall back to general handling rather than misreading a
 * compound command. This is a heuristic, not a shell parser.
 */
export function simpleCommand(command: string): string {
	if (/[\r\n|;&<>`$\\]/.test(command)) {
		return "";
	}
	return command
		.trim()
		.replace(/^(?:[A-Za-z_]\w*=(?:[^\s'"]+|'[^']*'|"[^"]*")\s+)*/, "")
		.replace(/^(?:\/?[\w.-]+\/)+/, "");
}
