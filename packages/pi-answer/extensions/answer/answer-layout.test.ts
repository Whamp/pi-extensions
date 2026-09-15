import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { padAnswerBoxLine } from "./answer-layout.ts";

describe("padAnswerBoxLine", () => {
  it("leaves the final terminal cell unused to prevent mobile soft wrapping", () => {
    const terminalWidth = 48;
    const renderedLine = padAnswerBoxLine(
      "│ mobile question │",
      terminalWidth,
      (value) => value.length,
    );

    assert.equal(renderedLine.length, terminalWidth - 1);
  });
});
