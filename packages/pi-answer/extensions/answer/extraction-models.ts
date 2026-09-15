import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const FAST_EXTRACTION_MODELS = [
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
  { provider: "openai-codex", id: "gpt-5.4" },
  { provider: "openai-codex", id: "gpt-5.3-codex" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
] as const;

/** Returns authenticated fast question extraction models followed by the current model as fallback. */
export async function selectExtractionModels(
  currentModel: Model<Api>,
  modelRegistry: ModelRegistry,
): Promise<Model<Api>[]> {
  const models: Model<Api>[] = [];

  for (const candidate of FAST_EXTRACTION_MODELS) {
    const model = modelRegistry.find(candidate.provider, candidate.id);
    if (!model) continue;

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok) models.push(model);
  }

  if (
    !models.some(
      (model) => model.provider === currentModel.provider && model.id === currentModel.id,
    )
  ) {
    models.push(currentModel);
  }

  return models;
}
