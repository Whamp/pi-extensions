import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QUESTION_EXTRACTION_SYSTEM_PROMPT, parseExtractionResult } from "./question-extraction.ts";

describe("question extraction recommendations", () => {
  it("preserves an immediate agent recommendation with its question", () => {
    const extraction = parseExtractionResult(`
\`\`\`json
{
  "questions": [
    {
      "question": "Should the new module own one Round or the entire benchmark result file?",
      "context": "(1) One Round and nested Turns, (2) Entire benchmark result file",
      "recommendation": "Choose 1. Keep run orchestration outside."
    }
  ]
}
\`\`\`
`);

    assert.deepEqual(extraction, {
      questions: [
        {
          question: "Should the new module own one Round or the entire benchmark result file?",
          context: "(1) One Round and nested Turns, (2) Entire benchmark result file",
          recommendation: "Choose 1. Keep run orchestration outside.",
        },
      ],
    });
  });

  it("repairs JSON wrapped in model commentary", () => {
    const extraction = parseExtractionResult(`Here is the result:
{
  "questions": [
    {
      "question": "Which database?",
      "recommendation": "Choose PostgreSQL."
    }
  ]
}
That is all.`);

    assert.deepEqual(extraction, {
      questions: [
        {
          question: "Which database?",
          recommendation: "Choose PostgreSQL.",
        },
      ],
    });
  });

  it("instructs the extractor to associate only the immediate recommendation", () => {
    assert.match(QUESTION_EXTRACTION_SYSTEM_PROMPT, /immediate recommendation/i);
    assert.match(QUESTION_EXTRACTION_SYSTEM_PROMPT, /recommendation/);
  });
});
