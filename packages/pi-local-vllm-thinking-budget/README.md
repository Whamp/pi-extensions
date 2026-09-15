# @zenspc/pi-local-vllm-thinking-budget

Sets a per-request `thinking_token_budget` for local vLLM reasoning models. The extension maps Pi's current thinking level to the `thinkingBudgets` configured on the selected model.

## Usage

Add the package to Pi's `packages` setting, then configure a local-vLLM model with `thinkingBudgets` in `models.json`. Pi sends the selected budget in the provider payload when reasoning and thinking are enabled.

Set `PI_BUDGET_DEBUG=1` to log the resolved model, thinking level, and budget to stderr.

The extension leaves `preserve_thinking` to Pi's native `qwen-chat-template` handling. It also skips budget injection when thinking is off.
