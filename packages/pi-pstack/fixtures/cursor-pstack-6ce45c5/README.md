# Cursor Pstack 0.15.25 caller-guidance fixture

Source: https://github.com/cursor/plugins/tree/6ce45c59b9301a638c1fe1a7b8dc2a82b650898f/pstack

This fixture retains the exact upstream caller paragraphs, watcher source files, and three new skill bodies used by the importer regressions. It is not the complete upstream package. Obtain the complete source at the pinned commit before regenerating the package:

```sh
git clone https://github.com/cursor/plugins.git cursor-plugins
git -C cursor-plugins checkout --detach 6ce45c59b9301a638c1fe1a7b8dc2a82b650898f
node packages/pi-pstack/scripts/reground-from-cursor.mjs \
  --from cursor-plugins/pstack --to packages/pi-pstack
```

The import adds `in-your-own-words`, `ketchup`, and `sharpen`. `make-bot-ui` remains excluded. Pi and Codex retain user-only invocation for the new skills. Model roles and provider selectors remain caller policy, not Cursor defaults. The current caller adapter translates changed How, Arena, Reflect, Why, Interrogate, Comment Sicko, and Poteto Mode paragraphs to BB workers. Ketchup uses BB's `inline-vis` capability instead of Cursor's `/visualize` command.

Pi-owned independent-PR, exact-head, coordinator-store, BB, and installer contracts remain protected. The Autopilot overlays adopt upstream's Ketchup catch-up without adopting stack or patch-id merge authorization. The plan checker adopts upstream's CommonMark fence handling through its existing Node test suite. The upstream Bun-only plan test is excluded because this port maintains a different Pi-owned plan skeleton and its own executable regression tests.

The watcher adapter adds braces to the affected TypeScript branches and documents new exports without changing the upstream non-style tokens. The complete watcher test suite checks the resulting behavior. Source fixtures remain byte-identical to upstream, including existing lint findings.

The older fixtures remain historical regression inputs. Static fixture checks do not prove a model executed these workflows or that an installed consumer has been updated.
