---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Launch the explorers and dependent explainer with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N + 1, workflowScript } })` call. In `workflowScript`, await `runs.all([{ key: "explore-<angle>", agent: "worker", task, model }])`, then return `runs.run("explain", { agent: "worker", task, model })` with the explorer outputs.

Each explorer uses:
- agent: "worker"
- `model`: `how explorers` (default inherit-parent)
- `task`: the prompt in `references/explorer-prompt.md` with its angle filled in and an instruction to inspect only

Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Launch one standalone child with `subagent({ action: "execute", input: { agent: "worker", task, model, async: false } })` using:
- agent: "worker"
- `model`: `how explainer` (default inherit-parent)
- `task`: `references/explainer-prompt.md` without the explorer-findings section and with an instruction to inspect only

Go to Step 4.

## Step 3. Synthesize (complex questions only)

The same workflow launches `explain` after every explorer settles using:
- agent: "worker"
- `model`: `how synthesizer` (default inherit-parent)
- `task`: `references/explainer-prompt.md` with every explorer result filled in and an instruction to inspect only

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
