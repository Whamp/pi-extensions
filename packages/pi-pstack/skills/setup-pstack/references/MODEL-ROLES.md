# Pstack model roles

Generated from `extensions/pstack/pstack-roles.ts`. Edit the registry, not this file.

Cardinality:

- `single`: one job, one selector.
- `repeat`: one selector, reused for N children the workflow chooses.
- `fanout`: one child per list entry.
- `pick-one`: a candidate list, then one child.

| Role | Cardinality | Purpose |
| --- | --- | --- |
| `feature implementation` | `single` | Implement the scoped feature after design. |
| `refactoring implementation` | `single` | Make behavior-preserving structural edits. |
| `bug-fix` | `single` | Implement the diagnosed fix. |
| `perf-issue` | `single` | Implement a measured performance change. |
| `hillclimb` | `repeat` | Implement each bounded metric experiment. |
| `judgment` | `single` | Give a general decision or second opinion. |
| `prose` | `single` | Draft or revise user-facing writing. |
| `hardest tasks` | `single` | Handle an explicitly escalated difficult task. |
| `how explorers` | `repeat` | Investigate each architecture slice. |
| `how explainer` | `single` | Investigate and explain a simple question. |
| `how synthesizer` | `single` | Combine completed architecture findings. |
| `why investigators` | `repeat` | Investigate each evidence source. |
| `why synthesizer` | `single` | Reconcile historical evidence and uncertainty. |
| `reflect judgment reviewer` | `single` | Review decisions made in the session. |
| `reflect tooling reviewer` | `single` | Review tool choice and verification. |
| `reflect divergent reviewer` | `single` | Challenge the session's shared assumptions. |
| `reflect synthesizer` | `single` | Reconcile the three reflection reports. |
| `arena runners` | `fanout` | Produce one complete candidate per list entry. |
| `arena judge pool` | `pick-one` | Choose one model to judge all completed candidates. |
| `swarm workers` | `repeat` | Use one model across N bounded worker tasks. |
| `architect runners` | `fanout` | Produce at least two distinct design candidates. |
| `interrogate reviewers` | `fanout` | Review the same artifact once per list entry. |
