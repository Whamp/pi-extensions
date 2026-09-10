# Whamp Pi extensions

This personal fork of
[zenspc/pi-extensions](https://github.com/zenspc/pi-extensions) retains two
packages for the [Pi coding agent](https://pi.dev).

## Packages

### `@zenspc/pi-pstack`

[`pi-pstack`](./packages/pi-pstack) provides agent skills, playbooks,
engineering principles, review workflows, and subagent definitions.

### `@zenspc/pi-quiet`

[`pi-quiet`](./packages/pi-quiet) provides dense, verb-first rendering for
built-in and third-party tool calls.

The packages keep their upstream `@zenspc` npm identities. This fork does not
publish packages under a Whamp npm namespace.

## Install from a checkout

Clone the fork and install its workspace dependencies:

```bash
git clone https://github.com/Whamp/pi-extensions.git
cd pi-extensions
pnpm install --frozen-lockfile
```

Install one or both packages into Pi:

```bash
pi install "$PWD/packages/pi-pstack"
pi install "$PWD/packages/pi-quiet"
```

Pi links path installs to the checkout. After you edit an installed package,
restart Pi or run `/reload`.

For a single run without changing user settings, use one of these commands:

```bash
pi -e ./packages/pi-pstack
pi -e ./packages/pi-quiet
```

## Development

```bash
pnpm check
pnpm test
```

Read the [contributor guide](./docs/contributing.md) for package commands. The
[publishing guide](./docs/publishing.md) documents the inherited release
process.

## Upstream and license

This repository preserves the history and MIT license of
[zenspc/pi-extensions](https://github.com/zenspc/pi-extensions). Read
[LICENSE](./LICENSE) for the license terms.
