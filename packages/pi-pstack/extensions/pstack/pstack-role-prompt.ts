const POTETO_PROMPT =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

/** Inject only the Poteto Mode reminder; model-routing resolves roles on demand. */
export function systemPromptInjection(potetoMode: boolean): string {
	return potetoMode ? POTETO_PROMPT : "";
}
