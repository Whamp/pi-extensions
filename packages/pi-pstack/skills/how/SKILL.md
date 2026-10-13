---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 distinct exploration angles. Launch a fresh `pi_worker` per angle using `how explorers` and tools `read`, `grep`, `find`, and `ls`. Each gets `references/explorer-prompt.md` with its angle filled in. Launch all ready explorers without waiting for one to finish. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Launch one fresh `pi_worker` using `how explainer` and tools `read`, `grep`, `find`, and `ls`. Build its task from `references/explainer-prompt.md` without the explorer findings. Wait for its BB completion report, then go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers finish, retrieve each full report by BB thread ID. Launch a fresh `pi_worker` using `how synthesizer` and tools `read`, `grep`, `find`, and `ls`. Give it `references/explainer-prompt.md` with every explorer finding filled in.

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
