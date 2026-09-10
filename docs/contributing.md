# Contributing

## Layout

This fork retains two independent npm packages with their upstream `@zenspc`
names.

```text
packages/
  pi-pstack/
  pi-quiet/
```

## Local development

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pi -e ./packages/pi-pstack
pi -e ./packages/pi-quiet
pi install ./packages/pi-pstack
pi install ./packages/pi-quiet
```

Path installs are not copied. After you edit an installed package, restart Pi
or run `/reload`.

## Change a package

1. Keep the change inside `pi-pstack` or `pi-quiet`.
2. Update the package README when user-facing behavior changes.
3. Run `pnpm --filter @zenspc/<name> test`.
4. Run `pnpm check`.
5. Run `pnpm test`.
6. Smoke test with `pi -e ./packages/<name>` when extension behavior changes.
7. For changes intended for npm publication, run `pnpm changeset`.
8. Commit the generated file under `.changeset/`.

## Package rules

- `package.json` must include `keywords: ["pi-package"]`.
- Declare Pi resources under the `pi` key.
- List Pi runtime packages as peer dependencies with `"*"`.
- Limit npm tarballs to runtime files, `README.md`, `package.json`, and
  `LICENSE`.
- Use changesets and package tags for releases. Read the
  [publishing guide](./publishing.md).
