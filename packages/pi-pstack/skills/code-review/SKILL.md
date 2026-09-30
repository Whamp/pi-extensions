---
name: code-review
description: "Review a PR, diff, branch, or changes since a fixed point. Audit is the default. Use Challenge only for an explicit adversarial or design review request. Route PR-status requests to Babysit."
---

# Code review

Use this coordinator for code reviews. Keep Audit and Challenge separate. The [Audit procedure](references/code-review-audit.md) defines evidence preparation, reviewer coverage, and the report.

## Route the request

- Use Audit for an ordinary or bare request to review a PR, diff, branch, or changes since a point.
- Use Challenge only when the user explicitly asks for adversarial review or design interrogation. The feature, bug-fix, architect, and PR-opening playbooks can also require Challenge.
- Run Audit and Challenge when the user explicitly asks for both. Keep their reviewer contexts independent. Audit children do not receive Challenge results. Challenge children do not receive Audit findings.
- Route PR-status requests, including "check on PR X," to the [Babysit playbook](../poteto-mode/playbooks/babysit.md), not Audit.
- Opening a PR alone does not start Babysit. The PR-opening playbook still requires Challenge.

Ask for a missing Audit base instead of guessing. A named PR supplies immutable base and head commits. Challenge can use pinned design contents without a Git base.

## Freeze evidence before launching reviewers

The parent owns preparation and synthesis. Before launching any reviewers, freeze the review intent, exact scope, pinned artifact, relevant spec and standards, completed tool evidence, and limitations. Give each child that same evidence packet. Children inspect only. They do not run Git or shell commands, edit files, write files, or use MCP or extension tools.

For Audit, if the spec source is missing and the user has not said that no spec exists, ask for the source before launching Audit reviewers. Challenge needs a clear intent and pinned artifact, not an originating Audit spec. If the user explicitly says no spec is available, record Spec as `SKIPPED (no spec available)`. Do not call it a pass.

## Run Audit

Use the shared ordered model lineup from the caller's `model-routing`, spending, and family policy. Each selected model gets one fresh Standards reviewer and one fresh Spec reviewer. These are separate children. Do not combine the axes or choose separate model lineups for them.

Use the read-only `reviewer` agent with fresh context through `pi-subagents`. Never substitute a write-capable worker for a reviewer. Follow the [Audit procedure](references/code-review-audit.md). It blocks missing required sources, model families, axes, or reviewer results. Never turn a failed, missing, or partial check into a pass.

## Run Challenge

Load the existing [Interrogate skill](../interrogate/SKILL.md). Skip its steps 1 and 2 for a coordinator-delegated Challenge. Start at step 3 with the frozen artifact, scope, and intent verbatim. Do not run Git, rediscover the artifact, or derive intent from the implementation. Keep its reviewer rubric and synthesis. Do not create another Challenge rubric or reviewer roster. Direct `/skill:interrogate` use remains compatible.

Do not trigger Challenge based on risk. A completed Audit never satisfies a required Challenge. Reuse prior coverage only when the pinned artifact, intent, rubric, required axes and families, and parent disposition all match.

## Report the review

Record the requested and actual model selectors. State any substitution, covered families, missing coverage, child failures, findings, unresolved questions, and the parent's disposition for each finding. Keep Standards, Spec, and Challenge results separate. Do not create a separate review registry or apply fixes automatically.

This coordinator adapts Matt Pocock's MIT-licensed `code-review` skill. See [the retained MIT notice](LICENSE).
