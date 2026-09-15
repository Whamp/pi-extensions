import { parseJsonWithRepair } from "@earendil-works/pi-ai";

/** A user-facing question with optional choices/context and the agent's immediately associated recommendation. */
export interface ExtractedQuestion {
  question: string;
  context?: string;
  recommendation?: string;
}

/** Structured output returned by the question extraction model. */
export interface ExtractionResult {
  questions: ExtractedQuestion[];
}

/** Instructs the extraction model to preserve questions, choices, and immediately associated recommendations. */
export const QUESTION_EXTRACTION_SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering and any immediate recommendation the agent gives for each question.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question",
      "recommendation": "Optional recommendation immediately associated with this question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If the agent gives a recommendation immediately after a question, preserve that recommendation and its supporting rationale in the recommendation field
- Associate a recommendation only with the question it immediately follows or explicitly references; stop before the next question
- Do not infer or invent a recommendation when none is present
- Recommendation markers can include symbols such as "➡️" or phrases such as "I recommend", "Choose", or "Keep"
- If no questions are found, return {"questions": []}
- IMPORTANT: When a question has multiple choice options (a, b, c or 1, 2, 3), preserve them EXACTLY in the context field using the format "(a) Option one, (b) Option two, (c) Option three"

Example output:
{
  "questions": [
    {
      "question": "Should the module own one Round or the entire benchmark result file?",
      "context": "(1) One Round and nested Turns, (2) Entire benchmark result file",
      "recommendation": "Choose 1. Keep run orchestration outside."
    },
    {
      "question": "What port should the server run on?"
    }
  ]
}`;

/** Parses repaired structured question JSON while preserving optional recommendations. */
export function parseExtractionResult(text: string): ExtractionResult | null {
  const candidates: string[] = [];
  const fencedJson = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedJson) candidates.push(fencedJson[1].trim());

  const trimmed = text.trim();
  candidates.push(trimmed);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidateText of candidates) {
    try {
      const parsed = parseJsonWithRepair<unknown>(candidateText);
      if (!isRecord(parsed) || !Array.isArray(parsed.questions)) continue;

      const questions: ExtractedQuestion[] = [];
      let valid = true;
      for (const candidate of parsed.questions) {
        if (!isRecord(candidate) || typeof candidate.question !== "string") {
          valid = false;
          break;
        }
        if (candidate.context !== undefined && candidate.context !== null && typeof candidate.context !== "string") {
          valid = false;
          break;
        }
        if (
          candidate.recommendation !== undefined &&
          candidate.recommendation !== null &&
          typeof candidate.recommendation !== "string"
        ) {
          valid = false;
          break;
        }
        questions.push({
          question: candidate.question,
          ...(typeof candidate.context === "string" && candidate.context ? { context: candidate.context } : {}),
          ...(typeof candidate.recommendation === "string" && candidate.recommendation
            ? { recommendation: candidate.recommendation }
            : {}),
        });
      }
      if (valid) return { questions };
    } catch {
      // Try the next JSON candidate.
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
