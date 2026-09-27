# @whamp/pi-inline-identifier

Use inline `$skill`, `&agent`, and `/template` references in one user request. Each recognized definition is added once, in first-mention order, and the original request is appended at the tail.

```text
$poteto-mode $teach explain why this extension only inserts one skill
```

With the pstack extension loaded first (as in this repository's root manifest), `$poteto-mode` enables sticky Poteto Mode from a complete token anywhere in interactive or RPC user input. Extension-generated input is ignored. `/poteto-mode off` still disables the mode.

## Install and configuration

Install the published package with `pi install npm:@whamp/pi-inline-identifier`. The root `pi` package also registers this extension as `inline-identifier`. Do not load the upstream `@pi-kaush/pi-inline-identifier` package or its skill/agent compatibility packages in the same Pi session; they also handle these tokens and could transform the request twice.

## Identifier behavior

- `$skill` resolves only a loaded Pi skill. A single distinct skill keeps Pi's native `/skill:name` expansion. Multiple distinct references render each skill as a Pi-format `<skill name="…" location="…">` block.
- `&agent` discovers file-backed user agents under `~/.pi/agent/agents` and trusted project agents under the nearest `.pi/agents`. Project agents are listed only when `ctx.isProjectTrusted()` is true and the detected subagent tool accepts the supported direct-execute shape. The current pi-subagents catalog uses `{ action: "execute", input: { agent, task } }`; project delegation adds `input.agentScope: "both"`.
- `/template` resolves loaded Pi prompt templates inline, including one template by itself. Native leading slash commands (for example `/model` or `/skill:teach`) bypass inline processing. Unknown tokens remain ordinary request text.
- Repeated references to the same category and name resolve once. Different categories with the same name remain distinct. Blocks follow the first source offset; generated content is not scanned again. Attachments remain on the transformed input.
- Extension-generated inputs are not transformed. If any recognized file-backed resource cannot be read, Pi receives the unchanged request and gets a warning instead of a partial transformation.

Agent references add instructions; this extension never calls or schedules the subagent tool. Its agent inventory is intentionally limited to on-disk user and trusted project definitions. Built-in or package-provided agents that are not exposed through those files are not discoverable here. Tool schemas that expose neither an explicit nested input agent field nor the supported compact `{ action, input }` execute contract do not enable agent identifiers. A top-level agent field alone is not compatible with the nested call rendered here.

## Template placeholders

The complete request is treated as one argument. `$1`, `$@`, `$ARGUMENTS`, defaults such as `${2:-fallback}`, and slices such as `${@:1}` retain Pi's literal placeholder substitution. Each template is expanded in full for every composed request; context-reuse reminders are not used for flat blocks.

The original request is always appended once after all instruction blocks. A placeholder that inserts the request therefore creates another literal copy inside that template block. This is intentional template-authored duplication. Repeating a placeholder repeats the request as often as the template asks; a template without a consuming placeholder gets no extra copy inside its body.

## Editor support and attribution

The extension retains upstream autocomplete, prompt slash-trigger support, theme-based token coloring, and guarded `Editor`/`CustomEditor` render wrappers. Inline `/` completion and coloring depend on Pi's editor internals; if those internals change, input routing is unaffected but the TUI affordances may need an update.

Automated checks cover the coordinator, pstack's sticky token handling, editor adapter, and the root manifest. A real Pi print-mode input run confirmed two-skill ordering, literal template expansion, the request tail, and sticky mode. A second run captured the ordered skill blocks and request tail at `before_agent_start` and received `OK` from the model. Interactive Pi showed skill completion and theme coloring. Agent discovery with installed subagent and project trust remains environment-dependent.

Ported from [`@pi-kaush/pi-inline-identifier`](https://github.com/kaushikgopal/pi-kaush/tree/main/extensions/pi-inline-identifier), upstream revision `d59aab65b94328071b8bcd936b7cd87584723715` (MIT, Copyright (c) 2026 Kaushik Gopal). This package retains the upstream license and attribution. The main behavior change is ordered flat composition with one request tail; the upstream whole-message prompt reuse reminder and its compaction fallback are not used.
