---
name: setup-pstack
description: Configure which models pstack uses per role. Use for /setup-pstack, /skill:setup-pstack, or changing pstack's model choices.
disable-model-invocation: true
---

# Setup pstack

Run the `/setup-pstack` command.
It lists models configured for this Pi session and writes `~/.pi/agent/pstack/models.json`.

If the command is unavailable, write that JSON yourself:

- `version`: `2`
- `roles`: omit a role to inherit the parent model
- each value is `inherit-parent`, a `provider/id` selector, or an array of selectors for `fanout` and `pick-one`
- Do not persist `auto`. Write `inherit-parent` instead.
- never write a selector you have not confirmed is available
- start every role omitted or at `inherit-parent` unless the user chose a model

The 22 roles and their cardinalities are in `references/MODEL-ROLES.md`.

- `single`: one job, one selector
- `repeat`: one selector, reused for N children the workflow chooses
- `fanout`: one child per list entry
- `pick-one`: a candidate list, then one child

The file is user-level.
Do not commit it.

`/setup-pstack` is the only writer that migrates v1 JSON or leftover markdown.
A backup is written before replacing v1 JSON or leftover markdown.
Load never rewrites the file.
Session start does not rewrite the file.

After writing, tell the user it applies to new turns.
`/pstack status` shows source, warnings, and errors.
Offer `/skill:create-verification-skill` once if the project has no verify skill, same as before.
