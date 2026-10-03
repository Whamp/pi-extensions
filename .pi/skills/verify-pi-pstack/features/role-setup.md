# Role setup

Users select models for Pstack's 22 roles, or inherit the parent, and save a versioned configuration. Choices include session models and retained configured selectors, even when a retained selector is unavailable.

## Sub-features

- `setup-cancel`: cancelling leaves config untouched.
- `setup-save`: completing the role prompts and any required replacement confirmation writes the selections. Declining replacement writes nothing.
- `setup-pools`: list roles allow more than one model.
- `setup-recovery`: legacy/diagnostic sources require safe migration or confirmation and backup.

## How to get to it (user POV)

Enter /setup-pstack in Pi. Follow the labelled role pickers. This is a TUI command; non-UI invocation must refuse without writing.

## Driving it with Herdr

Preconditions: fresh isolated Launch. No provider generation needed. Add `--models "$VERIFY_PROVIDER/$VERIFY_MODEL"` to an authenticated subscription launch for a smaller menu, and check the actual provider-qualified choices. Without that auth, fuzzy matching can expose another provider; do not select it as a permitted fallback. Retained configured selectors can still appear. To test explicit models, preflight a caller-approved scratch registry/auth setup; never copy private models.json. Read package skills/setup-pstack/references/MODEL-ROLES.md for the exact role list and cardinalities.

- **Cancel:** submit /setup-pstack; capture the first role title. Send esc. Require “Setup cancelled. Nothing was written.” and absent RUN/agent/pstack/models.json (or unchanged bytes for an existing scratch config).
- **Save:** submit /setup-pstack, read every visible role label and option, choose the inherit-parent option for each role. Choosing inherit-parent skips additional pool picks. For explicit pools, finish with the displayed `done` option. Do not assume a fixed key count; capture each selection until “Wrote …/agent/pstack/models.json.” Read and save that file. /pstack status must report a clean v2 source.
- **Explicit selection/pools:** repeat using approved available selectors and at least two choices for a list role. Inspect saved roles against the visible selections. Missing models must not silently become unauthorized substitutes.
- **Recovery:** in a separate scratch run use a legacy source from the package's existing config-store test cases, save through the UI, and compare backup bytes with original bytes. For diagnostic replacement, decline “Replace pstack config?” first and verify no change; then explicitly confirm and verify backup plus clean output.
- **Restart:** reopen the same scratch config and check UI selections/status. Saved configuration must not imply an always-on model-role table injection.

## Gotchas

- Escape anywhere in the sequence cancels the entire setup.
- Available registry entries do not establish spending permission.
- Tests cover concurrent-source-change protection; a successful ordinary save is not proof of that race.
- Read config-store tests before creating migration fixtures; don't guess a legacy schema.
