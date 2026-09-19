import type { OutputChunkPrompt, OutputRelevanceState } from "./output-relevance-state.ts";

/** TypeSafe's System One endpoint, which answers every Jev request. */
export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";

/** Jev model used unless the configuration names another one. */
export const DEFAULT_JEV_MODEL = "jev-latest";

/** One question Jev answers, identified by the chunk it is about. */
export interface NoulQuestion {
	/** Chunk id this question decides. */
	id: string;
	/** What to judge, including what counts as a needed line. */
	instructions: string;
}

/** An HTTP request to the System One endpoint, ready to send. */
export interface JevHttpRequest {
	url: string;
	method: "POST";
	headers: Readonly<Record<string, string>>;
	body: string;
}

const TRUE_CRITERIA =
	"At least one line contains an error, warning, summary, final result, or a value needed by a standing requirement. One needed line is sufficient even when all other lines are noise. Separate reply-format instructions do not cancel retention requirements.";
const FALSE_CRITERIA =
	"Every line is disposable progress, repetitive boilerplate, or irrelevant noise. Removing the entire chunk loses no result and no information the task depends on.";

/** Builds the relevance question for one chunk. */
export function noulQuestionForChunk(chunk: OutputChunkPrompt): NoulQuestion {
	return {
		id: chunk.id,
		instructions: `Chunk ${chunk.id} contains at least one line that should remain available to the agent for its ongoing task. Evaluate every line against instructions and decisions anywhere in the state, not only what the next reply should say.`,
	};
}

/** Builds the System One request that asks one noul question per chunk. */
export function buildNoulRequest(
	model: string,
	state: OutputRelevanceState,
	questions: readonly NoulQuestion[],
	apiKey: string | undefined,
): JevHttpRequest {
	const payload = {
		model,
		state,
		questions: Object.fromEntries(
			questions.map((question) => [
				question.id,
				{
					type: "noul" as const,
					instructions: question.instructions,
					criteria: { true: TRUE_CRITERIA, false: FALSE_CRITERIA },
				},
			]),
		),
	};
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (apiKey !== undefined) {
		headers.authorization = `Bearer ${apiKey}`;
	}
	return {
		url: SYSTEM_ONE_URL,
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	};
}

function isJsonPropertyBag(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the noul probability of every answered question from a System One response body.
 *
 * This is the I/O boundary: everything here comes from the network, so the checks below are the
 * validation that lets the rest of the extension treat a probability as a trusted number. A
 * malformed body throws rather than returning a partial map.
 */
export function parseNoulProbabilities(bodyText: string): ReadonlyMap<string, number> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	} catch (error) {
		throw new Error("Jev response body is not JSON", { cause: error });
	}
	if (!isJsonPropertyBag(parsed) || !isJsonPropertyBag(parsed.answers)) {
		throw new Error("Jev response is missing an answers object");
	}
	const probabilities = new Map<string, number>();
	for (const [id, answer] of Object.entries(parsed.answers)) {
		if (!isJsonPropertyBag(answer)) {
			throw new Error(`Jev answer for ${id} is not an object`);
		}
		const noul = answer.noul;
		if (typeof noul !== "number" || !Number.isFinite(noul)) {
			throw new Error(`Jev answer for ${id} has no noul probability`);
		}
		probabilities.set(id, noul);
	}
	return probabilities;
}
