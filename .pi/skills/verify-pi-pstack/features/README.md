# Pi Pstack verification map

This map covers only packages/pi-pstack. Read it before driving. Use the SKILL.md launch recipe: select and pin the product checkout, then use an external scratch cwd, isolated Pi directory and sessions, explicit package extension/skills, and disabled global discovery. Do not seed private model assignments or production PRs. A bounded model drive may use only the approved temporary OAuth access described in SKILL.md; never retain credentials in evidence.

## Features

| Feature | Recipes and proof |
| --- | --- |
| Shared skill installation | `scripts/install-shared-skills.test.mjs`: root and child postinstall hooks, 48 complete directory links, repeat installation, conflicts, opt-out, filesystem errors, tarball inclusion. For release verification, run real Pi Git and packed-npm installs in isolated homes and inspect `~/.agents/skills/`; lifecycle-only tests do not prove Pi or BB integration. |
| [Skill catalog](skill-catalog.md) | /pstack status, on/off, aliases, bad argument, persisted toggle |
| [Sticky Poteto Mode](poteto-mode.md) | command, explicit skill and inline entry; off aliases; session persistence |
| [Role setup](role-setup.md) | UI cancellation/save, selected models, recovery backups |
| [Structured question](structured-question.md) | listed/typed answers, multi-select, cancel |
| [Upstream sync and bundled CLIs](upstream-sync.md) | pinned import, dry-run effects, convergence, plan and orchestration CLI contracts |
| [Independent PR coordination](independent-pr-coordination.md) | shared store, units, exact-head verdicts, scoped remote snapshots and landing limits |

## Proof and skip reporting

Each recipe starts from fresh Launch state unless it says otherwise. Save exact commands and visible output with the feature ID/entry point. Mutations require stored state checks, not just notifications. Different entry points remain separate coverage obligations; one successful off/on run does not prove explicit skill expansion or automatic routing.

This is a seed map, not proof that all 48 workflows ran. The maintenance pass exercises at least one representative user path per feature file; it does not require every sub-feature to run. Record untested entry points explicitly. Investigation (how/why), Audit/Challenge/Babysit, Arena/Swarm/Reflect and all 23 playbooks still need their own bounded behavioral cases when changed. A sync claim must enumerate changed upstream paths and intended adaptations, then map every affected behavior to a test or explicit blocker. Review invocation metadata and workflow/child capability contracts even when text tests pass. Do not weaken investigation or verification depth to make a smoke test cheap.

The 0.9.1 catalog contract is 48 loaded skills, 45 upstream-imported skills retaining upstream invocation policy, four Codex implicit-invocation opt-outs (how, why, unslop, typescript-best-practices), and only Pi-only code-review model-visible. Counts are baseline evidence, not permission to discard later upstream additions.

Global code-review/poteto-mode collisions invalidate the isolated run. Startup's skill list includes hidden skills and does not itself prove model visibility. Model-driven paths require caller-approved auth, routing, capacity and capability preflight; deterministic slash commands do not.
