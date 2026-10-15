---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /skill:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use `arena runners` from `~/.pi/agent/pstack/models.json` when present. Otherwise use two inherit-parent candidates. Preserve configured cardinality and diversity. Spawn more runners for distinct design directions, or the same model N times for generation-bound work. Resolve effort through Poteto Mode's Subagents section. If an explicit model selector is unavailable, inspect `bb provider models pi` on the execution host and use only the recovery route permitted by `model-routing`. Do not select a family sibling or substitute an unrestricted worker. An `auto` or `inherit-parent` entry copies the resolved parent model and reasoning.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Launch N fresh `pi_worker` candidates without waiting between launches. Each gets its `arena runners` model, task, shared grounding path, and its own isolated workspace and output path. Give the tools required to create and verify its artifact. Require a short rationale naming the alternatives it considered and what it rejected. Record every BB thread ID.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates finish, select one model from `arena judge pool` in `~/.pi/agent/pstack/models.json` when configured. Otherwise inherit the resolved parent Pi model. Prefer a different family within permitted model policy. Launch a fresh `pi_worker` judge with tools `read`, `grep`, `find`, and `ls`. It reads the rubric and completed candidate paths, scores every criterion, and recommends a base. Read the artifacts in BB while it runs. Never launch the judge while candidates are writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
