# Answer

Extracts questions and their immediately associated agent recommendations from the last assistant message, then presents them in an interactive TUI for answering.

## How It Works

1. Grabs the last assistant message from the session
2. Sends it to the first authenticated fast Codex or Haiku model, then falls back to the current model, to extract questions as repaired structured JSON
3. Associates an immediate recommendation—such as a following `➡️` block—with its question
4. Opens a TUI with the question, choices/context, recommendation, and a text editor for the user's answer
5. Submits the questions, recommendations, and answers back into the conversation as a single user message, triggering a new turn

Recommendations remain context; they do not prefill or replace the user's answer. Multi-choice options (e.g. `(a) MySQL, (b) PostgreSQL`) are detected and formatted on separate lines.

## Usage

- **`/answer`** — slash command
- **`Ctrl+.`** — keyboard shortcut

## TUI Controls

| Key | Action |
|-----|--------|
| `Tab` / `Enter` | Next question |
| `Shift+Tab` | Previous question |
| `Shift+Enter` | Newline in answer |
| `Esc` | Cancel |
