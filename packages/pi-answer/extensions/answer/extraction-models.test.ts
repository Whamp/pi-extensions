import assert from "node:assert/strict";
import test from "node:test";

import { selectExtractionModels } from "./extraction-models.ts";

test("question extraction tries each authenticated fast model before the current model", async () => {
  const currentModel = { provider: "openai-codex", id: "gpt-6-astra" };
  const available = new Map([
    ["openai-codex/gpt-5.4", { provider: "openai-codex", id: "gpt-5.4" }],
    ["anthropic/claude-haiku-4-5", { provider: "anthropic", id: "claude-haiku-4-5" }],
  ]);
  const modelRegistry = {
    find: (provider: string, id: string) => available.get(`${provider}/${id}`),
    getApiKeyAndHeaders: async (model: { id: string }) => ({
      ok: model.id !== "claude-haiku-4-5",
    }),
  };

  const models = await selectExtractionModels(currentModel as never, modelRegistry as never);

  assert.deepEqual(
    models.map((model) => `${model.provider}/${model.id}`),
    ["openai-codex/gpt-5.4", "openai-codex/gpt-6-astra"],
  );
});
