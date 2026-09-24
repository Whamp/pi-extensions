/** Converts an external failure into an Error without assuming its runtime type. */
export function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** Returns a stable message for an external failure. */
export function errorMessage(cause: unknown): string {
  return normalizeError(cause).message;
}

/** Checks a Node-style error code without asserting an unchecked error type. */
export function hasErrorCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}
