import { parseNoulProbabilities } from "./jev-client.ts";
import type { JevAsker, JevHttpTransport } from "./jev-asker.ts";

/**
 * Creates the asker that turns a System One request into one probability per expected chunk.
 *
 * Every expected chunk must be answered: a body that omits one is treated as a failure rather than
 * as a zero, because a missing answer would otherwise silently drop output the model still needs.
 */
export function createJevAsker(transport: JevHttpTransport): JevAsker {
	return {
		async askChunkRelevance(request, expectedQuestionIds) {
			const probabilities = parseNoulProbabilities(await transport.send(request));
			for (const id of expectedQuestionIds) {
				if (!probabilities.has(id)) {
					throw new Error(`Jev response is missing an answer for ${id}`);
				}
			}
			return probabilities;
		},
	};
}
