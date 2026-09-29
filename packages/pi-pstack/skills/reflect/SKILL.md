---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. Prefer `$PI_SESSION_FILE` for the current session. Workspace transcripts live at `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-". Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That crosses workspace boundaries and reads private chats from unrelated projects.

```bash
ls -t ~/.pi/agent/sessions/--<slug>--/*.jsonl 2>/dev/null | head -10
```

Each file is JSONL. Confirm a candidate by finding the conversation's opening user prompt in its first user message. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead.

### 2. Spawn three reviewers in parallel

The parent resolves any ticket, chat, document, observability, error-tracker, or analytics references from the transcript before launch. Put the transcript path and fetched evidence in one bounded digest. Children do not inherit the parent's MCP or extension tools.

Launch all three reviewers and the dependent synthesizer with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: 4, workflowScript } })` call. In `workflowScript`, await the three reviewers with `runs.all([{ key: "judgment-review", ... }, { key: "tooling-review", ... }, { key: "divergent-review", ... }])`, then return `runs.run("synthesize-reviews", { ... })` with their outputs.

Each child names a role in `~/.pi/agent/pstack/models.json`. Use that role's selector. Omit `model` when the value is `inherit-parent` or `auto`. If an explicit selector is unavailable, inspect `subagent({ action: "models", input: {} })`, pick the closest available model (prefer the highest-reasoning tier of the same family), and relaunch. Never treat `inherit-parent` or `auto` as broken selectors.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | `reflect judgment reviewer` (default inherit-parent) | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling reviewer` (default inherit-parent) | `references/tooling-reviewer.md` |
| Divergent | `reflect divergent reviewer` (default inherit-parent) | `references/divergent-reviewer.md` |

Each reviewer item uses `agent: "reviewer"`, its configured model, and a task that says to inspect only. Pass each template verbatim, substituting the transcript path or the bounded digest where marked. Reviewers return findings through their workflow results.

### 3. Synthesize

The workflow's `synthesize-reviews` child uses `agent: "reviewer"`. It runs using `reflect synthesizer` (default inherit-parent). Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns a structured Accepted / Rejected / Backlog list. After the workflow completes, the parent spot-verifies citations with its own MCP and extension tools.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to `playbooks/authoring-a-skill.md` skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `playbooks/authoring-a-skill.md` and run its description-optimization loop.
- `new skill via authoring-a-skill: <kebab-name>`: hand creation to `playbooks/authoring-a-skill.md`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
