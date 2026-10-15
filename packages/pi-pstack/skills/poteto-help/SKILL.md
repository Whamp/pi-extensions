---
name: poteto-help
description: Explain Pstack setup, BB Pi workers, skills, playbooks, and recovery. Do not start work for a help-only question.
disable-model-invocation: true
---

# Poteto help

Answer the question, give a usable prompt, and link the actual installed skill or reference with an absolute file path. Do not link an upstream Cursor page as if it described this BB adaptation.

For a help-only question, do not start workers. For a request to do work, read [Poteto Mode](../poteto-mode/SKILL.md) and follow its route.

## Setup and first task

1. Install this Pi package and the standalone Pstack BB plugin. The plugin exposes `pi_worker` and `bb pstack worker`, using BB’s unchanged Pi provider with native startup tool settings.
2. Use `/setup-pstack` in Pi to choose role models, or keep the inherit-parent defaults. Settings live in `~/.pi/agent/pstack/models.json`.
3. In BB, ask the agent to use Poteto Mode with a goal and a checkable outcome. For example: “Use $poteto-mode to fix the failed login. Show the working login and its regression check.”

Poteto Mode is sticky in Pi until `/poteto-mode off`. The `/pstack off` switch hides the model-visible Pstack skill entry; explicit skill loading still works. Neither switch disables role-model lookup.

If a project has no verification harness, explain that gap and offer [Create verification skill](../create-verification-skill/SKILL.md). Do not call compilation proof of working behavior.

## BB workers

Read [BB interaction and workers](../poteto-mode/references/bb-surface.md).

Workers are fresh, visible, nested BB Pi threads. Pi enforces their explicit tool selections. The coordinator decides fanout, dependency order, judging, and retries. There is no Herdr or native-child fallback.

Desktop is the normal host. Server60 and Endurance serve work tied to their local hardware or services. Projectless personal work is valid.

Questions normally go through the coordinator, but the operator can open and talk to any worker. Consequential direct scope changes must reach the coordinator. BB Stop affects the selected thread. Completed workers stay nested during the run, then are archived after results and work are preserved.

## Choose a skill

Recommend Poteto Mode for a complete task. Recommend a specific skill when the operator wants a bounded result. Read that skill before describing its method.

| Need | Skill |
|---|---|
| Explain current code or find an implementation location | [How](../how/SKILL.md) |
| Investigate why code has its current shape | [Why](../why/SKILL.md) |
| Teach a subsystem plainly | [Teach](../teach/SKILL.md) |
| Review a PR, diff, or branch | [Code review](../code-review/SKILL.md), Audit |
| Challenge a design or implementation | [Code review](../code-review/SKILL.md), Challenge |
| Compare independent candidate solutions | [Arena](../arena/SKILL.md) |
| Cover verification slices or run a race | [Swarm](../swarm/SKILL.md) |
| Settle architecture before implementation | [Architect](../architect/SKILL.md) |
| Estimate and verify the effect outside a diff | [Blast radius](../blast-radius/SKILL.md) |
| Test a performance claim | [Benchmark checklist](../benchmark-checklist/SKILL.md) |
| Catch up on prior work | [Recall](../recall/SKILL.md) |
| Catch up on changes since your last message | [Ketchup](../ketchup/SKILL.md) |
| Restate the user's goal before work | [In your own words](../in-your-own-words/SKILL.md) |
| Refine the approach and constraints, then do the task | [Sharpen](../sharpen/SKILL.md) |
| Turn a completed run into proposed lessons | [Reflect](../reflect/SKILL.md) |
| Correct repeated mistakes | [Correct](../correct/SKILL.md) |
| Write or revise technical prose | [Technical writing](../technical-writing/SKILL.md) |
| Restate an answer plainly | [Bro](../bro/SKILL.md) |

For another skill, inspect its frontmatter. Principle skills are indexed in Poteto Mode.

## Playbooks and recovery

Playbooks are task steps inside Poteto Mode, not separate slash commands.

- “Check PR 123” routes to Babysit. It does not grant merge authority.
- “Take over this branch” routes to Session pickup.
- “Plan this multi-PR change” routes to Multi-phase plan.
- A standing multi-day program routes to Orchestrate.
- An authorized implementation-and-landing run routes to Autopilot-full.

Recover existing BB workers before spawning replacements. Read full worker outputs; completion notices can be abbreviated. Do not delete conversations or workspaces as routine cleanup.

Explain consequential choices in chat. Use BB's browser and file viewer for comparison and inspection, and Plannotator for annotations. Add plugins only for demonstrated gaps.

## Upstream

Cursor Pstack is the source of workflow methods. This Pi package translates execution and interaction to BB. Its importer preserves upstream invocation settings, approved performance guidance, and Pi-owned PR policy overlays. Do not install the Cursor plugin into Pi as a substitute for this adaptation.
