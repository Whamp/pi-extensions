# Implement multiple inline identifiers

Implement the [composition design](inline-identifier-composition.md) in the existing Lane worktree. Keep this as one code-coupled change. The resulting package accepts any number of recognized `$skill`, `&agent`, and `/template` references in one user prompt. It emits instruction blocks in first-mention order and keeps the original request at the tail. Pstack makes `$poteto-mode` sticky when the token appears anywhere in user-submitted input.

## Confirm the boundaries

- [ ] Record the Lane base commit and inspect the worktree status. Keep all implementation in `.lane/trees/inline-identifiers`.
- [ ] Recheck Pi's installed `input` handler order and native skill expansion. Confirm that the root manifest loads pstack before the new inline extension, so pstack sees the original `$poteto-mode` token. Check noninteractive input sources too.
- [ ] Inspect the installed `subagent` tool schema and inventory. Choose and test the supported `&agent` discovery path, including project trust, before claiming agent support. Do not assume upstream's top-level `agent` parameter exists here.
- [ ] Capture the upstream package revision, license, and existing tests. Note which upstream behaviors change under the flat request-last contract.

## Port the package and prove the baseline

- [ ] Create `packages/pi-inline-identifier` at `0.0.0`. Preserve the upstream MIT license and attribution. Add `extensions/inline-identifier/index.ts` as a re-export of `src/index.ts`. List that named entrypoint in both package manifests and the root manifest.
- [ ] Port the upstream skill, agent, prompt, and editor behavior with its characterization tests. Do not load the upstream package and this port in the same Pi session.
- [ ] Run the ported tests and `scripts/root-pi-package.test.mjs` before changing the routing policy. Fix port errors before adding multi-identifier behavior.

## Compose one request from many references

- [ ] Add a failing acceptance test for `$poteto-mode $teach ...`. Assert that both skill bodies appear once, in mention order, and the unchanged original request appears at the tail.
- [ ] Represent resolved references as a discriminated union with source offsets. Match only original input, sort by first offset, and deduplicate by category and canonical name. Preserve unknown text and the upstream token-boundary rules.
- [ ] Give one coordinator ownership of the final user message. Keep Pi's native expansion for exactly one skill. For multiple skills, render the same skill blocks Pi renders; Pi expands only one leading `/skill:name`. Insert agent and template instruction blocks at their mention positions, then append the original request section. Do not rescan generated content.
- [ ] Keep literal `$1`, `$@`, `$ARGUMENTS`, default, and slice substitutions inside template blocks. The request still appears at the tail. Document that a template consuming a placeholder intentionally creates another literal copy. Never add a copy inside a template that did not request one.
- [ ] Expand templates in full for composed prompts. Do not reuse a whole-message reminder whose context guard cannot recognize instruction blocks. Keep images attached and avoid partial output if a recognized resource cannot be read. Emit a useful diagnostic and pass through the original input on failure.
- [ ] Test repeated identifiers, 20 or more distinct identifiers, same names in different categories, mixed-category order, missing files, template placeholders, unknown tokens, native leading slash commands, and extension-generated input. Preserve autocomplete and coloring.

## Enable Poteto Mode from an inline token

- [ ] Update `packages/pi-pstack/extensions/pstack/index.ts` to recognize a complete `$poteto-mode` token anywhere in user-submitted input. Preserve existing leading `/skill:poteto-mode` handling and `/poteto-mode off`. Ignore extension-generated input and partial names such as `$poteto-mode-extra`.
- [ ] Add tests for a token at the start, middle, and end; a longer name; extension-generated input; and the composed two-skill case. Confirm that pstack sees the original token under the actual extension load order. Avoid triggering mode because the token appears only in an inserted skill or template body.

## Verify the integration and finish

- [ ] Run package tests, pstack tests, the root package manifest test, and repository checks. Run `oxfmt` and `oxlint` on changed TypeScript, and a strict type check where the package's toolchain supports it.
- [ ] In a real Pi session with only the port enabled, inspect the message at the model-call boundary for the two-skill acceptance case and a mixed skill, agent, and template case. Exercise editor completion and coloring in the interactive TUI. Compare the message with the expected order and request tail; tests alone do not prove this flow.
- [ ] Verify sticky mode persists to the next turn and `/poteto-mode off` clears it. Verify a native `/skill:teach` and a native leading prompt command still behave as before.
- [ ] Inspect the final diff against the coding standards. Run `AISLOP_NO_TELEMETRY=1 aislop doctor` and `aislop scan --changes --base <fixed-base> --json`, plus `slop-scan delta` against a worktree at the same fixed base. Investigate findings rather than treating tool exit status as proof.
- [ ] Update the package README with syntax, ordering, duplicate-placeholder semantics, sticky Poteto behavior, known agent-tool compatibility, and the requirement to disable the upstream package. Record what was exercised and any unverified environment-specific behavior.

Each group ends with a runnable check before the next group starts. Do not commit or publish until the composed input and sticky mode have both been observed in Pi.
