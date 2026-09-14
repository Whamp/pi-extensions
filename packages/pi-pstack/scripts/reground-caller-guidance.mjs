const PI_CALLER_GUIDANCE_REPLACEMENTS = [
	{
		rel: "skills/no-comments/SKILL.md",
		pattern:
			/^1\. Spawn `Task` with `subagent_type: "Comment Sicko"`\. Pass the scope\. Do not restate its rules\.$/m,
		replacement:
			'1. Spawn Comment Sicko with `subagent({ action: "execute", input: { agent: "comment-sicko", task, async: false } })`. Put the scope in `task`. Do not restate its rules.',
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem\. Spawn all explorers in a single message:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explorer model \(default `grok-4\.6-fast-xhigh`\)\n- `readonly`: `true`\n\nEach explorer gets the prompt in `references\/explorer-prompt\.md` with its angle filled in\. Then go to Step 3\.$/m,
		replacement:
			'Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Launch the explorers and dependent explainer with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N + 1, workflowScript } })` call. In `workflowScript`, await `runs.all([{ key: "explore-<angle>", agent: "worker", task, model }])`, then return `runs.run("explain", { agent: "worker", task, model })` with the explorer outputs.\n\nEach explorer uses:\n- agent: "worker"\n- `model`: `how explorers` (default inherit-parent)\n- `task`: the prompt in `references/explorer-prompt.md` with its angle filled in and an instruction to inspect only\n\nThen go to Step 3.',
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Spawn one Task subagent that explores and explains in one pass:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explainer model \(default `claude-fable-5-1-thinking-max`\)\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` without the explorer-findings section\. Go to Step 4\.$/m,
		replacement:
			'Launch one standalone child with `subagent({ action: "execute", input: { agent: "worker", task, model, async: false } })` using:\n- agent: "worker"\n- `model`: `how explainer` (default inherit-parent)\n- `task`: `references/explainer-prompt.md` without the explorer-findings section and with an instruction to inspect only\n\nGo to Step 4.',
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Once all explorers have returned, spawn one Task subagent to synthesize their findings into one explanation:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explainer model \(default `claude-fable-5-1-thinking-max`\)\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` with every explorer's findings filled in\.$/m,
		replacement:
			'The same workflow launches `explain` after every explorer settles using:\n- agent: "worker"\n- `model`: `how synthesizer` (default inherit-parent)\n- `task`: `references/explainer-prompt.md` with every explorer result filled in and an instruction to inspect only',
	},
	{
		rel: "skills/poteto-mode/playbooks/multi-phase-plan.md",
		pattern: /a real terminal `\/loop`/,
		replacement: "a recurring wake",
	},
	{
		rel: "skills/poteto-mode/playbooks/multi-phase-plan.md",
		pattern: /`control-ui` or `control-cli` from `cursor-team-kit`/,
		replacement: "the project's verification skill or harness",
	},
	{
		rel: "skills/poteto-mode/playbooks/multi-phase-plan.md",
		pattern:
			/^3\. Explore in subagents with `subagent_type: "poteto-agent"` and an explicit model per the Subagents section \(the \*\*guard-the-context-window\*\* principle skill\)\. Each returns file pointers, conventions, test commands, and entry points\. No inlined dumps\.$/m,
		replacement:
			'3. Explore in subagents with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N, workflowScript } })` call and an explicit model per child from the Subagents section (the **guard-the-context-window** principle skill). In `workflowScript`, launch the explorers with `return await runs.all([{ key: "explore-<slice>", agent: "poteto-agent", task, model }])`. Each returns file pointers, conventions, test commands, and entry points. No inlined dumps.',
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^Spawn all N subagents in one message with `run_in_background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale\.$/m,
		replacement:
			'Launch the candidates with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N, workflowScript } })` call. In `workflowScript`, use `return await runs.all([{ key: "candidate-1", agent: "worker", task, model }])`. Give each candidate the shared grounding path, its own output path, and instructions to produce the artifact and a short rationale.',
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^After all Phase B candidates complete, choose one model from the `arena cross-judge pool` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use `claude-fable-5-1-thinking-max`, `gpt-5\.6-sol-max`, `grok-4\.6-fast-xhigh`, `claude-opus-5-thinking-xhigh`\. Prefer a different model family from the parent's\. Spawn one readonly judge subagent on that model\. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale\. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves\. Don't spawn the judge while candidates are still writing\.$/m,
		replacement:
			"After the Phase B workflow completes, choose one model from the `arena judge pool` in `~/.pi/agent/pstack/models.json` when present. Otherwise use inherit-parent. Prefer a different model family from the parent's. Launch the judge with `subagent({ action: \"execute\", input: { agent: \"worker\", task, model, async: true } })`. Its task says to inspect only, read the rubric and candidates by path label, score each criterion, and recommend a base with rationale. Read the completed candidate artifacts while the judge runs. The judge never runs while candidates are writing.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record\.$/m,
		replacement:
			"If a candidate fails to produce output, pass the completed N-1 results to the judge and note the dropout in the synthesis record.",
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern:
			/^Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the configured model\. Use `environment: "local"` only when the worker needs access to something on the user's computer\.$/m,
		replacement:
			'Launch all N workers with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N, workflowScript } })` call. In `workflowScript`, use `return await runs.all([{ key: "worker-<slice>", agent: "worker", task, model }])`. Give each worker a stable key and the configured model. Omit `model` when the role inherits the parent.',
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern:
			/^When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\.$/m,
		replacement:
			"Set `input.cwd` to an existing checkout. To create a managed checkout from a Git ref, set `input.worktree: true` and `input.baseRef`.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^One message, three `Task` calls, `subagent_type: generalPurpose`, explicit `model:` on each, agent mode \(`readonly: false`\)\. Reviewers need MCP access for context lookups \(tickets, chat threads, observability traces referenced in the transcript\)\. Readonly strips MCPs\.$/m,
		replacement:
			'The parent resolves any ticket, chat, document, observability, error-tracker, or analytics references from the transcript before launch. Put the transcript path and fetched evidence in one bounded digest. Children do not inherit the parent\'s MCP or extension tools.\n\nLaunch all three reviewers and the dependent synthesizer with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: 4, workflowScript } })` call. In `workflowScript`, await the three reviewers with `runs.all([{ key: "judgment-review", ... }, { key: "tooling-review", ... }, { key: "divergent-review", ... }])`, then return `runs.run("synthesize-reviews", { ... })` with their outputs.',
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^Pass each template verbatim, substituting the transcript path or digest where marked\. Reviewers return findings in the `Task` response body\.$/m,
		replacement:
			'Each reviewer item uses `agent: "worker"`, its configured model, and a task that says to inspect only. Pass each template verbatim, substituting the transcript path or the bounded digest where marked. Reviewers return findings through their workflow results.',
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^One `Task` call, `subagent_type: generalPurpose`, using your configured reflect-judgment model \(default `claude-fable-5-1-thinking-max`\), agent mode \(`readonly: false`\)\. The synthesizer's quality check includes spot-verifying citations, which can require MCP access\. Readonly strips MCPs\. Use `references\/synthesizer\.md` verbatim, with each reviewer's full output inlined where marked\. The synthesizer returns a structured Accepted \/ Rejected \/ Backlog list\.$/m,
		replacement:
			'The workflow\'s `synthesize-reviews` child uses `agent: "worker"`. It runs using `reflect synthesizer` (default inherit-parent). Use `references/synthesizer.md` verbatim, with each reviewer\'s full output inlined where marked. It returns a structured Accepted / Rejected / Backlog list. After the workflow completes, the parent spot-verifies citations with its own MCP and extension tools.',
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Before spawning investigators, list the available MCPs from the Cursor environment\. Use the available-tools map when present\. Otherwise inspect the `mcps\/` directory Cursor exposes for enabled MCP servers\.\n\nMap each available MCP to one evidence category:$/m,
		replacement:
			"Before spawning investigators, the parent lists its available MCP and extension tools. Map each available provider to one evidence category:",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Aim for a complete \*\*coverage map\*\*, not a minimal one\. Document the null, don't skip the search\.$/m,
		replacement:
			"Aim for a complete **coverage map**, not a minimal one. Document the null, don't skip the search. The parent queries each available MCP and builds one bounded evidence packet per category before launching children. A child does not inherit ambient MCP or extension tools. Use a custom agent for a child-side lookup only when that agent explicitly lists the tool and loads its provider through `extensions` or `subagentOnlyExtensions`.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Launch all matching investigators in a single message so they run concurrently\. Don't ask one agent to cover multiple MCPs\.$/m,
		replacement:
			'Launch all matching investigators and the dependent synthesizer with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N + 1, workflowScript } })` call. In `workflowScript`, await the investigators with `runs.all([{ key: "investigate-<category>", agent: "worker", task, model }])`, then return `runs.run("synthesize-why", { agent: "worker", task, model })` with their outputs. `N` is the number of evidence categories launched. Don\'t ask one agent to cover multiple categories.',
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Subagent config \(each\):\n- `subagent_type`: `generalPurpose`\n- `model`: your configured why-investigators model \(default `grok-4\.6-fast-xhigh`\)\n- `readonly`: `false` \(agent mode\)\. \*\*Do not use readonly\/Ask mode\.\*\* It strips MCP access, which disables MCP-backed investigators entirely\. Investigators still shouldn't write anything\.$/m,
		replacement:
			'Each investigator uses:\n- agent: "worker"\n- `model`: `why investigators` (default inherit-parent)\n- `task`: instruct the investigator to inspect only',
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Each investigator gets:\n1\. The base prompt from `references\/investigator-prompt\.md`\n2\. The category playbook `references\/sources\/<source>\.md` for the selected MCP, adapted from the examples in `references\/source-playbook\.md`\n3\. The cross-cutting `references\/sources\/incident-postmortem\.md` \*\*if the target code looks defensive\*\* \(null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers\)\n4\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n5\. The user's original question\n\n(?=### Investigator roster)/m,
		replacement:
			"Each investigator gets:\n1. The base prompt from `references/investigator-prompt.md`\n2. The category playbook `references/sources/<source>.md` as an analysis rubric for the parent's evidence packet, not as child tool instructions\n3. The parent's evidence packet for that category, including null results and gaps\n4. The cross-cutting `references/sources/incident-postmortem.md` **if the target code looks defensive** (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers)\n5. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)\n6. The user's original question\n\n",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Spawn one investigator per category that has a matching MCP\. Each owns exactly one tool or MCP\.$/m,
		replacement: "Spawn one investigator per category with source-control evidence or a matching parent MCP. Each owns exactly one evidence packet.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Spawn one synthesizer subagent:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured why-synthesizer model \(default `claude-fable-5-1-thinking-max`\)\n- `readonly`: `false` \(agent mode\)\. The synthesizer's quality check spot-verifies citations, which can require MCP access\. Readonly\/Ask mode strips MCPs and defeats that\.\n\nThe synthesizer gets:\n1\. The investigator findings, including any null results and any categories skipped with justification\n2\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n3\. The user's original question\n4\. The epistemics framework from `references\/epistemics\.md`\n5\. The synthesizer prompt template from `references\/synthesizer-prompt\.md`$/m,
		replacement:
			'The same workflow launches `synthesize-why` after every investigator settles. It uses:\n- agent: "worker"\n- `model`: `why synthesizer` (default inherit-parent)\n\nThe synthesizer gets:\n1. The investigator findings, including any null results and any categories skipped with justification\n2. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)\n3. The user\'s original question\n4. The epistemics framework from `references/epistemics.md`\n5. The synthesizer prompt template from `references/synthesizer-prompt.md`\n\nAfter the workflow completes, the parent spot-verifies citations with its own MCP and extension tools before presenting the result.',
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/^Launch all reviewers in a single message using the Task tool\. Use the `interrogate reviewers` list from `~\/\.cursor\/rules\/pstack-models\.mdc` when present, one reviewer per entry, extending or shrinking the Reviewer A\/B\/C\/D labels below to the configured entry count\. Otherwise use the table defaults\.$/m,
		replacement:
			'Launch all reviewers with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N, workflowScript } })` call. In `workflowScript`, use `return await runs.all([{ key: "reviewer-a", agent: "worker", task, model }])` with one stable-keyed item per reviewer. Use the `interrogate reviewers` list from `~/.pi/agent/pstack/models.json` when present, one reviewer per entry, extending or shrinking the Reviewer A/B/C/D labels below to the configured entry count. Otherwise use the table defaults.',
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^- `readonly`: `true`$/m,
		replacement: "- `task`: instruct the reviewer to inspect only and not modify files",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/^If a model slug is rejected as unresolvable when you try to spawn the subagent, check the valid slugs in the Task tool's error message, pick the closest equivalent \(prefer the highest-reasoning tier of the same family\), spawn with the valid slug, and open a separate PR to update the configured value or default table\. Do not block the review on the slug issue\. If the configured value is `inherit-parent` or `auto`, omit `model` instead\. Never treat those aliases as broken slugs or enter this fallback for them\.$/m,
		replacement:
			"If an explicit model selector is unavailable, inspect `subagent({ action: \"models\", input: {} })`, pick the closest available model (prefer the highest-reasoning tier of the same family), and relaunch. Explicit selectors do not fall back. Open a separate PR to update a stale configured value or default table. Do not block the review on a stale selector. If the configured value is `inherit-parent` or `auto`, omit `model`; never treat those aliases as broken selectors or enter this fallback for them.",
	},
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern:
			/^\*\*Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step\*\* \(code-writing delegates, ad-hoc helpers\)\. `\/poteto-mode` and `poteto-agent` route through the same wrapper\. Routed workflow skills \(`how`, `why`, `interrogate`, `reflect`, `swarm`\) set their own `subagent_type` for diverse-model review\. Respect what the skill prescribes, don't override to `poteto-agent`\.$/m,
		replacement:
			'**Use `subagent({ action: "execute", input: { agent: "poteto-agent", task } })` for one standalone child inside a playbook step.** Put every operation field under `input`. `/poteto-mode` and `poteto-agent` route through the same wrapper. Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set their own agent for diverse-model review. Respect what the skill prescribes. Do not override it with `poteto-agent`.',
	},
	{
		rel: "skills/poteto-mode/playbooks/opening-a-pr.md",
		pattern:
			/Multiple `Task` calls on the same branch each get their own worktree, or `git fetch && git reset --hard origin\/<branch>` between them\./,
		replacement:
			"Multiple `subagent()` launches on the same branch use `input.worktree: true` with `input.baseRef` for separate managed checkouts. When reusing one existing checkout, serialize the launches and run `git fetch && git reset --hard origin/<branch>` between them.",
	},
	{
		rel: "skills/poteto-mode/playbooks/opening-a-pr.md",
		pattern: /`\/deslop` from `cursor-team-kit`/,
		replacement: "`/skill:deslop`",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern: /Agents are spawned, resumed, and drained only through the Task tool\./,
		replacement:
			'Launch one child with `subagent({ action: "execute", input: { agent, task, async: true } })`. Launch each parallel or dependent wave with one execute call whose `input.workflowScript` uses stable-keyed `runs.run` and `runs.all` steps.',
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/ \(nesting works to depth 3, and a nested spawn has the full Task schema including `environment`\)/,
		replacement:
			'. Nesting works to depth 3. A custom sub-coordinator agent must list `subagent` in its tool allowlist. It must also list each extension tool and load its provider through `extensions` or `subagentOnlyExtensions`',
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/- \*\*Worker \/ verifier\.\*\* Always `environment: "cloud"` unless the task needs this machine: `control-ui` or `control-cli` runtime verification \(from `cursor-team-kit`\)\. Reading local transcripts under `agent-transcripts\/`\. Simulators and local IDE state\. Auth that exists only here\. Cloud agents cannot read the local store, so their briefs inline what they need or point at repo paths\. Prefer fewer, broader workers\. One writer per worktree or branch \(principle-separate-before-serializing-shared-state\)\. Run a unit's verifier on a different model family from its worker\./,
		replacement:
			"- **Worker / verifier.** Set `input.async: true` for background work. Set `input.cwd` when the task needs a specific checkout, local transcript, simulator, IDE state, or machine-local auth. Briefs inline what an external provider needs or point at repository paths it can read. Prefer fewer, broader workers. One writer per worktree or branch (principle-separate-before-serializing-shared-state). Run a unit's verifier on a different model family from its worker. A role's model line selects only the model. It does not grant tools or extensions.",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^Size the brief to the unit\. A one-command unit gets the template collapsed to a paragraph that still names goal, scope, the verify command, and the report shape\. A 4KB scaffold around a two-line edit costs more to write and obey than the edit\. Local spawns may reference the standing-orders file by store path\. Verbatim paste is for cloud spawns and every resume\.$/m,
		replacement:
			"Size the brief to the unit. A one-command unit gets the template collapsed to a paragraph that still names goal, scope, the verify command, and the report shape. A 4KB scaffold around a two-line edit costs more to write and obey than the edit. Children with access to the store may reference the standing-orders file by path. Paste it verbatim for external-provider launches and every resume.",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^A sub-coordinator brief adds its track boundary and unit list, its spawn budget with the cloud default and the local exception list, the drain protocol, and the rollup format \(per child: name, status, PR, head SHA, verdict, one line, plus track status and frontier delta\)\.$/m,
		replacement:
			"A sub-coordinator brief adds its track boundary and unit list, its spawn budget with the async default and blocking exceptions, the drain protocol, and the rollup format (per child: name, status, PR, head SHA, verdict, one line, plus track status and frontier delta).",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^- Exactly one stacker per stack may run `gt`, serialized within its stack\. Record the holder in the standing orders\. Restacks run in cloud\. A local restack at this scale takes the laptop down\.$/m,
		replacement:
			"- Exactly one stacker per stack may run `gt`, serialized within its stack. Record the holder in the standing orders. Run restacks as async children. A blocking restack at this scale takes the laptop down.",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^- Never resume an agent to check on it\. A resume restarts an idle agent\. Probe read-only: the ledger, `units\.tsv`, `gh`, pushed branches, the cloud agent's status in the Cursor dashboard\. Transcript mtime is not liveness\.$/m,
		replacement:
			'- Never resume an agent to check on it. A resume restarts an idle agent. Probe without mutation through the ledger, `units.tsv`, `gh`, pushed branches, and `subagent({ action: "status", input: { id } })`. Transcript mtime is not liveness.',
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^- After a Cursor restart: local agents are dead, cloud work is not\. Re-read the standing orders and `units\.tsv`, recompute the frontier, reattach cloud work by PR and branch rather than agent id, respawn one sub-coordinator per track from its stored brief plus current state, drain, resume\. The dead session's store lock clears itself on the next write\. `orch` replaces a lock whose holder pid is gone\.$/m,
		replacement:
			"- After a Pi restart, re-read the standing orders and `units.tsv`, query retained async runs, recompute the frontier, reattach work by PR and branch rather than agent id, respawn one sub-coordinator per track from its stored brief plus current state, drain, and resume. The dead session's store lock clears itself on the next write. `orch` replaces a lock whose holder pid is gone.",
	},
	{
		rel: "skills/poteto-mode/playbooks/orchestrate.md",
		pattern:
			/^4\. \*\*Scale\.\*\* Spawn a rolling window of workers up to the in-flight cap, refilling as children finish\. Blocking batches pay the slowest child of every batch\. Spawn track sub-coordinators only past the one-drain threshold in Roles\. Recompute ready work after each drain\. Relay upstream reports into downstream briefs\. Keep sibling communication upward only\. The sampled brief audit runs alongside the wave it samples and stops the next refill on failure, not the current one\.$/m,
		replacement:
			'4. **Scale.** Spawn a rolling window of workers up to the in-flight cap, refilling as children finish. Launch each refill with one `subagent({ action: "execute", input: { async: true, maxSubagentSpawnsPerRun: N + V, workflowScript } })` call. In `workflowScript`, use `return await runs.all([{ key: "<unit-id>", agent, task, model }])` for a ready-only wave. For a predeclared verifier wave, await the N workers with `runs.all([{ key: "<unit-id>", agent, task, model }])`, then use `return await runs.all([{ key: "<unit-id>-verify", agent, task, model }])` with one stable-keyed item for each of the V dependent verifiers. `N` is the ready worker count and `V` is the verifier count. Blocking batches pay the slowest child of every batch. Spawn track sub-coordinators only past the one-drain threshold in Roles. Recompute ready work after each drain. Relay upstream reports into downstream briefs. Keep sibling communication upward only. The sampled brief audit runs alongside the wave it samples and stops the next refill on failure, not the current one.',
	},
];

/** Rewrite executable caller guidance to the stateless catalog and keyed workflow DSL. */
export function applyPiCallerGuidanceTransforms(text, rel) {
	for (const replacement of PI_CALLER_GUIDANCE_REPLACEMENTS) {
		if (replacement.rel === rel) {
			text = text.replace(replacement.pattern, replacement.replacement);
		}
	}
	return text;
}

