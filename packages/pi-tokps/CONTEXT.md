# Tokps Context

Tokps records model decode speed for Pi assistant outputs and can show the latest speed in the Pi status area.

## Language

**Tokps Lifecycle**:
The ordered measurement flow from assistant output start through persisted speed metadata.
_Avoid_: handler chain, event plumbing

**Decode Speed Record**:
A persisted measurement of one assistant output's token rate and related Pi session references.
_Avoid_: metric blob, stats object

**Decode Task**:
An in-progress assistant output whose streaming deltas are being measured before a **Decode Speed Record** exists.
_Avoid_: stream job, live request

**Session Metadata**:
Pi session details attached to a **Decode Speed Record**, including assistant entry, previous user entry, session id, session file, and cwd.
_Avoid_: branch scan data, persistence extras

**Display State**:
The per-session choice to show or hide the latest tokps status.
_Avoid_: UI flag, status toggle

## Relationships

- One **Tokps Lifecycle** tracks zero or one active **Decode Task** at a time.
- One **Decode Task** becomes zero or one **Decode Speed Record** when the assistant output finishes.
- A **Decode Speed Record** includes **Session Metadata** when Pi has written the related session entries.
- **Display State** controls whether the active **Decode Task** or latest **Decode Speed Record** appears in the Pi status area.

## Example dialogue

> **Dev:** "Why does a **Decode Task** show estimated tok/s before there is a **Decode Speed Record**?"
> **Domain expert:** "Because the provider only reports final token usage after the output finishes, so live status estimates from streamed text while the final record keeps the provider count."

## Flagged ambiguities

- "metadata" means **Session Metadata** in tokps, not the raw Pi custom entry itself.
