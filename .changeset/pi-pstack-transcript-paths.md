---
"@whamp/pi-pstack": patch
---

Point transcript skills at `~/.pi/agent/sessions/--<slug>--/` instead of leftover Cursor `agent-transcripts/` paths. The previous sessions-path seam inverted the "do not glob" warning so agents were told not to look in the Pi session directory.

Borrowed the Pi path shape from [backnotprop/pstack](https://github.com/backnotprop/pstack)'s Harness mapping. Adapted it for this port with `$PI_SESSION_FILE` and a sibling-slug fence.
