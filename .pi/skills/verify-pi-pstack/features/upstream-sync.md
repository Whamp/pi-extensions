# Upstream sync and bundled CLIs

Maintainers update the Pi port from pinned Cursor sources while retaining necessary adaptations, invocation policy and workflow rigor. Bundled helpers provide executable plan and coordination contracts.

## Sub-features

- `sync-preview`: importer classifies changes without modifying the destination.
- `sync-convergence`: repeated import has no additional effects.
- `sync-intent`: upstream behavior and approved Pi exceptions remain identifiable.
- `cli-plan`: validate the real multi-phase-plan template.
- `cli-orchestrate`: run coordination commands against a disposable store.

## How to get to it (user POV)

Run scripts/reground-from-cursor.mjs with --from, --to and optional --dry-run. Use the checker and coordination CLI linked from the installed poteto-mode skill. Read the matching playbook before acting.

## Driving it with Node/Bun CLI

Preconditions: Launch tests pass, evidence directory outside scratch, and the complete upstream Pstack tree at a recorded revision. The bundled fixtures/cursor-pstack-12d587d directory contains only caller-guidance files; it is not a complete import source. Do not use that partial fixture as --from for this recipe.

For the recorded Cursor 0.15.5 baseline, obtain the complete public source with these commands. This is a pinned download, not a claim about today's upstream HEAD.

```bash
export UPSTREAM_SHA=12d587dfb20741cafc376c42c696c5f6e2a64487
curl --fail --location --silent --show-error \
  "https://codeload.github.com/cursor/plugins/tar.gz/$UPSTREAM_SHA" \
  -o "$RUN/upstream.tar.gz"
tar -xzf "$RUN/upstream.tar.gz" -C "$RUN" "plugins-$UPSTREAM_SHA/pstack"
export UPSTREAM="$RUN/plugins-$UPSTREAM_SHA/pstack"
cp "$RUN/upstream.tar.gz" "$EVIDENCE/upstream.tar.gz"
sha256sum "$EVIDENCE/upstream.tar.gz" > "$EVIDENCE/upstream-archive.sha256"
printf '%s\n' "$UPSTREAM_SHA" > "$EVIDENCE/upstream-revision.txt"
```

For a newer update, first approve and pin its full source revision. Never substitute a sparse fixture or an unrecorded moving checkout.

- **Preview:** make a disposable copy: cp -a "$PACKAGE" "$RUN/regrounded". Run `find "$RUN/regrounded" -type f -print0 | sort -z | xargs -0 sha256sum > "$EVIDENCE/sync-before.sha256"`. Run node "$PACKAGE/scripts/reground-from-cursor.mjs" --from "$UPSTREAM" --to "$RUN/regrounded" --dry-run > "$EVIDENCE/sync-preview.txt" 2>&1. Save exit status, run the same hash command to "$EVIDENCE/sync-after.sha256", and run `diff -u "$EVIDENCE/sync-before.sha256" "$EVIDENCE/sync-after.sha256"`; require no changes. Inspect the CLI's dry-run path before claiming no external activity; file equality alone cannot exclude network calls.
- **Apply/converge:** run the same command without --dry-run against the scratch copy, capture exit status, and diff its skills against PACKAGE/skills. Review differences by upstream path and adaptation class; do not auto-accept them. Hash the scratch result, run apply again, and require identical hashes. Never use the source package as --to.
- **Intent:** retain upstream revision, candidate revision, full changed-path inventory and reviewed differences. Confirm invocation parity for imported skills and four Codex opt-outs, explicit skill routes, Pi-only code-review, on-demand model lookup, child capabilities, tool vocabulary, valid links, and caller-policy precedence. The importer and catalog tests are necessary regressions, not sufficient evidence of all workflow intent. Run `diff -qr --exclude=node_modules "$PACKAGE/skills" "$RUN/regrounded/skills" > "$EVIDENCE/import-source-differences.txt"` and review every listed source change against the approved adaptations. Diff exit 1 means differences, not a completed fidelity check. Stable repeated imports can still remove a required local instruction.
- **Plan:** extract the actual fenced skeleton using the commands below. Require zero and retain the plan and output. The checker validates the skeleton, not the whole explanatory playbook.

  ```bash
  awk '/^````markdown$/{inside=1;next} inside && /^````$/{exit} inside {print}' \
    "$PACKAGE/skills/poteto-mode/playbooks/multi-phase-plan.md" > "$RUN/plan.md"
  test -s "$RUN/plan.md"
  node "$PACKAGE/skills/poteto-mode/scripts/check-plan.mjs" "$RUN/plan.md" \
    > "$EVIDENCE/plan-check.txt" 2>&1
  cp "$RUN/plan.md" "$EVIDENCE/plan.md"
  ```
- **Orchestrate:** first inspect scripts/bootstrap.ts. It installs dependencies unless its commander package and content-derived install key are current. A copied workspace can also contain broken dependency symlinks. Check resolution before invoking the CLI: run `(cd "$RUN/regrounded/skills/poteto-mode/scripts" && bun -e 'await import("commander"); await import("typebox/value"); console.log("CLI_DEPENDENCIES_READY")') > "$EVIDENCE/cli-module-doctor.txt" 2>&1`. If either resolution or the key check fails, request scratch-only dependency-install approval. After approval, run `(cd "$RUN/regrounded/skills/poteto-mode/scripts" && bun install --frozen-lockfile) > "$EVIDENCE/bun-provision.txt" 2>&1`, then run help and recheck readiness. Do not let even --help silently install. Use the scratch copy, not the source package: run `bun "$RUN/regrounded/skills/poteto-mode/scripts/orch/orch.ts" --help > "$EVIDENCE/orch-help.txt" 2>&1`. Read the actual installed command help before selecting commands. Use --store or ORCH_STORE with an absolute RUN-owned path, never a shared program store. Capture commands, store changes and failure behavior. Do not merge, create production PRs, or run Graphite to satisfy a smoke test. The Lane-only candidate forbids dependent PR stacks and Graphite. Store-only commands require no GitHub access; remote snapshot verification requires gh auth and an approved PR inventory. Follow [independent-pr-coordination.md](independent-pr-coordination.md) for exact local ledger and head checks.
- **Change-specific runtime:** map each changed workflow's documented entry points to real bounded Pi tasks and effects. Verify workers/verifiers, exact head identity, approval gates and single-writer ownership when affected. Preserve evidence through teardown. Don't silently swap the denied backend or reduce reviewer breadth.

## Gotchas

- A stale fixture proves regression against that fixture, not alignment with today's upstream HEAD. An actual update needs an authorized pinned checkout and a comparison of upstream commits/path changes.
- The maintenance candidate at f6fcca5 contains Lane-only workflow changes. Verify the selected candidate, and report its integration status separately. Neither presence in a candidate nor a smoke pass proves that all audit recommendations landed.
- The importer retains Pi-only files and excludes Cursor-only assets/automations; a raw byte-equality comparison of whole packages is the wrong criterion. An incomplete --from tree can delete real destination skills. Use only scratch as --to and retain the dry-run deletion inventory before apply.
- Coordination help may initialize dependencies through bootstrap; inspect bootstrap and retain side-effect evidence. No silent installs.
- Don't run worktree-audit.sh cleanup against real worktrees; the baseline audit documented GNU/BSD timestamp and default-branch issues.
