# Pi Sidekick

Pi Sidekick adds an optional persistent **lead + sidekick** workflow to Pi. The Pi conversation remains the lead; a separate Pi child process carries out delegated work. The lead remains responsible for the plan, review, and final result.

## Compatibility

Verified with Pi `@earendil-works/pi-coding-agent` **0.87.1** and Node.js **22.19.0 or newer**. The RPC adapter preserves block-array content and accepts string content for system, user, and custom messages. Offline localhost OpenAI-compatible streaming tests exercise two completed handoffs in the same persistent child.

## Install and opt in

Install this package from its local checkout; it is not available from npm:

```sh
pi install /absolute/path/to/pi-extensions/packages/pi-sidekick
```

Restart Pi or run `/reload`. Authenticate models through Pi first, then select an exact sidekick model and enable delegation for the current session:

```text
/sidekick model provider/model-id
/sidekick on
```

There is no default sidekick model. To persist the enabled setting for later sessions, use `/sidekick save`. Sidekick remains disabled unless explicitly enabled.

## Tools and commands

| Surface | Behavior |
| --- | --- |
| `sidekick` | Sends a nonblank message to the persistent child. A running handoff is steered; after settlement, a new message starts another handoff in that child context. |
| `sidekick_wait` | Passively observes one exact handoff ID; it does not send a message or steer the child. |
| `/sidekick model provider/model-id` | Selects an exact sidekick model. |
| `/sidekick thinking off\|minimal\|low\|medium\|high\|xhigh\|max` | Sets the child's thinking level. |
| `/sidekick on` / `/sidekick off` | Enables or disables Sidekick for the parent session. Disabling stops active work; it does not revert edits. |
| `/sidekick cancel` | Cancels the current handoff while retaining partial edits for review. |
| `/sidekick reset [--yes]` | Confirms and archives the current child context; it does not undo workspace changes. |
| `/sidekick save` | Saves effective settings as global defaults. |

Interactive TUI/RPC calls have a 30-second **observation window**, not an execution deadline. If that window expires, the caller can return while the child continues; observe that handoff later with `sidekick_wait`. Work continues until completion, failure, cancellation, or session close.

## Configuration

Configuration version 2 defaults to disabled, has no selected sidekick model, and allows Pi's standard read/write/edit/shell/search tools. See [`examples/sidekick.json`](examples/sidekick.json):

```json
{
  "version": 2,
  "sidekick": null,
  "thinking": "medium",
  "leadProfile": "auto",
  "broadExploration": false,
  "leadRenderedBrowser": false,
  "sidekickPreferExec": false,
  "enabled": false,
  "sidekickExtensions": [],
  "sidekickSkills": [],
  "tools": ["read", "write", "edit", "bash", "grep", "find", "ls"]
}
```

Global settings are read from `~/.pi/agent/sidekick.json` or `$PI_CODING_AGENT_DIR/sidekick.json`. A trusted project may use `.pi/sidekick.json`; project configuration is not read for an untrusted project.

The child shares the parent's working directory, filesystem, environment, and operating-system permissions. This extension is **not a sandbox** and does not create a worktree or container. The child starts without ambient extensions, skills, prompt templates, or themes. Add only trusted absolute local paths to `sidekickExtensions` and `sidekickSkills`; explicitly configured extensions and skills execute with the child's full local permissions. Parent approval extensions and approval decisions are not inherited; headless confirmation requests fail closed and are not forwarded to the lead. The `tools` list is a capability selection, not an operating-system security boundary.

## Persistence and recovery

Sidekick orchestration state is version 3, separate from Pi's native child transcript. It records the latest handoff and freezes the selected prompt text, exact model, tools, and configured child capabilities for an epoch. Effective prompt text is integrity-checked when state is loaded. Optional `canonicalSha256` is accepted only as legacy snapshot metadata; new epochs do not write it.

Restarting Pi can resume a persisted child context. A branch change resets child conversational context to avoid carrying state from another branch; it does not undo file changes. `/sidekick reset` archives the old context rather than erasing it. Inspect the workspace after interrupted work. An unfinished child transcript can be newer than its parent transcript, so `pi --continue` may open the child. If so, use the session picker or `pi --session <parent-session-path>` to return to the lead.

## Optional integrations

### Sidekick Duo

`pi-subagents` is optional. Install it separately if you want to call the packaged `sidekick-duo` agent. In an ordinary interactive Pi session, select the exact model, enable Sidekick, and run `/sidekick save` so fresh Duo sessions load the saved configuration. The outer caller retains final acceptance authority.

### Browser skill

The browser skill is optional and is not automatically enabled. Install its pinned tools in the package's browser directory:

```sh
npm ci --prefix /absolute/path/to/pi-sidekick/tools/sidekick-browser
```

Explicitly add the absolute path to `skills/sidekick-browser/SKILL.md` to `sidekickSkills`; keep the `bash` tool available. The skill uses only its local pinned launcher and does not attach to a user's browser profile.

## License and inspiration

MIT licensed. See [LICENSE](LICENSE). Architecture inspiration: Cognition's public [Fusion announcement](https://cognition.com/blog/local-fusion). Built for the [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
