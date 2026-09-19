import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Where the complete output of a pruned tool call can be read back. */
export interface OutputArchiveTarget {
	/** Path to quote in the marker, as the agent should use it to read or grep the dropped lines. */
	path: string;
	/** True when pi already wrote the complete output there, so nothing needs to be written. */
	alreadyWritten: boolean;
}

/** Directory pi writes pruned output into, relative to the project root. */
export const OUTPUT_ARCHIVE_DIR_NAME = "jev-pruner";

/** Builds the archive path for one tool call, under the project's config directory. */
export function archivePathForToolCall(
	projectConfigDir: string,
	toolCallId: string,
	timestampMs: number,
): string {
	const safeId = toolCallId.replace(/[^\w-]/g, "").slice(0, 40);
	const name = safeId.length > 0 ? safeId : String(timestampMs);
	return join(projectConfigDir, OUTPUT_ARCHIVE_DIR_NAME, `bash-${name}.txt`);
}

/**
 * Writes the complete output next to a self-ignoring marker file.
 *
 * The marker keeps the archive out of git without touching the repository's own ignore rules, and
 * a failed write is left to the caller: an archive that cannot be written means the dropped lines
 * would be unrecoverable, so the caller must abandon the prune instead of pruning anyway.
 */
export async function writeOutputArchive(target: OutputArchiveTarget, text: string): Promise<void> {
	const directory = dirname(target.path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await writeFile(join(directory, ".gitignore"), "*\n", { mode: 0o600 });
	await writeFile(target.path, text, { mode: 0o600 });
}

/**
 * Describes dropped lines in the pruned output.
 *
 * Every dropped run gets one marker, so the agent always knows how much it did not see and, when
 * an archive exists, where to read it back.
 */
export function outputArchiveMarker(
	droppedLineCount: number,
	target: OutputArchiveTarget | undefined,
): string {
	const lines = `${droppedLineCount} ${droppedLineCount === 1 ? "line" : "lines"}`;
	return target === undefined
		? `[jev-pruner dropped ${lines}; not saved, re-run the command if you need them]`
		: `[jev-pruner dropped ${lines}; full output: ${target.path} (read or grep it if needed)]`;
}
