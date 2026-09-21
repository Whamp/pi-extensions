# @whamp/pi-btw

Two explicit side-conversation modes for [Pi](https://github.com/badlogic/pi-mono):

- `/btw [question]` opens a modal tangent thread backed by a side agent. The thread sees the parent conversation, can use `read`, `bash`, `edit`, and `write`, and persists with the parent session. Closing the overlay returns to the unchanged main conversation.
- `/branch-tab [question]` clones the active parent branch and launches it immediately in a detached [Herdr](https://github.com/Whamp/herdr) tab. The new session can continue independently and does not merge back.

## Install

```bash
pi install npm:@whamp/pi-btw
```

The overlay works in interactive Pi. `/branch-tab` additionally requires Pi 0.84.1+, Herdr 0.8.0+, Node.js 22.19.0+, `HERDR_ENV=1`, and a persisted parent session.

## Safety

The overlay blocks the parent TUI while open. The detached `/branch-tab` session does not: both sessions share the same working directory, so do not edit the same files concurrently.

## Development

This package lives in the [`pi-extensions`](https://github.com/Whamp/pi-extensions) monorepo. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @whamp/pi-btw test
pnpm check
```

The package is MIT-licensed except for `src/btw-overlay.ts`, adapted from `mitsuhiko/agent-stuff` under Apache-2.0. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
