---
name: verify-pi-pstack
description: Verify only @whamp/pi-pstack's real Pi terminal commands, role setup, explicit skills, and Cursor-to-Pi sync contracts after package changes or upstream updates. Use isolated sessions and retain behavioral evidence; do not audit other pi-extensions packages.
---

# Verify Pi Pstack

Read [features/README.md](features/README.md) first. The primary surface is the Pi TUI: an extension, 48 skills, and two agent definitions, not a web app. Secondary surfaces are the regrounder and bundled coordination/plan CLIs. Resolve the documentation checkout from this skill's location. Select and pin the product checkout separately when verifying a pending lane. This skill is project-local verification infrastructure, **not** a new shipped Pstack skill.

Upstream intent is the default. Required Pi adaptations and explicitly approved exceptions must be identifiable, minimal, and regression-tested. Do not rewrite imported skills, alter user model policy, install/authenticate services, publish, merge, or run production PR automation merely to verify them.

## Launch

Prerequisites: Node supporting `--experimental-strip-types`, installed package dependencies, Pi, and Herdr tools in a Herdr session. This recipe needs no provider login or model request for catalog-toggle verification. No build is required. From the checkout containing this skill:

```bash
export REPO="${PSTACK_VERIFY_REPO:-$(git rev-parse --show-toplevel)}"
export REPO="$(cd "$REPO" && pwd -P)"
export PACKAGE="$REPO/packages/pi-pstack"
test -f "$PACKAGE/extensions/pstack/index.ts"
export RUN="$(mktemp -d /tmp/verify-pi-pstack.XXXXXX)"
mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}/pi-verification"
export EVIDENCE="$(mktemp -d "${XDG_STATE_HOME:-$HOME/.local/state}/pi-verification/pi-pstack.XXXXXX")"
mkdir -p "$RUN/agent" "$RUN/sessions"
printf '%s\n' "$REPO" "$PACKAGE" "$RUN" "$EVIDENCE" > "$EVIDENCE/paths.txt"
git -C "$REPO" rev-parse HEAD > "$EVIDENCE/revision.txt"
git -C "$REPO" status --short > "$EVIDENCE/worktree-status.txt"
pi --version > "$EVIDENCE/pi-version.txt"
node --experimental-strip-types --test \
  "$PACKAGE"/extensions/pstack/*.test.ts \
  "$PACKAGE/skills/poteto-mode/scripts/check-plan.test.mjs" \
  "$PACKAGE"/scripts/*.test.mjs \
  > "$EVIDENCE/package-tests.txt" 2>&1
```

Require the tests to exit zero; inspect failures before driving. Set PSTACK_VERIFY_REPO to the absolute candidate checkout before Launch when testing a pending lane. Save the candidate commit and package hashes, and confirm they do not change during the pass. Use a dedicated checkout at the recorded commit if another agent is changing the original lane. A pass against master does not verify a pending lane. The original master baseline was package 0.9.1 with 98 tests; the Lane-only candidate at f6fcca5 has 100. Do not hardcode that count as future success criteria. Prefer `pnpm --filter @whamp/pi-pstack test` when the repo's configured pnpm is available; the direct Node command is the same package test list. If dependencies are absent, use the repo's documented `pnpm install --frozen-lockfile`, not an improvised global install.

Use `herdr_layout({action:"pane_split", cwd:RUN, focus:false})`. Save its returned pane ID. In that **new shell only**, use `herdr_pane run` to export `PI_CODING_AGENT_DIR=RUN/agent PI_TELEMETRY=0` (substitute the absolute RUN path). Do not change the parent shell's Pi directory.

Use `herdr_agent start` on that pane, kind `pi`, unique name, with these arguments, substituting absolute PACKAGE and RUN paths:

```text
--offline --no-extensions
--extension PACKAGE/extensions/pstack/index.ts
--no-skills --skill PACKAGE/skills
--no-context-files --no-prompt-templates --no-themes
--session-dir RUN/sessions
```

`--no-skills` suppresses global discovery while explicit `--skill` still loads this package. Omitting it loads global skills and can silently select the wrong code-review/poteto-mode copy. The external scratch cwd avoids local settings and AGENTS.md from this repository. Do not copy global settings, private model assignments, or the whole auth store. Deterministic commands need no auth. For model-driven tests, first read the caller's model-routing and account/capacity policy. Set VERIFY_PROVIDER, VERIFY_MODEL, and VERIFY_THINKING to the approved route. Check it with `pi auth check --provider "$VERIFY_PROVIDER" --json --no-refresh`; require the selected provider and OAuth auth type. An isolated session may use a temporary file containing only that provider's existing OAuth access credential, with mode 0600 and refresh disabled. Do not print credentials, switch accounts, use API-key billing, or save auth in evidence. Remove that file during Cleanup. If the access token expires, stop and report the auth prerequisite; do not add a paid fallback.

Ready means an idle Pi editor, startup showing only this package's skills and the pstack extension, no load errors/collisions, and the scratch cwd. Startup lists user-only skills too; it is **not** the model-visible catalog. This baseline has only code-review model-visible.

Outside Herdr, use an independently owned terminal/PTY with the same environment, cwd and literal `pi` arguments. Capture its terminal transcript. Never attach to or double-drive the user's Pi session. Multiple verification instances are safe only with distinct RUN, evidence directory, and pane.

Teardown is in Cleanup. Run it after failed launches too.

## Doctor

This is read-only: submit `/pstack status` through `herdr_agent prompt`, then `herdr_agent read` with `source:"visible"`. Save the submitted command and returned screen as `doctor.txt` in EVIDENCE. Require scratch cwd and `pstack skills on.`, `Source: missing.`, `Warnings: 0. Errors: 0.` on a fresh run; after a saved toggle, expect `Source: v2.` and the corresponding on/off state.

Also inspect startup/version and the owned pane's launch record. A status from an old or shared session is not a valid doctor. Provider authentication is not required or exercised for this no-model smoke; no credentials are copied, though the shell may inherit provider environment variables. For a model-driven feature, provider/tool preflight becomes an additional requirement. Before the first model drive, require an authenticated response from the explicitly selected permitted model. Pass `--provider "$VERIFY_PROVIDER" --model "$VERIFY_MODEL" --thinking "$VERIFY_THINKING"` for the approved bounded route; do not rely on Pi's automatic model choice. Keep private route assignments in caller policy, not this skill. For the bounded question and activation recipes, use `--tools read,ask_user_question`. Enable additional tools only when a mapped workflow requires them.

Slash commands can execute instantly without entering a working state. Herdr may report “no observed working or blocked state” although the command succeeded: read the visible screen and inspect side effects **before** retrying. A pane-run JSON parsing error can also follow a successful shell command; inspect the pane instead of duplicating setup blindly.

## Drive

For deterministic command paths use `herdr_agent prompt` with literal slash commands, then `read`. For menus use `herdr_agent send_keys` and select by the visible label, not a fixed number of cursor movements. Save each action and result outside RUN. Follow the matching feature recipe; never substitute internal setters, imported handlers, or a fake ExtensionAPI for a real user path.

Catalog toggle is the default safe smoke: `/pstack status`, `/pstack off`, `/pstack status`, `/pstack on`, `/pstack status`. Inspect RUN/agent/pstack/models.json after each mutation and restart Pi against the **same** scratch directories to prove persistence. This requires no model request.

Other entry points (`/poteto-mode`, `/skill:poteto-mode`, inline `$poteto-mode`, `/skill:<name>`, and ask_user_question) can initiate actual model work. Before those runs, load the caller's model-routing skill and account/capacity policy; authorize a bounded route and supply scratch-only auth if required. Do not infer spending permission from a selected model label. Missing approved auth/backend is a blocker, not grounds to use a paid fallback. The base launch supplies ask_user_question, but not subagent. A /skill:how investigation additionally needs an explicitly loaded delegation extension and executable reviewer with approved child auth/tools. Preflight that route separately; skill expansion is not a completed investigation. Do not exchange a denied backend for another one.

## Evidence

EVIDENCE is outside RUN and survives Cleanup. For each feature ID and entry point retain:

- Exact action, startup/terminal state before and after, diagnostics and exit status where applicable.
- Stored config snapshots and session JSONL for persistence, plus independent read-only checks.
- Package/Pi versions, fixed repo commit, dirty status, and hashes of changed package inputs when verifying uncommitted work.
- Test output and upstream provenance/diffs for sync verification; distinguish these static regressions from real runtime proof.
- A short verdict naming passed, failed, skipped and blocked paths. Never collapse partial coverage into “Pstack verified”.

Exercise real user paths, capture action **and** resulting state, and check effects such as files, refs, child outputs or messages alongside the terminal. No fabricated test endpoints. Mocks are permissible only at an existing production external boundary and must be labelled; they cannot prove remote integration. A dry-run name does not establish safety: compare files/refs and observe external calls or trace the executable path before claiming no side effects. Do not record tokens, auth files, private role/account tables or unrelated transcripts.

The 2026-10-02 instruction audit is provenance, not runtime proof. On Will's host its parent report is `/home/will/.pi/history/pi-extensions-538b66b42b7a/research/pstack-runtime-audit-2026-10-02/report.md`; read its qualifications before relying on investigator reports. Its source baseline was Cursor 0.15.5, revision 12d587dfb20741cafc376c42c696c5f6e2a64487. At generation, Lane-only runtime work was still being implemented separately. The maintenance candidate at f6fcca5 contains independent-PR coordination and current-head verdict rules. Inspect and record the actual candidate; source presence does not establish merge, publication, or full audit completion.

## Cleanup

Before exit, copy RUN/sessions and any non-secret scratch pstack config snapshots to EVIDENCE. With the Pi editor empty, send `ctrl+d` through `herdr_agent send_keys`. If a turn is running, interrupt it first and verify it has settled. Read the owned pane to confirm the shell returned, then close **only that pane** with `herdr_pane close`. No kill-by-name, workspace shutdown, removal of somebody else's panes, or broad worktree cleanup.

Remove the temporary provider auth file without copying it to evidence. Remove only the exact RUN directory created above, after checking its recorded path and that its process has exited. Retain EVIDENCE, including failure evidence. Confirm `test -s "$EVIDENCE/doctor.txt"` and the driven feature's artifacts after teardown. For restart proofs, exit and restart in the existing owned shell before final close; keep RUN until that proof finishes.

## Helpers

No additional helper scripts ship with this skill. Use the real Herdr harness and the package's existing executables. Their exact invocations are in [upstream-sync.md](features/upstream-sync.md). Do not modify the app to add verification-only hooks.

After package changes, use `/skill:maintain-verification-skill` to update this map and rerun affected recipes.
