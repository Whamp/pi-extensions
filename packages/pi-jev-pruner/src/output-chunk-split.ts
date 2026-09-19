/** One contiguous run of output lines that Jev scores as a unit. */
export interface OutputChunk {
	/** Question id used for this chunk, stable within one prune run. */
	id: string;
	/** Verbatim chunk text, which is what a kept chunk contributes to the final output. */
	text: string;
	/** Number of output lines the chunk covers, counted after long-line splitting. */
	lineCount: number;
	/** Characters in `text`, used for reporting and markers. */
	charCount: number;
}

const MAX_LINE_CHARS = 2_000;

/** Splits over-long lines so a single line cannot become an untrimmable chunk. */
function splitLongLines(output: string): readonly string[] {
	const lines: string[] = [];
	for (const line of output.split("\n")) {
		if (line.length <= MAX_LINE_CHARS) {
			lines.push(line);
			continue;
		}
		for (let at = 0; at < line.length; at += MAX_LINE_CHARS) {
			lines.push(line.slice(at, at + MAX_LINE_CHARS));
		}
	}
	return lines;
}

/**
 * Splits output into chunks of `chunkLines` lines, widening the chunks when the cap would be hit.
 *
 * Widening instead of dropping keeps every line under consideration: a cap that silently ignored
 * the tail would make the pruner look like it had scored the whole output when it had not.
 */
export function splitOutputIntoChunks(
	output: string,
	chunkLines: number,
	maxChunks: number,
): readonly OutputChunk[] {
	const lines = splitLongLines(output);
	const perChunk = Math.max(chunkLines, Math.ceil(lines.length / Math.max(1, maxChunks)));
	const chunks: OutputChunk[] = [];
	for (let start = 0; start < lines.length; start += perChunk) {
		const text = lines.slice(start, start + perChunk).join("\n");
		chunks.push({
			id: `c${chunks.length + 1}`,
			text,
			lineCount: Math.min(perChunk, lines.length - start),
			charCount: text.length,
		});
	}
	return chunks;
}
