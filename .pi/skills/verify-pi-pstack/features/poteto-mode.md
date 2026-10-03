# Sticky Poteto Mode

Users enable rigorous Pstack workflow routing for the current session and explicitly turn it off.

## Sub-features

- `mode-command`: /poteto-mode with or without a task enables and dispatches the skill.
- `mode-skill`: /skill:poteto-mode enables sticky mode.
- `mode-inline`: a standalone $poteto-mode identifier enables sticky mode.
- `mode-off`: off/disable/stop turn it off.
- `mode-session`: resume uses the current branch's last mode entry.

## How to get to it (user POV)

Enter /poteto-mode, /poteto-mode Explain the package README, /skill:poteto-mode Explain the package README, or $poteto-mode Explain the package README. Enter /poteto-mode off, /poteto-mode disable or /poteto-mode stop to exit.

## Driving it with Herdr

Preconditions: isolated Launch; approved bounded model/auth route for all enabling paths. /poteto-mode off itself needs no model.

- **Activation-only smoke:** in a fresh approved session enter `/poteto-mode This is a bounded mode-activation test. Reply with MODE_ACTIVE only. Do not use tools, delegate, or start repository work.` Capture the on notification, status, and persisted enabled:true entry. Then enter /poteto-mode off and confirm cleared status and enabled:false. This proves mode activation, not workflow execution.
- **Other entry points:** use fresh sessions for the explicit skill and inline entry. For `/skill:poteto-mode`, capture the expanded skill body, status and session entries. For inline `$poteto-mode`, capture the unchanged user input, status and session entries. Inline activation does not expand the skill body. For a workflow proof, also capture the chosen playbook and actual execution. The base launch does not supply delegation; report missing capabilities before requesting an investigation.
- **Off:** send /poteto-mode off after the turn settles. Require “Poteto Mode off.” and removed status. Repeat disable and stop separately.
- **Persistence:** copy session JSONL before cleanup. Resume the exact recorded session file, not a new session. For branch-specific proof, retain active-branch parent IDs; chronological entries alone do not prove restoration from the active branch. It must contain customType pstack-mode with enabled true followed by false matching the actions. Exit, restart with --session pointing to that exact scratch session file, and confirm the last state. Do not use --continue against user sessions.
- **Routing:** for a changed playbook, choose a task matching its documented trigger, capture which playbook was read, the real child/tool calls, verifier evidence, and expected outputs. Read the playbook in full first; do not treat a claimed route as executed behavior.
- **Negative inline:** in a separate approved session submit The identifier is example$poteto-modeSuffix; this must not activate sticky mode. Confirm session state and status rather than relying on model prose.

## Gotchas

- Enabling dispatches real model work even without a task; do not smoke-test it casually.
- The catalog /pstack toggle and mode state are independent.
- A mode entry proves activation, not execution of all 23 playbooks.
- Session files can contain sensitive prompts; use only scratch tasks and scoped transcripts.
