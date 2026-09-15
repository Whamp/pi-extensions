# Files extension

Use `/files` or `Ctrl+Shift+O` to browse tracked, untracked, conversation-referenced, and recently touched files. The picker can reveal, open, edit, add to the prompt, or diff a selected file.

On Linux, diff actions prefer `zeditor`, then `zed`, then `code`; only installed commands are offered. Set `PI_FILES_DIFF_EDITOR` to `zeditor`, `zed`, or `code` to override that order. On macOS, `Ctrl+Shift+R` Quick Look remains available. It is deliberately not registered on Linux, where that shortcut belongs to the Todos refine action.

Adapted from `mitsuhiko/agent-stuff` commit `3c891a9640f80c271ccc666ab7a39f9811bc3fb6` under Apache-2.0. See `extensions/files/LICENSE.agent-stuff`.
