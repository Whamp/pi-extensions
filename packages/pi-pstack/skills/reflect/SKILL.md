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

Launch three fresh `pi_worker` reviewers without waiting between launches, one per lens using the table below. Allow read/search and the specific research/MCP tools needed to check transcript references, but not file-writing tools. Pi tool allowlists do not inherently strip MCP access. Record their BB thread IDs.

Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | `reflect judgment reviewer` (default inherit-parent) | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling reviewer` (default inherit-parent) | `references/tooling-reviewer.md` |
| Divergent | `reflect divergent reviewer` (default inherit-parent) | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting this run's transcript path or bounded digest where marked. Each reviewer returns findings in its BB conversation. Retrieve full reports after completion; parent notices may be abbreviated.

### 3. Synthesize

After all reviewers finish, launch a fresh `pi_worker` using `reflect synthesizer`. Allow read/search and the research tools needed to spot-check citations. Use `references/synthesizer.md` verbatim with each full review inlined. It returns Accepted / Rejected / Backlog lists. The coordinator checks the synthesis against the evidence.

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
