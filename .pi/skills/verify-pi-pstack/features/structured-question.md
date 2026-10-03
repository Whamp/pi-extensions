# Structured question

Pstack gives the model a question tool with listed choices, a typed alternative, optional multiple selections and cancellation.

## Sub-features

- `question-single`: select one of 2–6 choices.
- `question-typed`: enter an answer not listed.
- `question-multiple`: accumulate choices and finish.
- `question-cancel`: cancellation is explicit in the returned result.

## How to get to it (user POV)

Answer the ask_user_question menu during a Pi conversation. This is a model-facing tool, not a slash command. Choose a listed answer or the typed-answer entry.

## Driving it with Herdr

Preconditions: isolated Launch, approved scratch-only model/auth route; no other question extension loaded.

- **Single:** prompt Ask me with ask_user_question which scratch evidence format I prefer, with options Terminal transcript and Config snapshot. Observe an actual tool call with those two options; select `1. Terminal transcript` by its visible label. Capture menu, action and returned selection.
- **Typed:** repeat the same prompt, choose `Type a different answer` and enter Both formats. Capture input and tool result containing the typed answer.
- **Multiple:** prompt Ask the same question with allow_multiple true. Choose both listed formats and the displayed Done option. Require both selections and cancelled false in session/tool evidence.
- **Cancel:** repeat and send esc in the first menu. Require a cancellation result, not an invented selection. For multi-select, also cancel after the first choice and confirm the result distinguishes partial selection.
- **Proof:** retain the scratch transcript with tool arguments and returned structured result as well as screens. A model paraphrase alone is insufficient.

## Gotchas

- Ask only a real unresolved preference; do not force an unrelated production question.
- No UI mode must fail explicitly rather than claiming a choice was made.
- The tool always offers a typed alternative; no need to edit its schema for this test.
- Model refusal to call the tool is a blocked entry, not proof obtained through its unit tests.
