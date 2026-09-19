// local-vllm-thinking-budget.ts
//
// Enforces a hard per-request thinking_token_budget on local vLLM reasoning models,
// mapping pi's thinking level (minimal/low/medium/high/xhigh) to the per-model
// thinkingBudgets configured in models.json. vLLM enforces this server-side by
// force-injecting </think> once the budget is exceeded (ThinkingBudgetStateHolder in
// vllm/v1/sample). Without it, enable_thinking=true runs uncapped and the model spends
// ~all of its output budget on <think>, emitting an empty answer.
//
// Why an extension and not pi 0.84's native thinking_token_budget? Native support reads
// the GLOBAL settings.thinkingBudgets (not per-model), clamps xhigh -> high, and needs an
// opt-in compat.supportsThinkingTokenBudget flag on each model. This extension reads the
// per-MODEL thinkingBudgets from models.json and honors a distinct xhigh budget, so each
// model can differ. To use native instead, set supportsThinkingTokenBudget and move the
// budgets into global settings (losing per-model + distinct xhigh).
//
// preserve_thinking is intentionally NOT injected here: pi's "qwen-chat-template"
// thinkingFormat already injects chat_template_kwargs.preserve_thinking=true for every
// reasoning model, so that is handled natively.
//
// Notes:
// - getThinkingLevel() lives on the ExtensionAPI (pi), not on the event ctx.
// - "off" is represented as chat_template_kwargs.enable_thinking === false, which we gate
//   on (no budget when thinking is off).
// - xhigh requires thinkingLevelMap: { "xhigh": "xhigh" } on the model in models.json,
//   otherwise pi clamps xhigh down to high (getSupportedThinkingLevels in pi-ai/models.js).
// - Set PI_BUDGET_DEBUG=1 to log the resolved payload to stderr.
export default function (pi) {
	pi.on("before_provider_request", (event, ctx) => {
		if (!ctx.model || ctx.model.provider !== "local-vllm") return;
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

		// No budget when thinking is off; enable_thinking is set by the qwen-chat-template
		// thinkingFormat for reasoning models.
		const enableThinking = payload.chat_template_kwargs?.enable_thinking;
		if (!ctx.model.reasoning || !enableThinking) return;

		const budgets = ctx.model.thinkingBudgets;
		if (!budgets || typeof budgets !== "object") return;

		const level = typeof pi.getThinkingLevel === "function" ? pi.getThinkingLevel() : undefined;
		const budget = level ? budgets[level] : undefined;
		if (typeof budget !== "number") return;

		if (process.env.PI_BUDGET_DEBUG) {
			console.error(
				JSON.stringify({
					dbg: "vllm-thinking-budget",
					model: ctx.model.id,
					level: level ?? "off",
					thinking_token_budget: budget,
				}),
			);
		}

		return { ...payload, thinking_token_budget: budget };
	});
}
