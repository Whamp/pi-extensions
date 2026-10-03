# Skill catalog

Users can hide or restore Pstack's model-visible skills without disabling explicit skill access or changing role assignments.

## Sub-features

- `catalog-status`: state, source and diagnostics.
- `catalog-toggle`: on/off and persistence across restart.
- `catalog-aliases`: enable/disable match on/off; invalid arguments do not mutate.
- `catalog-explicit`: /skill:<name> remains usable while off.

## How to get to it (user POV)

Enter /pstack, /pstack status, /pstack on, /pstack off, /pstack enable or /pstack disable in Pi. Invoke /skill:how explicitly while the catalog is off.

## Driving it with Herdr

Preconditions: fresh isolated Launch and Doctor; no model calls needed except catalog-explicit.

- **Status:** prompt /pstack and /pstack status separately. Save screen output. Fresh state is on, Source: missing, zero warnings/errors.
- **Off:** prompt /pstack off. Require “pstack skills off. Hidden from the model; /skill:<name> still works.” Read RUN/agent/pstack/models.json; skillsEnabled is false. Copy it to EVIDENCE/catalog-off.json. Prompt /pstack status; require off, Source: v2, zero warnings/errors.
- **Restart:** exit Pi, restart with identical Launch arguments in the same shell; /pstack status must remain off. Save EVIDENCE/catalog-restart.txt.
- **On:** prompt /pstack on. Require “pstack skills on.” Inspect skillsEnabled true and save EVIDENCE/catalog-on.json. /pstack status confirms v2 and on.
- **Aliases/error:** repeat with /pstack disable and /pstack enable. Hash the config, send /pstack nonsense, require “Usage: /pstack [on|off|status]”, and confirm the hash did not change.
- **Explicit access:** only with approved scratch auth, an explicitly loaded subagent extension, and an executable read-only reviewer, send /skill:how Explain the Pstack README's model-role lookup without changing files. Save expanded skill/session and actual bounded investigation evidence. Do not count an auth error or skill-file read as completed investigation.
- **Visibility:** inspect skill-catalog and skill-strip test results for the catalog filter contract; real prompt visibility needs a captured runtime system prompt or an observed bounded model invocation. Mark it unverified if unavailable. The toggle smoke alone proves command/persistence behavior, not prompt contents.

## Gotchas

- /pstack off changes catalog exposure, not sticky mode or on-demand role lookup.
- Only code-review is model-visible at the baseline; /pstack on does not expose all 48.
- Dirty/legacy config refuses toggle writes with a /setup-pstack instruction. Test that separately with scratch fixtures; never overwrite the user's config.
- Record role selections before/after toggling when present; they must stay unchanged.
