## General guidelines

- For new packages, version 0.0.0 initially
- Give each package's Pi extension a named entrypoint at `extensions/<name>/index.ts` re-exporting `src/index.ts`, and list it in both the root and child `pi.extensions` manifests, so pi config shows the name instead of `src/index.ts`. `scripts/root-pi-package.test.mjs` rejects `src/` labels and duplicate labels.

## Agent skills

### Issue tracker
Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels
Five canonical triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context layout: a single CONTEXT.md and docs/adr/ at the repo root. See `docs/agents/domain.md`.
