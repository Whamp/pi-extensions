const POTETO_PROMPT =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

/** Inject the Poteto reminder and the shipped BB worker reference, including projectless sessions. */
export function systemPromptInjection(potetoMode: boolean, bbReferencePath?: string): string {
	if (!potetoMode) {
		return "";
	}
	if (bbReferencePath === undefined) {
		return POTETO_PROMPT;
	}
	return `${POTETO_PROMPT}\nPstack workers run in fresh, nested BB Pi threads through pi_worker. Read ${bbReferencePath} before delegation. Preserve upstream workflow methods; do not substitute native Pi subagents or Herdr.`;
}
