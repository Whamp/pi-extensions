# Inline identifier composition design

## Problem

The upstream `pi-inline-identifier` coordinator transforms a request only when it finds exactly one distinct known identifier. Each feature currently transforms the entire request: a skill prepends one native `/skill:name`, an agent prepends a delegation instruction, and a prompt template consumes the request as its argument. Pi expands only one leading skill command after the extension input hook. Removing the count check alone would neither insert multiple skills nor preserve request and template semantics. We will port the MIT-licensed package into `packages/pi-inline-identifier` at version `0.0.0`, retaining attribution and its editor behavior, and replace the whole-request composition policy. The implementation plan is in `inline-identifier-implementation-plan.md`.

## Usage (caller's view)

```text
$poteto-mode $teach explain why this extension only inserts one skill
```

Both skill bodies appear in the resulting user message in first-mention order. The original request follows once, at the tail. Pstack also recognizes `$poteto-mode` as a complete token anywhere in user-submitted input and enables sticky Poteto Mode. `/poteto-mode off` still disables it.

```text
Use $review and $review with &reviewer and &tester on this change.
```

The review skill appears once. Each named agent adds an instruction in mention order. The extension does not start agents itself or infer parallelism from the references.

```text
Explain this using /concise and /technical.
```

Each template body becomes an instruction block in mention order, then the original request follows at the tail. Templates do not wrap or nest the request. Keep upstream placeholder substitution: `$1`, `$@`, `$ARGUMENTS`, and applicable defaults or slices insert the literal request in the template body. That can put an additional copy of the request inside the template block; it is intentional because the template explicitly asked for the text there. Templates without a consuming placeholder do not add another copy. This preserves templates that embed the request in code or structured payloads while keeping the request-tail rule.

A leading native command such as `/model` or `/skill:teach ...` bypasses inline processing. A single `$teach` retains Pi's native skill expansion. All inline identifier categories, including a lone template, use the same flat request-last contract.

## Shape

The package has a small public interface: identifier syntax and one named Pi extension entrypoint. `extensions/inline-identifier/index.ts` re-exports `src/index.ts`, as this repository requires. Register it in the root and child `pi.extensions` manifests. It registers all three categories with one coordinator. The coordinator owns order, deduplication, and the final message; skill, agent, and prompt modules own discovery, validation, and rendering of their category. Avoid a generic plugin framework beyond the existing feature registrations.

```text
packages/pi-inline-identifier/
  extensions/inline-identifier/index.ts  re-export src/index.ts
  src/index.ts                            register skill, agent, prompt categories
  src/core.ts                             coordinator, editor integration, composition
  src/skill.ts                            skill matching, reads and Pi-format blocks
  src/agent.ts                            trusted discovery and delegation text
  src/prompt.ts                           cached template expansion and revision markers
  test/                                  upstream characterization + composition tests
  package.json, README.md, LICENSE, CHANGELOG.md
```

Types are internal; bodies below are design sketches, not executable code.

```ts
type Reference =
  | { kind: "skill"; name: string; offset: number; filePath: string }
  | { kind: "agent"; name: string; offset: number; source: "user" | "project" }
  | { kind: "prompt"; name: string; offset: number; filePath: string };

type Resolved =
  | { kind: "skill"; name: string; block: string }
  | { kind: "agent"; name: string; source: "user" | "project" }
  | { kind: "prompt"; name: string; body: string; revision: string };

type Resolution =
  | { kind: "ready"; items: readonly Resolved[] }
  | { kind: "failed"; reference: Reference; reason: string };

function collectReferences(text: string, ctx: ExtensionContext): readonly Reference[] {
  // Match only the original input, sort by offset, dedupe by kind and canonical name.
  throw new Error("not implemented");
}

function resolveAll(references: readonly Reference[]): Resolution {
  // Validate all resources before emitting any partial transformation.
  throw new Error("not implemented");
}

function compose(text: string, items: readonly Resolved[]): string {
  // Render each resolved item as one instruction block in mention order.
  // Resolve template placeholders against the original request, preserving
  // intentional literal interpolation. Append the Original request at the end.
  throw new Error("not implemented");
}
```

For zero references, return `continue`. For exactly one skill, keep the upstream native `/skill:name` transform to preserve Pi's existing skill formatting. Otherwise resolve all before producing one `transform`. Directly render Pi-compatible `<skill name="…" location="…">` blocks for multiple skills, because Pi will only expand one leading `/skill:name`. Render the remaining categories as independent blocks at their first-mention positions, and append the exact original request once at the tail. Do not recursively scan generated content. The final message must not begin with `/`, so Pi will not mistake a generated template for a native command. Unknown tokens remain literal.

Expand every referenced template in full, even if used earlier. Keep upstream literal placeholder substitution inside each template block. A template with `$1` may therefore contain one copy while the request tail contains another. Upstream's reuse reminder and context guard assume a whole-message expansion; flat mixed blocks do not meet that assumption. Keeping the full bodies avoids a new context-recovery state machine. Preserve original attachments during input transformation. Agent-only requests also use the flat request-last format.

The data model encodes category distinctions at the discovery boundary. The coordinator controls request ownership once; individual features no longer independently wrap a composite request. Each category hides its filesystem and tool schema details from callers. This is the smaller interface with more behavior behind it.

## Synthesis decision

Two independent sketches were compared before the user clarified the desired flat, request-last semantics. Candidate A's typed, central composer is the base; B contributes feature-owned renderers. After that clarification, neither candidate's nested-template behavior is retained. We retain A's literal template substitution and always append the request tail, accepting extra literal copies only when an authored template asks for them. Both candidates reject chaining whole-request transforms because Pi expands only one leading skill command. The pstack hook must also change to recognize a complete `$poteto-mode` token anywhere in user input.

The cross-judge preferred A with those grafts. A separate-family judge route was unavailable, so this judgment used an OpenAI model; it is not a cross-family verdict.

## Tradeoffs accepted

- We duplicate Pi's small skill-block formatter for multi-reference inputs to insert multiple skills without changing Pi core.
- We retain native expansion for exactly one skill. Inline templates become flat, request-last instruction blocks even when only one is referenced.
- Templates expand in full even if previously used, exchanging some context tokens for a simple compaction-safe contract.
- An authored template placeholder can duplicate request text inside its block while the original request remains at the tail. This preserves literal substitution rather than silently changing the template's meaning.
- Agents remain instructions to the model, not an extension-owned scheduler.
- One named entrypoint meets repository conventions and avoids a shared-registration bus, but loses upstream's independent category toggles. We can restore those with named category entrypoints if users need them.

## Alternatives considered

- Chaining upstream transforms exposes request ownership to every feature and leaves all but the first native skill command unexpanded.
- Replacing `$1` with a pointer to the tail would avoid duplication but break templates that embed literal request text. We reject it; a second copy is confined to templates with consuming placeholders.
- Asking the model to read named skills avoids direct block formatting but does not guarantee insertion and fails the motivating case.

## Open questions and risks

- Pstack currently detects only a leading `/skill:poteto-mode`. Change its input hook to recognize a complete `$poteto-mode` token anywhere in user-submitted input (not extension-generated input), before any later input handler rewrites it. Handler ordering is significant because Pi passes transformed text to later handlers. Confirm the root package's extension load order and test both registrations. Do not match `$poteto-mode-extra` or extension-generated input.
- Which agent tool schemas should `&agent` support here? Upstream checks for a top-level `agent` parameter, while the current `subagent` tool puts `agent` under `input`. Inspect the supported inventory and project-trust rules before claiming compatibility.
- Literal placeholders can repeat large requests, especially with several templates. This is template-authored behavior, not a hidden coordinator duplicate. Confirm the implementation tests the actual expansion size and documents the tradeoff.
- What should a missing or unreadable known resource do? The design proposes a visible diagnostic and the unchanged original request, rather than partially applying identifiers.

## Next implementation step

The implementation ports upstream with its license, adds the two-skill acceptance test and request-tail tests, then implements the coordinator and updates pstack's token-aware input hook. Test large lists, mixed kinds, duplicate and unknown tokens, literal template placeholders and intentional duplication, unreadable files, agent trust and schema, extension load order, and interactive editor coloring/autocomplete. Exercise the final message in a real Pi run, then run repository checks and code-quality scans against the fixed Lane base.
