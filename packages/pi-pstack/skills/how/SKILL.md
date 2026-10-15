---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Launch one fresh `pi_worker` using `how explainer` and tools `read`, `grep`, `find`, and `ls`. It explores and explains in one pass using `references/explainer-prompt.md` without the explorer findings. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 distinct exploration angles. Launch a fresh `pi_worker` per angle using `how explorers` and tools `read`, `grep`, `find`, and `ls`. Each gets `references/explorer-prompt.md` with its angle filled in. Launch all ready explorers without waiting for one to finish.

## 3. Synthesize (complex only)

Once all explorers finish, retrieve each full BB report. Launch a fresh `pi_worker` using `how synthesizer` and tools `read`, `grep`, `find`, and `ls`. Give it `references/explainer-prompt.md` with every explorer finding filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
