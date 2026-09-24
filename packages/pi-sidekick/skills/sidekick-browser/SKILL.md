---
name: sidekick-browser
description: Use the pinned local AXI launcher for explicit, isolated browser verification in a Sidekick child.
---

# Sidekick browser verification

This skill is available only when the lead explicitly adds this file's absolute path to
`sidekickSkills`. Bash alone does not activate browser guidance. The tooling package is
optional and must be installed explicitly in its own directory; it is not a global AXI,
MCP, or automatic-download setup.

## Launcher

Resolve the directory containing this skill, then resolve `../../tools/sidekick-browser/axi.mjs`
from that directory to an absolute path. Invoke it through Node:

```sh
node /absolute/path/to/tools/sidekick-browser/axi.mjs <command> [args...]
```

Never invoke a global AXI binary, `npx`, or a global MCP installation. The launcher resolves its
pinned AXI and MCP packages relative to its own directory and fails with
`npm ci --prefix <absolute tooling directory>` when they are absent. It preserves your caller
working directory, so AXI relative upload and output paths retain their task-directory meaning.

Read the launcher `--help` output and relevant per-command help before operating it. Preserve
`CHROME_DEVTOOLS_AXI_SESSION` and `CHROME_DEVTOOLS_AXI_BROWSER_URL` controls. Use a unique named
AXI session per worker and reuse that session across handoffs; do not collide with the lead or
other workers.

## Isolated browser operation

On a Chromium-only host, start a separate Chromium process with a dedicated temporary profile
and localhost remote-debugging endpoint. Never attach to or reuse the user's profile. Keep the
browser process available across handoffs when needed; do not stop a browser or bridge session
that another worker owns. Follow the existing Herdr/tmux instructions for persistent shell
processes.

Navigate with `open`, take a fresh `snapshot`, and pass only fresh returned refs to actions. After
filling or clicking, verify the visible result with another snapshot or evaluation and save a
screenshot at an absolute path. Use `console` and `network` when the task needs log or request
evidence. Report the screenshot and evidence paths. Do not claim authentication, inherited login,
or profile sharing; these flows are not implied by this skill.
