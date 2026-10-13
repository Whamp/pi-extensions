# Pstack in BB

BB is the interaction surface. Pi runs the coordinator and workers. Preserve Cursor Pstack's workflow methods. Do not use Herdr or native Pi children as a fallback.

## Launch fresh workers

Install the standalone Pstack BB plugin. Use its `pi_worker` tool (`bb pstack worker` in the CLI) to create fresh, visible, parented BB Pi threads. The plugin supplies native startup arguments through BB’s public provider-environment API; BB’s built-in Pi provider stays unchanged. If the plugin does not expose that tool, report the missing capability. Do not substitute unrestricted workers.

The coordinator decides fanout, dependency order, judging, retries, and rolling windows. Give each worker a bounded assignment and file pointers, not the parent transcript. Retrieve full reports before synthesis; parent notifications can abbreviate them.

Resolve models through `model-routing` and `~/.pi/agent/pstack/models.json`. Preserve role counts and configured model lineups. The candidate adapter must copy the parent's resolved model and reasoning for omitted, `inherit-parent`, or `auto` selectors, rather than taking project defaults. Record requested and actual selections separately. Use only permitted recovery routes.

Example explorer assignment:

```json
{
  "role": "how explorers",
  "title": "How: request routing",
  "tools": ["read", "grep", "find", "ls"],
  "task": "Read the How explorer template. Trace request routing. Return paths, symbols, and evidence. Do not modify files."
}
```

Record the returned thread ID, parent ID, environment ID, role, model, reasoning, and tools. Thread IDs identify execution attempts, not durable work units.

## Select tools deliberately

Use native Pi tool allowlists and exclusions. Read-only explorers normally receive `read`, `grep`, `find`, and `ls`. Researchers also need the specific search, extraction, or MCP tools for their evidence category. Writers need scoped implementation tools. Verifiers may need `bash` to run tests; shell access is not read-only.

A delegated coordinator needs `pi_worker` only when its assignment includes further delegation. Tool selection is not permission to deploy, delete work, spend money, or administer machines. It is not an OS sandbox.

Live tests must demonstrate forbidden direct and indirect calls cannot execute. Passing configuration tests does not prove this boundary.

## Place work

Desktop is the normal host, including when the operator connects from a phone or laptop. Server60 is for its GPU or local LLM-serving work. Endurance is for Unraid and host-local work. Do not treat specialist machines as spare general-purpose capacity.

Read-only workers can reuse the parent environment. Prepare one isolated Lane workspace per writer, then attach BB to its existing path. Do not nest a BB worktree inside a Lane worktree. Verify an existing specialist-host environment before using it.

Projectless personal work is valid. `BB_THREAD_ID` identifies BB context without requiring a project environment variable or repository. Discover placement from BB's recorded context.

## Coordinate and recover

Route normal worker questions through the coordinator. The operator can still open any worker and speak directly to it. A worker must report consequential direct scope changes to its coordinator.

Inspect status and output without sending a message just to test liveness. Recover retained workers before creating replacements. Use fresh workers for retries and new assignments, with consolidated original scope, later directives, prior report, branch, and current state.

Resolve one absolute program-store path. The coordinator writes the store. Other-host workers return evidence packets; they cannot assume a shared filesystem.

BB Stop affects the selected thread. Stop workers through their coordinator or their individual threads. Do not change Stop-button semantics.

Keep workers nested during the run. At whole-run completion, preserve results and code before archiving completed conversations. Do not delete conversations as routine cleanup. Archiving is not permission to discard code or remove a workspace.

## Review with the operator

Explain consequential choices in chat. Use BB's browser and file viewer for comparisons and visual inspection. Use Plannotator for annotations on artifacts and messages. Add plugins only for demonstrated gaps.

Link threads with `@thread:THREAD_ID` and artifacts with absolute file paths. Expose operator-facing servers through `bb connect expose PORT` and provide the returned public URL.

## Acceptance

Exercise real workers: fresh context, explicit and inherited models, permitted and forbidden tools, nested visibility, complete reports, parent completion/failure, direct intervention, cancellation, and recovery after resume. Test fanout followed by dependent synthesis or judging. Record unverified behavior separately from passing checks.
