# Audit

Audit answers two different questions. Standards asks whether the change follows the repository's documented standards. Spec asks whether the change meets its originating request. Keep the answers separate.

## Prepare the review packet

### Pin the artifact

1. Resolve the supplied fixed base and pinned head to commit SHAs. For a named PR, use its base and head SHAs.
2. Preserve three-dot scope. Run `git diff <fixed-base>...<pinned-head>` and resolve and record the merge base it uses. Record commits with `git log <fixed-base>..<pinned-head>`. Do not replace this with direct endpoint subtraction using two dots.
3. Ask for the base if the request omits it. Do not guess `main`, `HEAD`, or a merge base.
4. For a file or design review, pin the file contents by commit or record an immutable content digest. A design review without Git history can still use Challenge.
5. Record the exact resolved commands, commit list, changed-file list, and any scope exclusions.
6. Stop before launching children if a ref cannot resolve or the complete requested artifact is empty. An empty committed diff can still have requested WIP to review. Do not reject that WIP merely because no committed changes exist.

Review a named PR's committed change by default. Add local work in progress only when requested. When WIP is requested, include staged and unstaged tracked changes and every requested untracked file. A regular `git diff` omits staged and untracked content. Keep the committed change and local WIP evidence distinct so the packet does not duplicate or hide changes.

### Find the spec

Trace the request to its source. Check issue references in commits, user-provided paths, matching documents in `docs/`, `specs/`, or `.scratch/`, and the relevant issue tracker. Record the source URL or path, stable requirement reference, and the exact text that governs the change.

If no source is found and the user has not said that no spec exists, ask for the spec before reviewers start. If the user explicitly says there is no spec, mark Spec `SKIPPED (no spec available)`. Do not report Spec as passed or infer requirements from the implementation.

### Find the standards

Inspect the repository's maintained standards and applicable language guidance. Record each source's URL, path, revision, and relevant rule IDs. The implementation is not its own standard.

If a required standard source is missing, block the Standards axis and ask for the source. For a language with no adopted language standard, state `no language standard adopted for <language>; language-rule audit skipped.` Do not invent language rules. Keep Standards open for documented cross-language rules and the labelled Fowler heuristics below. Spec remains a separate axis.

For every standards finding, cite a stable rule ID, a source URL, the changed file and line, why the code breaks the rule, and a concrete fix. Use the source's published rule ID. If it has none, label the rule with a stable path and heading anchor. Do not invent an upstream rule number.

### Complete tool checks

Before reviewer children start, the parent runs every applicable check required by the standards and records its exact command and result. Inspect tool configuration. Confirm the check covers every changed and new file. Record completed checks with their diagnostics. Record unavailable, failed, incomplete, and inapplicable checks separately. A tool error or incomplete coverage is a gap, not a pass.

The parent gathers all spec and standards sources, exact tool output, and limitations into one frozen packet. Reviewer children receive that packet and read-only file pointers. They do not run Git or shell commands, edit or write files, or use MCP or extension tools.

## Select and run Audit reviewers

Choose one ordered Audit model lineup for both axes. Follow the caller's `model-routing`, spending, and family policy, plus any explicit user selection. Do not select separate model lists for Standards and Spec. If no private routing policy exists, inherit the parent model and report the actual resolved model and family.

Record requested selectors separately from actual selectors. Record every substitution. Do not silently claim a substituted model covers a required family. Missing required families, failed launches, timeouts, and missing outputs remain unresolved coverage.

Discover available agents with `subagent({ action: "list", input: { capabilities: true } })`. Launch the Audit children together in one `workflowScript` using `runs.all`. Each item uses `agent: "reviewer"`, `context: "fresh"`, a stable key, the prepared packet, and its resolved model selector. Count all children in the run's spawn budget. The parent synthesizes the returned reports.

For each selected model, launch two fresh reviewer children:

1. A Standards child that receives the exact frozen diff, relevant standards, completed diagnostics, and limitations. It reviews Standards only.
2. A Spec child that receives the exact frozen diff, originating spec, and relevant context. It reviews Spec only.

The children use the same ordered model lineup, but their contexts stay separate. Do not combine both axes in one child. Do not copy one model's answer to fill another model's missing coverage. If the user explicitly says that no spec exists, launch no Spec children and report the axis as skipped.

Each child inspects only the prepared artifact. Ask it to report supported findings, file and line, source evidence, and any gaps. A child's zero findings do not turn another missing or failed result into a pass.

## Review Standards findings

Start with documented rules. The repository's rule overrides general guidance. Skip a judgment heuristic when the repository endorses the pattern or a tool already enforces it. Label each heuristic finding as a possible smell, never a hard rule violation.

Include the twelve Fowler heuristics below in every Standards packet. They are judgment prompts, not hard rules. They remain subordinate to documented standards and tool results.

1. **Mysterious Name.** A function, variable, or type has a name that does not reveal what it does or holds. Rename it. If no honest name fits, clarify the design.
2. **Duplicated Code.** The same logic shape appears more than once in the change. Extract the shared shape and call it from both sites.
3. **Feature Envy.** A method reads another object's data more than its own. Move the method to the data it uses.
4. **Data Clumps.** The same fields or parameters travel together repeatedly. Group them in one type and pass that type.
5. **Primitive Obsession.** A primitive or string stands in for a domain concept that needs its own type. Give the concept a small type.
6. **Repeated Switches.** The same conditional on the same type recurs in the change. Replace it with polymorphism or one shared map.
7. **Shotgun Surgery.** One logical change forces scattered edits across many files. Gather the related behavior in one module.
8. **Divergent Change.** One file or module changes for several unrelated reasons. Split it so each module changes for one reason.
9. **Speculative Generality.** An abstraction, parameter, or hook serves a need the spec does not have. Delete it and inline the code until a real need appears.
10. **Message Chains.** A long chain such as `a.b().c().d()` exposes navigation the caller should not depend on. Hide the walk behind a method on the first object.
11. **Middle Man.** A class or function mostly delegates to another. Remove it and call the target directly.
12. **Refused Bequest.** A subclass or implementer ignores or overrides most of what it inherits. Replace inheritance with composition.

## Review Spec findings

Compare the implementation with each relevant requirement in the frozen spec. Cite the exact requirement and the changed file and line. Report missing or partial requirements, unrequested behavior, and implementations that appear wrong. Do not use code comments or the implementation itself as the spec.

## Synthesize and report coverage

The parent checks citations against the pinned packet and keeps disagreement visible. Report a finding total and the worst issue for Standards and Spec separately. Do not rank an issue in one axis against an issue in the other. Report each axis as findings, no findings, blocked, or skipped. `No findings` means the required review completed and found none. `Blocked` means required evidence or execution is missing. `Skipped` means the caller explicitly made the axis inapplicable.

Keep a review record in the response, not a new registry. Include:

- The intent, exact scope, pinned base and head or content digest, and spec provenance.
- The standards sources, diagnostics, and completed, blocked, skipped, or incomplete checks.
- The requested and actual model selectors, substitutions, required and covered families, and child failures.
- The finding total and worst issue within each axis, with no cross-axis ranking.
- Separate Standards and Spec results, findings, unresolved coverage, and the parent's disposition for each finding.
- Spec `SKIPPED (no spec available)` when the user explicitly declares that no spec exists.

Do not merge Standards and Spec into one verdict. Do not mark incomplete coverage as passed. Do not apply fixes during the review.
