import type { JevHttpRequest } from "./jev-client.ts";

/**
 * Sends one System One request and returns the response body.
 *
 * An implementation must reject the promise when the request fails or the response is not OK, so a
 * failed prune is visible to the caller instead of being read as a run of zero probabilities.
 */
export interface JevHttpTransport {
	/** Sends the request and resolves with the raw response body text. */
	send(request: JevHttpRequest): Promise<string>;
}

/** Anything that can judge output relevance; tests replace this seam to run without Jev. */
export interface JevAsker {
	/** Answers one noul question per chunk, keyed by chunk id. */
	askChunkRelevance(
		request: JevHttpRequest,
		expectedQuestionIds: readonly string[],
	): Promise<ReadonlyMap<string, number>>;
}
