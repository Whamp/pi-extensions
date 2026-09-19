import { archivePathForToolCall } from "./output-archive.ts";
import type { OutputArchiveTarget } from "./output-archive.ts";
import { pruneOutputWithJev } from "./output-pruner.ts";
import type { OutputPruneOptions, OutputPruneOutcome } from "./output-pruner.ts";
import type { JevAsker } from "./jev-asker.ts";
import type { ConversationTurn } from "./session-history.ts";

/** The reads, writes, clock, and Jev seam one prune run needs; tests supply fakes. */
export interface BashOutputPruneDeps {
	/** Reads a UTF-8 file, or returns undefined when it is missing or unreadable. */
	readFileText(path: string): Promise<string | undefined>;
	/** Writes the complete output, creating the archive directory as needed. */
	writeArchive(target: OutputArchiveTarget, text: string): Promise<void>;
	/** Answers relevance questions. */
	asker: JevAsker;
	/** Current time, used to name a new archive file. */
	now(): number;
}

/** One bash tool result offered for pruning. */
export interface BashOutputPruneRequest {
	/** The command whose output is being scored. */
	command: string;
	/** Tool call id, used to name the archive file. */
	toolCallId: string;
	/** Result text as the model would receive it. */
	contentText: string;
	/** Path pi wrote the complete stream to when it truncated the result. */
	fullOutputPath: string | undefined;
	/** Recent conversation turns, oldest first. */
	history: readonly ConversationTurn[];
	/** Project config directory, where a new archive is written, for example `.pi`. */
	projectConfigDir: string;
	/** Tuning for the run. */
	options: OutputPruneOptions;
}

/** The decision for one bash result, plus the replacement text when lines were dropped. */
export interface BashOutputPruneResult {
	/** What happened, also reported by `/jev-pruner`. */
	outcome: OutputPruneOutcome;
	/** Replacement text for the tool result; absent when the result must stay exactly as it is. */
	contentText?: string;
}

async function readCompleteOutput(path: string, deps: BashOutputPruneDeps): Promise<string> {
	const text = await deps.readFileText(path);
	if (text === undefined) {
		throw new Error(`cannot read the complete output pi saved at ${path}`);
	}
	return text;
}

/**
 * Prunes one bash tool result, keeping the complete output recoverable before any line is dropped.
 *
 * pi hands the hook only the tail of a truncated result, so the complete stream is what gets
 * scored; otherwise a pruner would be deciding the fate of a preview. When pi already saved that
 * stream, its file is reused as the archive. When pi did not truncate, the pruner writes its own
 * archive first, because a dropped line with no file behind it is gone for good.
 */
export async function pruneBashOutput(
	request: BashOutputPruneRequest,
	deps: BashOutputPruneDeps,
): Promise<BashOutputPruneResult> {
	const output =
		request.fullOutputPath === undefined
			? request.contentText
			: await readCompleteOutput(request.fullOutputPath, deps);
	const archive: OutputArchiveTarget =
		request.fullOutputPath === undefined
			? {
					path: archivePathForToolCall(request.projectConfigDir, request.toolCallId, deps.now()),
					alreadyWritten: false,
				}
			: { path: request.fullOutputPath, alreadyWritten: true };
	const outcome = await pruneOutputWithJev(
		{ command: request.command, output, history: request.history, archive },
		deps.asker,
		request.options,
	);
	if (outcome.kind === "unpruned") {
		return { outcome };
	}
	if (!archive.alreadyWritten) {
		await deps.writeArchive(archive, output);
	}
	return { outcome, contentText: outcome.output };
}
