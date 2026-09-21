# Whamp Pi extensions

Will Hampson's Pi coding agent extensions, kept in one monorepo and published to
npm under `@whamp` once released.

## Packages

- [`@whamp/pi-pstack`](./packages/pi-pstack): agent workflows, skills, and subagents ported from the Cursor pstack plugin.
- [`@whamp/pi-quiet`](./packages/pi-quiet): dense tool activity rendering.
- [`@whamp/pi-answer`](./packages/pi-answer): interactive question extraction and answering.
- [`@whamp/pi-btw`](./packages/pi-btw): side conversations as an in-session overlay or a detached Herdr tab.
- [`@whamp/pi-files`](./packages/pi-files): file browsing and graphical diff actions.
- [`@whamp/pi-session-breakdown`](./packages/pi-session-breakdown): read-only session usage analytics.
- [`@whamp/pi-todos`](./packages/pi-todos): file-based todo management.
- [`@whamp/pi-tokps`](./packages/pi-tokps): assistant decode-speed tracking.
- [`@whamp/pi-local-vllm-thinking-budget`](./packages/pi-local-vllm-thinking-budget): per-model thinking budgets for local vLLM models.
- [`@whamp/pi-jev-pruner`](./packages/pi-jev-pruner): bash output pruned with TypeSafe Jev before the model reads it, ported from a Claude Code plugin.

The root Pi manifest loads all ten packages, so one git install gets the full
set. Each package also has its own manifest and can be installed alone.
`pi-jev-pruner` stays inert until Agent Vault credentials exist; read its
[README](./packages/pi-jev-pruner/README.md) before enabling it.

## Install

Install everything from the repository:

```bash
pi install git:github.com/Whamp/pi-extensions
```

Install one released package from npm:

```bash
pi install npm:@whamp/pi-pstack
```

Run a package from a checkout without installing it:

```bash
pi -e ./packages/pi-answer
```

Path installs are not copied. After you edit an installed package, restart Pi or
run `/reload`.

## Develop from a checkout

```bash
git clone https://github.com/Whamp/pi-extensions.git
cd pi-extensions
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Read the [contributor guide](./docs/contributing.md) for package commands and the
[publishing guide](./docs/publishing.md) for the release train and the
`scripts/setup-release-secrets.sh` token setup.

## Provenance and license

The repository began as a fork of
[zenspc/pi-extensions](https://github.com/zenspc/pi-extensions) and keeps that
history and its MIT license. `pi-pstack` is a port of the Cursor pstack plugin
by Lauren Tan (`packages/pi-pstack/LICENSE`). `pi-files` and
`pi-session-breakdown` adapt `mitsuhiko/agent-stuff` under Apache-2.0; their
provenance notices ship inside those packages. Read [LICENSE](./LICENSE) for the
license terms.
