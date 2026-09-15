# Todos

File-based todo management with a TUI and a tool for agent use.

## How It Works

Each todo is a standalone markdown file (`<id>.md`) stored in `~/.pi/history/<project>-<path-hash>/todos/` (override with `PI_TODO_PATH`). The path hash prevents repositories with the same directory name from sharing a backlog. On first use, the extension moves the old basename-only directory into the new location. Files have a JSON front matter block (id, title, tags, status, timestamps, assignment) followed by a markdown body.

File locking (`.lock` files with a 30-minute TTL) prevents concurrent edits across sessions.

## Usage

**`/todos`** — opens the visual todo manager TUI with fuzzy search, action menus, and detail overlays.

**`todo` tool** — the agent uses this for programmatic access:

| Action | Description |
|--------|-------------|
| `list` | Open + assigned todos |
| `list-all` | All todos including closed |
| `get` | Full todo with body |
| `create` | New todo (title required) |
| `update` | Replace fields (body replaces) |
| `append` | Add to body (body appends) |
| `claim` | Assign to current session |
| `release` | Unassign from session |
| `delete` | Remove todo file |

## TUI Controls

| Key | Action |
|-----|--------|
| Type | Fuzzy search |
| `↑↓` | Navigate |
| `Enter` | Action menu |
| `Ctrl+Shift+W` | Quick-start work |
| `Ctrl+Shift+R` | Quick-start refine |
| `Esc` | Close |

## Garbage Collection

On session start, closed todos older than 7 days are auto-deleted. Configure in `<todos-dir>/settings.json`:

```json
{ "gc": true, "gcDays": 7 }
```
