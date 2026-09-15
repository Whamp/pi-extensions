# Whamp Pi extensions

This personal fork collects Will's Pi extensions in one monorepo for local path-based loading.

## Packages

- [`@zenspc/pi-pstack`](./packages/pi-pstack): agent workflows, skills, and subagents.
- [`@zenspc/pi-quiet`](./packages/pi-quiet): dense tool activity rendering.
- [`@zenspc/pi-answer`](./packages/pi-answer): interactive question extraction and answering.
- [`@zenspc/pi-files`](./packages/pi-files): file browsing and graphical diff actions.
- [`@zenspc/pi-session-breakdown`](./packages/pi-session-breakdown): read-only session usage analytics.
- [`@zenspc/pi-todos`](./packages/pi-todos): file-based todo management.
- [`@zenspc/pi-tokps`](./packages/pi-tokps): assistant decode-speed tracking.
- [`@zenspc/pi-local-vllm-thinking-budget`](./packages/pi-local-vllm-thinking-budget): per-model thinking budgets for local vLLM models.

The root Pi manifest loads `pi-pstack` and `pi-quiet`. The six personal extensions have separate package manifests so they can be enabled independently from a checkout.

## Install

Install the root package directly from GitHub:

```bash
pi install git:github.com/Whamp/pi-extensions
```

To enable an individual package for one run:

```bash
pi -e ./packages/pi-answer
```

Use the `packages` setting with each package directory to load the six personal extensions from a local checkout. The PR description contains the complete settings snippet.

## Develop from a checkout

Clone the fork and install its workspace dependencies:

```bash
git clone https://github.com/Whamp/pi-extensions.git
cd pi-extensions
pnpm install --frozen-lockfile
```

Run the checks and tests from the repository root:

```bash
pnpm check
pnpm test
```

Read the [contributor guide](./docs/contributing.md) for package commands. The [publishing guide](./docs/publishing.md) documents the inherited release process.

## Upstream and license

This repository preserves the history and MIT license of [zenspc/pi-extensions](https://github.com/zenspc/pi-extensions). Read [LICENSE](./LICENSE) for the license terms.
