# tokps

Records model decode speed for each assistant output.

- Shows live estimated tok/s during streaming when display is enabled.
- Always appends custom session entries with `customType: "tokps-decode-speed"`.
- `/tokps status` shows the last completed speed.
- `/tokps on|off|toggle` controls status-bar display.
- Start pi with `--tokps-display` to show the status by default.

Each speed entry stores provider/model, output tokens, decode duration, tokens/sec, session id/file, assistant entry id, and previous user entry id/preview when available. Live tok/s is display-only; final records keep using provider `usage.output` when available.

Architecture:
- `index.ts` is the Pi adapter: registers hooks/commands and applies lifecycle effects.
- `lifecycle.ts` is Pi-free: owns ordering, display state, pending records, session metadata, and command parsing.
- Live display changes, such as a future per-turn unit, stay behind lifecycle effects.

Run `/reload` after installing or editing this extension.
