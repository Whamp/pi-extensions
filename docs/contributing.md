# Contributing

## Layout

This fork keeps eight independent Pi packages under `packages/`:

```text
packages/
  pi-answer/
  pi-files/
  pi-local-vllm-thinking-budget/
  pi-pstack/
  pi-quiet/
  pi-session-breakdown/
  pi-todos/
  pi-tokps/
```

Each package declares its Pi entry point in `package.json`. The six personal extensions are separate packages so global settings can load them from a local checkout without enabling unrelated resources.

## Local development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

To smoke-load one package for a single run:

```bash
pi -e ./packages/<name>
```

Path installs are not copied. After you edit an installed package, restart Pi or run `/reload`.

## Change a package

1. Keep the change inside the affected package.
2. Update the package README when user-facing behavior changes.
3. Run `pnpm --filter @zenspc/<name> test` when the package has tests.
4. Run `pnpm check`.
5. Run `pnpm test`.
6. Smoke test with `pi -e ./packages/<name>` when extension behavior changes.
7. For changes intended for npm publication, run `pnpm changeset`.
8. Commit the generated file under `.changeset/`.

## Package rules

- `package.json` must include `keywords: ["pi-package"]`.
- Declare Pi resources under the `pi` key.
- List Pi runtime packages as peer dependencies with `"*"`.
- Limit npm tarballs to runtime files, `README.md`, `package.json`, and `LICENSE` plus any required third-party notices.
- Use changesets and package tags for releases. Read the [publishing guide](./publishing.md).
