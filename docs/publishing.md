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
5. **Publish package** authenticates to npm through GitHub OIDC, runs `npm publish`, and creates a matching GitHub Release

Important: tagging does **not** run when a Version PR is only opened/updated.
Publish waits until the Version PR lands on the default branch.

Rules that do not change without a new plan:

- Root package stays `"private": true` and is never published
- Never republish an existing version; always bump first
- Do not store npm tokens in the git repo
- CI publish uses an npm trusted publisher for each package. It does not use `NPM_TOKEN`.
- New packages need one first publish before npm allows a trusted publisher connection.
- Local `npm login` publish is for that first publish or emergencies only; CI is primary
- Tag format is always `@whamp/<name>@<semver>` (not monorepo-only `v*` tags)
- Version `0.0.0` marks an unreleased package. It is never tagged or published;
  a changeset bump is required first

## Prerequisites

- npm user `whamp`, which owns the `@whamp` scope, with 2FA enabled
- Every released package needs a GitHub Actions trusted publisher on npm. Set organization `Whamp`, repository `pi-extensions`, workflow filename `publish.yml`, and allow direct `npm publish`. Do not set an environment name unless the job uses one.
- `publish.yml` grants `id-token: write` and pins npm 11.17.0, above the minimum version 11.5.1 needed for trusted publishing.
- Repo secret `RELEASE_TOKEN`: a GitHub **personal access token** used by `release-pr.yml` (and optionally publish) instead of `GITHUB_TOKEN`
  - Required because `changesets/action` needs to open PRs, which the default `GITHUB_TOKEN` cannot do when the repo restricts Actions from creating PRs
  - Also used so tag pushes start `publish.yml` (events from the default `GITHUB_TOKEN` do not trigger other workflows)
  - Classic PAT: `repo` + `workflow` scopes
  - Fine-grained PAT (this repo): **Contents** read/write, **Pull requests** read/write, **Metadata** read, **Workflows** read/write
  - Store under Settings → Secrets and variables → Actions

`scripts/setup-release-secrets.sh` creates and stores only the GitHub `RELEASE_TOKEN`. Renew it when it expires. Removing this remaining manual rotation would require migrating the Version PR and tag workflow to a GitHub App.

```bash
./scripts/setup-release-secrets.sh
```

Manual check of the current state:

```bash
# A 404 means the version has not reached the registry:
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
6. Publishes through npm trusted publishing when needed (also treats "already published" races as success)
7. Creates a GitHub Release for the tag (idempotent if it already exists)

A manual dispatch uses the workflow from the default branch but checks out the requested tag. Use it to retry a tag created before an authentication change without moving or replacing the tag. Rerunning the old tag-triggered job keeps its older workflow definition.

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

Packages with a repo-root license symlink use `prepack` to put a real file in the tarball and `postpack` to restore the symlink. Ports that retain an upstream license include their own `LICENSE` file.

No `.pi/`, `local-test/`, `plan/`, auth files, home paths, or `AGENTS.md` unless deliberate.

## Manual / emergency publish

Prefer CI. For a new package, first land its changeset and Version PR. Then sign in to npm as `whamp`, check that its existing tag matches `package.json`, and publish the first version once:

```bash
npm login
pnpm check
cd packages/<new-package>
npm publish --access public
```

Add a trusted publisher through the new package's npm settings or `npm trust github @whamp/<new-package> --repo Whamp/pi-extensions --file publish.yml --allow-publish`. This requires account sign-in and 2FA. Dispatch **Publish package** on `master` with the existing tag and `dry_run: false` to create its matching GitHub Release. The workflow skips `npm publish` because the version exists. Do not create a second tag.

Caution: `pnpm -r publish` attempts every non-private package. Publish one package at a time.

## First-time bootstrap

Each existing package needs one trusted publisher connection. A new package needs the first publish above because npm requires the package to exist before trust can be configured. Later releases use changesets, the Version PR, and CI.

Confirm the published version and exercise an install:

```bash
npm view @whamp/pi-inline-identifier version
pi install npm:@whamp/pi-inline-identifier
```

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
- Do not expose publishing credentials to fork PRs. Only package tag runs and manual dispatch get GitHub's short-lived OIDC credential.

Admins may still bypass PR rules for emergency release infra fixes.

## Out of scope (this automation)

- Fully automated first publish of a new npm package (npm requires the package to exist before its trusted publisher can be configured)
- Fully automated Changesets multi-package publish without tags
- Marketing / social announcement copy
- Branch-protection policy changes that require admin UI (document recommended settings only)

## Acceptance criteria

- Version PR automation can bump packages via changesets
- Tag `@whamp/<pkg>@<ver>` (or workflow_dispatch) publishes that package when the version is new
- Matching GitHub Release exists per published tag
- Already-published versions skip npm publish without failing the release step
- No npm token is needed for routine releases; `ci.yml` receives no npm publish credential
- New packages require a first publish and one trusted publisher connection before CI can publish them
- `docs/publishing.md` matches the automated path
- `pnpm check` and `pnpm test` pass on the default branch
