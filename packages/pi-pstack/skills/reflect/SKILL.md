---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, prefer `$PI_SESSION_FILE` for the current conversation. Otherwise use `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each slash replaced by a hyphen. Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. Confirm the opening user prompt in a candidate's first user message. If no transcript matches, pass a tight digest instead.

## 2. Spawn three reviewers in parallel

Launch three fresh `pi_worker` reviewers without waiting between launches, one per lens using the table below. Allow read/search and the specific research/MCP tools needed to check transcript references, but not file-writing tools. Pi tool allowlists do not inherently strip MCP access. Record their BB thread IDs.

Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | `reflect judgment reviewer` (default inherit-parent) | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling reviewer` (default inherit-parent) | `references/tooling-reviewer.md` |
| Divergent | `reflect divergent reviewer` (default inherit-parent) | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting this run's transcript path or bounded digest where marked. Each reviewer returns findings in its BB conversation. Retrieve full reports after completion; parent notices may be abbreviated.

## 3. Synthesize

After all reviewers finish, retrieve their full BB reports and launch a fresh `pi_worker` using `reflect synthesizer`. Allow read/search and the research tools needed to spot-check citations. Use `references/synthesizer.md` verbatim with each full review inlined. It returns Accepted / Rejected / Backlog lists. The coordinator checks the synthesis against the evidence.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to `playbooks/authoring-a-skill.md` skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `playbooks/authoring-a-skill.md` and run its description-optimization loop.
- `new skill via authoring-a-skill: <kebab-name>`: hand creation to `playbooks/authoring-a-skill.md`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
