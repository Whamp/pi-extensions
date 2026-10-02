# @whamp/pi-pstack

pstack for Pi: rigorous agent workflows you can parallelize with confidence. Ported from the Cursor pstack plugin.

If you want to go fast, go deep first. pstack helps you write less, but higher quality code. It gives you fearless parallelism: when an agent goes deep and writes good, verifiable code, you can parallelize with confidence. Start multiple agents with `poteto-mode` and trust they will apply rigorous engineering principles to their work.

## Install

```bash
pi install npm:@whamp/pi-pstack
```

Or install from the repository, which is the source of truth for this port:

```bash
git clone https://github.com/Whamp/pi-extensions.git ~/projects/pi-extensions
cd ~/projects/pi-extensions
pnpm install --frozen-lockfile
pi install ~/projects/pi-extensions/packages/pi-pstack
```

This package is ported from the Cursor pstack plugin by Lauren Tan
(`LICENSE`).

Requires [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) for the `poteto-agent`, `comment-sicko`, and workflow fan-outs (`how`, `why`, `arena`, `swarm`, `interrogate`, `reflect`, `code-review`).

## Get started

1. Run `/setup-pstack` once to pick which models each role uses (optional; every role inherits the parent session model otherwise).
2. Use `/poteto-mode` for sticky Poteto Mode. It stays on until `/poteto-mode off`. `/skill:poteto-mode` also enables it.
3. Run `/pstack off` to hide the Pi-only `code-review` coordinator from the Skill catalog.
   Off persists in `~/.pi/agent/pstack/models.json`.
   `/skill:<name>` keeps working.
   `/pstack on` restores `code-review`, not all 48.

That is it.
The other skills are Hidden; the mode skill uses them as needed.

## What you get

- **48 skills**, including:
  - `poteto-mode`: the main entry point. Reads your request, matches one of 23 playbooks (bug fix, perf, feature, refactoring, investigation, shipping, orchestrate, autopilot, and more), copies its steps in verbatim, and routes to the other skills as steps fire. Orchestrate refills one shared worker-and-verifier window as each child settles.
  - Workflow skills: `code-review`, `how`, `why`, `recall`, `blast-radius`, `architect`, `arena`, `swarm`, `interrogate`, `reflect`, `teach`, `tdd`, `no-comments`, `unslop`, `deslop`, `bro`, `figure-it-out`, `show-me-your-work`, `create-verification-skill`, `maintain-verification-skill`, `automate-me`, `technical-writing`, `typescript-best-practices`.
  - 23 principle skills (`principle-laziness-protocol`, `principle-model-the-domain`, `principle-prove-it-works`, ...), one rule each, indexed inline by `poteto-mode`.
- **`ask_user_question`**: one structured preference question with 2-6 listed options. The user can pick those or type a different answer.
- **2 subagents** (loaded by pi-subagents):
  - `poteto-agent`: runs poteto's style end to end. Reads `poteto-mode` in full before any work.
  - `comment-sicko`: read-only comment reviewer that savors deletion. Usually invoked through the `no-comments` skill.
- **Bundled scripts**: `poteto-mode/scripts/` ships the `orch` coordination CLI (orchestrate playbook) and the `watch-pr` watcher (babysit playbook). Both run under [bun](https://bun.sh).

## Model roles

Per-role model choices live in `~/.pi/agent/pstack/models.json`. Run `/setup-pstack` to write it. The 22 role names and cardinalities are in `skills/setup-pstack/references/MODEL-ROLES.md`. The extension does not inject model roles into the system prompt. Before delegation, use `model-routing` to read the role configuration and select a model under the caller's routing policy. Install that skill separately from `Whamp/skills`; it is not bundled here. Neither Poteto Mode nor the `/pstack` skills toggle controls role lookup. `inherit-parent` or `auto` runs on the parent session model.

## Differences from the Cursor plugin

- The importer preserves upstream invocation settings. Change upstream behavior only for a necessary Pi adaptation or an explicitly approved exception.
  `how`, `why`, `unslop`, and `typescript-best-practices` retain upstream's `disable-model-invocation: true`.
  Their `agents/openai.yaml` files also set `policy.allow_implicit_invocation: false` for Codex.
  `/skill:name` still loads the Skill body, and Poteto Mode keeps its explicit skill routes.
  The Pi-only `code-review` coordinator remains model-visible.
- Slash commands are `/skill:<name>` instead of `/name`.
- Subagent delegation uses pi-subagents. Launch one child with `subagent({ action: "execute", input: { agent, task } })`. Set `input.async: true` for background work. Run parallel or dependent children in one `workflowScript` with stable keys. This package does not ship the `subagent` tool.
- Session transcripts live under `~/.pi/agent/sessions/--<slug>--/` instead of Cursor `agent-transcripts/`. The active file is `$PI_SESSION_FILE`. `<slug>` is the absolute cwd with the leading slash dropped and each `/` turned into `-`. Stay inside that workspace directory. Do not glob sibling slugs.
- The benny automation pack is not ported; it depends on Cursor automations. Model roles live in `~/.pi/agent/pstack/models.json`, written by `/setup-pstack` and read on demand through `model-routing`.
- `make-bot-ui` is not ported. It is Cursor Grok Bot / routine webhook UI.

## Code review coordinator

`code-review` uses Audit for ordinary review requests. It uses Challenge only for explicit adversarial or design interrogation. Requests for both run both routes. PR-status requests stay with the existing Babysit playbook. Audit findings follow `skills/code-review/references/code-review-audit.md`; Challenge reuses the existing `interrogate` skill. The coordinator adds no model role or review registry.

The coordinator uses these routes both inside and outside sticky Poteto Mode when Pstack skills are enabled:

| Request | Route |
| --- | --- |
| "Review this PR" or "review since X" | Audit. Resolve the PR's base and head, or ask for a missing base. |
| "Review against the issue" | Audit. Pin the base and the issue requirements. |
| "Challenge the design" | Challenge on the pinned design contents. |
| "Open a PR" | Opening a PR playbook. Keep its existing Challenge requirement and do not add Audit. |
| "Check on PR X" | Babysit, not a code review. |
| "Audit and challenge this change" | Audit + challenge, with independent results. |

Audit launches one Standards and one Spec child for each caller-selected model. Explicitly absent specs skip Spec. Challenge keeps one child per configured Interrogate reviewer. With both requested, the counts add; one route does not erase the other.

An older `code-review` skill may also appear from a global installation under `~/.agents/skills/code-review`. This change does not alter that installation. While both copies exist, load this package's `skills/code-review/SKILL.md` by its absolute path. A name collision can resolve `/skill:code-review` to the older copy. After the Pstack source is integrated and published, replace the global entry through its installer and verify each affected consumer. Do not remove a shared installation before those consumers have the replacement. Do not run both copies as separate reviewers.

## Related port

[backnotprop/pstack](https://github.com/backnotprop/pstack) is Lauren Tan's standalone mirror of the same Cursor plugin (`npx skills add backnotprop/pstack`). Its `main` branch keeps Cursor wording and adds a [Harness](https://github.com/backnotprop/pstack/blob/main/skills/poteto-mode/SKILL.md#harness) table so one skill body can run in Claude Code, Codex, Pi, and others. This package is the Pi-native port: it rewrites those seams (`/skill:`, `models.json`, pi-subagents) instead of asking the agent to translate. The Pi session path in that Harness table is what this package now writes into skills. Do not install the mirror into Pi if you want this extension.

See [MIRROR.md](https://github.com/backnotprop/pstack/blob/main/MIRROR.md) for the mirror's two-branch sync. This package uses `scripts/reground-from-cursor.mjs` instead.

## License

MIT
