# Publishing

## Release model (locked)

This monorepo uses **independent package versions**, **changeset-driven Version
PRs**, and **per-package git tags** as the only supported release train.

Canonical path from monorepo changes to public npm packages and GitHub Releases
under `@whamp`:

1. Land changes on `master` with a **changeset** (`.changeset/*.md`)
2. **Version packages** PR bumps only changed packages and writes changelogs
3. After that Version PR merges, CI creates missing tags `@whamp/<pkg>@<version>` on `master`
4. Tag push (via `RELEASE_TOKEN` PAT) starts **Publish package** once per tag
5. **Publish package** runs `npm publish` + creates a matching GitHub Release

Important: tagging does **not** run when a Version PR is only opened/updated.
Publish waits until the Version PR lands on the default branch.

Rules that do not change without a new plan:

- Root package stays `"private": true` and is never published
- Never republish an existing version; always bump first
- Do not store npm tokens in the git repo
- CI publish uses the `NPM_TOKEN` repository secret (granular automation token preferred)
- Local `npm login` publish is emergency-only; CI is primary
- Tag format is always `@whamp/<name>@<semver>` (not monorepo-only `v*` tags)
- Version `0.0.0` marks an unreleased package. It is never tagged or published;
  a changeset bump is required first

## Prerequisites

- npm user `whamp`, which owns the `@whamp` scope, with 2FA enabled
- Repo secret `NPM_TOKEN`: npm **granular automation** token (type **Automation**, not classic / publish-with-OTP) with publish rights on `@whamp/*`
  - Classic tokens and granular tokens that still require 2FA OTP will fail CI with `EOTP`
- Repo secret `RELEASE_TOKEN`: a GitHub **personal access token** used by `release-pr.yml` (and optionally publish) instead of `GITHUB_TOKEN`
  - Required because `changesets/action` needs to open PRs, which the default `GITHUB_TOKEN` cannot do when the repo restricts Actions from creating PRs
  - Also used so tag pushes start `publish.yml` (events from the default `GITHUB_TOKEN` do not trigger other workflows)
  - Classic PAT: `repo` + `workflow` scopes
  - Fine-grained PAT (this repo): **Contents** read/write, **Pull requests** read/write, **Metadata** read, **Workflows** read/write
  - Store under Settings → Secrets and variables → Actions

```bash
npm whoami
# Optional availability checks (404 means not published yet):
npm view @whamp/pi-quiet version || true
```

## Contributor flow (version automation)

When you change a publishable package:

```bash
pnpm changeset
```

Select the packages, bump type, and a short summary. Commit the file under
`.changeset/`.

On push to `master`, `.github/workflows/release-pr.yml` does one of two things:

1. **Pending changesets** (`hasChangesets=true`): open or update the **Version packages** PR only.
   No tags, no publish.
2. **No pending changesets** (`hasChangesets=false`, typically right after a Version PR merge):
   create any missing annotated tags on the default-branch tip.
   Each tag push (via `RELEASE_TOKEN`) starts `publish.yml` once.

```text
@whamp/pi-quiet@0.4.2
@whamp/pi-pstack@0.7.0
```

Do not also `gh workflow run publish.yml` after the tag push.
That double-fires publish and races on npm.

Manual tag dry-run:

```bash
pnpm tag-packages
pnpm tag-packages -- --apply
pnpm tag-packages -- --apply --push
```

## Versioning policy

Packages use **independent** versions.

| Change | Bump |
|---|---|
| Docs, help text, safe bugfixes | patch |
| New commands/features, non-breaking | minor |
| Breaking behavior or config changes | major |

- Bump only packages that changed (via changesets).
- Never republish an existing version.
- New packages start at `0.0.0` and stay untagged until a changeset bumps them.
- Root `package.json` stays `"private": true`.

## Tag-triggered publish (CI)

`.github/workflows/publish.yml` runs on:

- `push` of tags matching `@whamp/*@*`
- `workflow_dispatch` with `tag` + optional `dry_run` (default true)

For each tag it:

1. Parses `@whamp/<name>@<semver>` (`scripts/parse-release-tag.mjs`)
2. Checks out the tagged commit
3. Runs `pnpm check` and `npm pack --dry-run` in that package
4. Fails if tag version ≠ `package.json` version
5. Skips `npm publish` if that version already exists on the registry
6. Publishes with `NODE_AUTH_TOKEN` / `NPM_TOKEN` when needed (also treats "already published" races as success)
7. Creates a GitHub Release for the tag (idempotent if it already exists)

Dry-run from Actions UI:

- Workflow: **Publish package**
- Input tag: `@whamp/pi-quiet@0.4.2`
- `dry_run`: true

## Tarball sanity

```bash
cd packages/<name>
npm pack --dry-run
```

Must include only intended paths: `extensions/` or `src/`, `README.md`, `package.json`, `LICENSE`.

Each package keeps `LICENSE` as a symlink to the repo-root license; `prepack` materializes a real file into the tarball, and `postpack` restores the symlink.

No `.pi/`, `local-test/`, `plan/`, auth files, home paths, or `AGENTS.md` unless deliberate.

## Manual / emergency publish

Prefer CI. If you must publish locally:

```bash
npm login
pnpm check
pnpm --filter @whamp/pi-quiet publish --access public
git tag -a @whamp/pi-quiet@0.4.2 -m "Release @whamp/pi-quiet 0.4.2"
git push origin @whamp/pi-quiet@0.4.2
```

Caution: `pnpm -r publish` attempts every non-private package. Prefer per-package
or tag-driven CI.

## First-time bootstrap

1. Confirm `@whamp` ownership and create a granular automation token → repo secret `NPM_TOKEN`.
2. Create the `RELEASE_TOKEN` PAT → repo secret `RELEASE_TOKEN`.
3. Merge the changeset + publish workflows to `master`.
4. Pending changesets bump `pi-pstack` to `0.7.0` and `pi-quiet` to `0.4.2` in the first Version PR. The six personal packages stay at `0.0.0` and are not tagged.
5. After the Version PR merges, confirm each tag's **Publish package** run, npm page, and:

```bash
pi install npm:@whamp/pi-quiet
```

6. Later releases use changesets + Version PR only.

## Pre-publish checklist (still useful for manual cuts)

1. `git status` clean on the release commit
2. `pnpm check` and `pnpm test`
3. Smoke-load packages you care about with `pi -e ./packages/<name>`
4. README install commands use `npm:@whamp/...`
5. Changeset (or intentional version) is correct
6. `npm pack --dry-run` clean

## Bad release / incident basics

1. Publish a fixed version (new bump + tag).
2. Deprecate the bad version:

```bash
npm deprecate @whamp/<pkg>@<ver> "reason; use @whamp/<pkg>@X.Y.Z"
```

3. If tokens leaked via a tarball, rotate them and treat as a security incident (see [SECURITY.md](../SECURITY.md)).

## CI layout

| Workflow | Trigger | Role |
|---|---|---|
| `ci.yml` | PR + push to default branch | `pnpm check` + `pnpm test`; no npm token |
| `release-pr.yml` | push to default branch | Version PR when changesets exist; otherwise missing package tags |
| `publish.yml` | package tags / manual dispatch | npm publish + GitHub Release (one run per tag) |

## Install path truth in docs

After a package is on npm:

- Root and package READMEs use `npm:@whamp/...` as the primary install path.
- Keep path/git install examples under local development sections.

## Branch protection (recommended)

On the default branch (`master`):

- Require a pull request before merging (not currently enabled)
- Require status check **CI** / `pnpm check` to pass before merge
- Restrict who can push tags if available on your plan
- Do not put `NPM_TOKEN` on fork PRs (tag/dispatch-only publish already avoids that)

Admins may still bypass PR rules for emergency release infra fixes.

## Out of scope (this automation)

- npm OIDC trusted publishing (token secret is the current path)
- Fully automated Changesets multi-package publish without tags
- Marketing / social announcement copy
- Branch-protection policy changes that require admin UI (document recommended settings only)

## Acceptance criteria

- Version PR automation can bump packages via changesets
- Tag `@whamp/<pkg>@<ver>` (or workflow_dispatch) publishes that package when the version is new
- Matching GitHub Release exists per published tag
- Already-published versions skip npm publish without failing the release step
- No npm token in git; `ci.yml` does not receive `NPM_TOKEN`
- `docs/publishing.md` matches the automated path
- `pnpm check` and `pnpm test` pass on the default branch
