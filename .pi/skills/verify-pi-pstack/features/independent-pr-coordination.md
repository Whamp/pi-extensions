# Independent PR coordination and current-head verdicts

Users coordinate independent PRs in one shared program directory. A verification verdict applies to one PR head, not later commits.

## Sub-features

- `program-store`: all callers use one absolute store path.
- `program-units`: add and inspect work units without starting agents.
- `head-verdict`: record and check a verdict for an exact PR number and SHA.
- `remote-snapshot`: refresh only the approved PR inventory against its actual default branch.
- `authorized-landing`: land only approved, verified heads; do not construct dependent PR stacks.

## How to get to it (user POV)

Read poteto-mode/references/branch-workflow.md before Orchestrate, Shipping, Babysit, or either Autopilot playbook. Run the bundled orch CLI for bookkeeping. Use Lane in Lane-adopted repositories and GitHub CLI for approved remote actions.

## Driving it with Bun CLI

Preconditions: selected candidate contains scripts/orch/orch.ts and references/branch-workflow.md. Use Launch's external RUN and EVIDENCE directories. Follow [Scratch CLI preparation](upstream-sync.md#scratch-cli-preparation) now: it creates `$RUN/regrounded` on a fresh Launch, checks the dependency key and module resolution, and handles missing dependencies only with explicit scratch-install approval. No upstream download, prior sync recipe, model, GitHub login, or remote write is needed for the local recipe.

- **Doctor:** preparation captures `bun "$RUN/regrounded/skills/poteto-mode/scripts/orch/orch.ts" --help` only after readiness passes. Inspect `$EVIDENCE/orch-help.txt`; require the expected independent-unit/store commands and no bootstrap install. Inspect the selected package revision and exact scratch script path.
- **Initialize:** run `bun "$RUN/regrounded/skills/poteto-mode/scripts/orch/orch.ts" --store "$RUN/program" init`. Save its output. All following commands must use that same absolute store.
- **Unit:** run the CLI with `--store "$RUN/program" unit add smoke --track verification`, then `--store "$RUN/program" unit get smoke`. Require the same unit ID and track in CLI output and program/units.tsv. These commands do not start agents or create PRs.
- **Exact head:** run the CLI with `--store "$RUN/program" ledger record 123 1111111111111111111111111111111111111111 unit-test-verified --evidence "$EVIDENCE/local-ledger.txt"`. This synthetic PR/SHA is a local fixture, not a remote verification claim. Run `ledger check 123 1111111111111111111111111111111111111111` and require unit-test-verified. Run `ledger check 123 2222222222222222222222222222222222222222` and require `NOT-VERIFIED` with exit code 2. Save both commands, output and stored ledger. Never reuse this fixture to authorize a real merge.
- **Remote snapshot:** only with existing gh authentication and an explicitly approved real PR inventory, enroll that existing PR on its repository's default branch, then run `frontier set --repo "$REPO" --prs "$PSTACK_VERIFY_PRS"` with that explicit comma-separated inventory. Capture default branch, PR state and remote head. Do not create a production PR just to satisfy this prerequisite. An absent candidate PR is an unreachable route, not local-ledger proof of remote behavior.
- **Landing:** actual shipping needs independent reviewer evidence, current-head checks and user authorization. Do not merge during this maintenance smoke. Use read-only source checks for approval/match-head instructions and report live landing as unverified.

## Gotchas

- A second worktree does not isolate two writers pushing to the same branch.
- Lane push can rebase and change the head; earlier verification does not cover the new head.
- Snapshot order is presentation order, not a dependency chain.
- A local ledger smoke proves local storage and exact-SHA lookup only, not GitHub integration, CI, review quality or safe remote merging.
- Do not use Graphite or dependent PR stacks. The review-only Autopilot queue does not create a branch chain.
