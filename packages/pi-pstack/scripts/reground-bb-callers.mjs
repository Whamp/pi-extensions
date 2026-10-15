const BB_ROLE_GUIDANCE =
	"Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors.";

const BB_EFFORT_GUIDANCE =
	"**Match the model to the job.** Start from the role's configured reasoning level. Raise effort for difficult work and lower it for routine work only as permitted by `model-routing`, using Pi's supported `reasoningLevel` values. Verification keeps the configured `swarm workers` selection. Do not change provider or model selectors, family, role cardinality, or speed outside that policy. Do not construct Cursor speed or effort slugs. An omitted model, `inherit-parent`, or `auto` copies the resolved parent model and reasoning unchanged. Record requested and actual selections separately.";

const BB_MODEL_RECOVERY =
	"If an explicit model selector is unavailable, inspect `bb provider models pi` on the execution host and use only the recovery route permitted by `model-routing`. Do not select a family sibling or substitute an unrestricted worker. An `auto` or `inherit-parent` entry copies the resolved parent model and reasoning.";

const BB_READ_TOOLS = "tools `read`, `grep`, `find`, and `ls`";

const CALLER_REWRITES = [
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern: /^Bundled skills live at .*`poteto-agent` prompt\.$/m,
		replacement:
			"Bundled skills live at `../<name>/SKILL.md` from this file. Pass this file's absolute path to each BB Pi worker.",
	},
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern:
			/^\*\*Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step\*\*[^\n]*The chat that receives[^\n]*$/m,
		replacement:
			"**Use a fresh BB Pi worker for any delegated playbook step.** The receiving coordinator runs the playbook; do not delegate the whole playbook to a worker. Pass this skill path for Poteto behavior. Routed skills retain their own roles, models, and tools. Use `pi_worker`, not native Pi child runtimes.",
	},
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern: /^\*\*Match the model to the job\.\*\*[^\n]*$/m,
		replacement: BB_EFFORT_GUIDANCE,
	},
	{
		rel: "skills/how/SKILL.md",
		pattern: /^Every spawn is a Task subagent with[^\n]*$/m,
		replacement: BB_ROLE_GUIDANCE,
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/Spawn one explainer that explores and explains in one pass, built from `references\/explainer-prompt\.md` without the explorer-findings section\./,
		replacement: `Launch one fresh \`pi_worker\` using \`how explainer\` and ${BB_READ_TOOLS}. It explores and explains in one pass using \`references/explainer-prompt.md\` without the explorer findings.`,
	},
	{
		rel: "skills/how/SKILL.md",
		pattern: /^Decompose the question into 2 to 4 angles,[^\n]*$/m,
		replacement: `Decompose the question into 2 to 4 distinct exploration angles. Launch a fresh \`pi_worker\` per angle using \`how explorers\` and ${BB_READ_TOOLS}. Each gets \`references/explorer-prompt.md\` with its angle filled in. Launch all ready explorers without waiting for one to finish.`,
	},
	{
		rel: "skills/how/SKILL.md",
		pattern: /^Once all explorers have returned, spawn one explainer[^\n]*$/m,
		replacement: `Once all explorers finish, retrieve each full BB report. Launch a fresh \`pi_worker\` using \`how synthesizer\` and ${BB_READ_TOOLS}. Give it \`references/explainer-prompt.md\` with every explorer finding filled in.`,
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern: /^3\. Pick the runners\.[^\n]*`composer-\*`[^\n]*$/m,
		replacement:
			"3. Pick the runners. Use `arena runners` from `~/.pi/agent/pstack/models.json` when present. Otherwise use two inherit-parent candidates. Preserve configured cardinality and diversity. Spawn more runners for distinct design directions, or the same model N times for generation-bound work. Resolve effort through Poteto Mode's Subagents section. " +
			BB_MODEL_RECOVERY,
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^Spawn all N subagents in one message[^\n]*produce the artifact and a short rationale[^\n]*$/m,
		replacement:
			"Launch N fresh `pi_worker` candidates without waiting between launches. Each gets its `arena runners` model, task, shared grounding path, and its own isolated workspace and output path. Give the tools required to create and verify its artifact. Require a short rationale naming the alternatives it considered and what it rejected. Record every BB thread ID.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^After all Phase B candidates complete,[^\n]*Don't spawn it while candidates are still writing\.$/m,
		replacement: `After all Phase B candidates finish, select one model from \`arena judge pool\` in \`~/.pi/agent/pstack/models.json\` when configured. Otherwise inherit the resolved parent Pi model. Prefer a different family within permitted model policy. Launch a fresh \`pi_worker\` judge with ${BB_READ_TOOLS}. It reads the rubric and completed candidate paths, scores every criterion, and recommends a base. Read the artifacts in BB while it runs. Never launch the judge while candidates are writing.`,
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^Before fanning out, find this conversation's transcript[^\n]*\n\n```bash\n[\s\S]*?\n```\n\nThat covers the legacy flat[^\n]*$/m,
		replacement:
			"Before fanning out, prefer `$PI_SESSION_FILE` for the current conversation. Otherwise use `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each slash replaced by a hyphen. Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. Confirm the opening user prompt in a candidate's first user message. If no transcript matches, pass a tight digest instead.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern: /^One message, three `Task` calls,[^\n]*readonly strips MCPs\.$/m,
		replacement:
			"Launch three fresh `pi_worker` reviewers without waiting between launches, one per lens using the table below. Allow read/search and the specific research/MCP tools needed to check transcript references, but not file-writing tools. Pi tool allowlists do not inherently strip MCP access. Record their BB thread IDs.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern: /^One `Task` call,[^\n]*It spot-verifies citations through MCP[^\n]*$/m,
		replacement:
			"After all reviewers finish, retrieve their full BB reports and launch a fresh `pi_worker` using `reflect synthesizer`. Allow read/search and the research tools needed to spot-check citations. Use `references/synthesizer.md` verbatim with each full review inlined. It returns Accepted / Rejected / Backlog lists. The coordinator checks the synthesis against the evidence.",
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern: /^4\. Pick the worker model from [^\n]*Pick each subagent's reasoning[^\n]*$/m,
		replacement:
			"4. Pick the worker model from `swarm workers` in `~/.pi/agent/pstack/models.json` when present. Otherwise use inherit-parent. For a model race, name each arm's model up front. Resolve effort through Poteto Mode's Subagents section. " +
			BB_MODEL_RECOVERY,
	},
	{
		rel: "skills/why/SKILL.md",
		pattern: /^Every spawn is `generalPurpose` with[^\n]*$/m,
		replacement:
			"Each fresh `pi_worker` gets read/search and the specific research/MCP tools for its evidence category. Investigators and the synthesizer inspect only and must not modify files. Native Pi tool selection does not inherently strip MCP access.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern: /^Spawn one investigator per category that has a matching MCP,[^\n]*$/m,
		replacement:
			"Launch one fresh `pi_worker` per category with source-control evidence or a matching research tool, without waiting between launches. Use `why investigators`. Each owns exactly one evidence category and performs its own permitted lookups. Always include source control. Record null results and gaps.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern: /^Spawn one synthesizer\. `model`:[^\n]* It gets:$/m,
		replacement:
			"After all investigators finish, retrieve every full BB report. Launch a fresh `pi_worker` using `why synthesizer`, with read/search and the research tools needed to spot-check citations. It gets:",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^Launch all reviewers in a single message with the Task tool,[^\n]*$/m,
		replacement:
			"Launch fresh `pi_worker` reviewers without waiting between launches. Use `interrogate reviewers`, one reviewer per configured entry, labeled Reviewer A, B, and so on. Otherwise use the table defaults. Retrieve every full report before synthesis.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^Each reviewer gets `subagent_type: generalPurpose`,[^\n]*$/m,
		replacement: `Each reviewer uses \`interrogate reviewers\`, its configured model, and ${BB_READ_TOOLS}, plus specifically required read-only research tools. Instruct it to inspect only and not modify files. Omit \`model\` for an \`auto\` or \`inherit-parent\` entry.`,
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^If the Task tool rejects a configured entry,[^\n]*`composer-\*`[^\n]*$/m,
		replacement: BB_MODEL_RECOVERY,
	},
	{
		rel: "skills/no-comments/SKILL.md",
		pattern: /^1\. Spawn `Task` with `subagent_type: "comment-sicko"`\.[^\n]*$/m,
		replacement:
			"1. Launch a fresh `pi_worker` for Comment Sicko. Pass `../../agents/comment-sicko.md` relative to this skill directory and the scope. The worker reads that prompt and does not delegate further. Allow read/search tools, plus edit/write only when fixing comments is assigned. Resolve effort through Poteto Mode's Subagents section. Do not restate its rules.",
	},
	{
		rel: "skills/ketchup/SKILL.md",
		pattern: /a chart or diagram from `\/visualize`/g,
		replacement: "a chart or diagram shown with BB's `inline-vis` skill",
	},
	{
		rel: "skills/ketchup/SKILL.md",
		pattern: /a `\/visualize` chart/g,
		replacement: "an `inline-vis` chart",
	},
];

/** Adapt current Cursor caller paragraphs without changing unrelated upstream prose. */
export function adaptBbCallerGuidance(text, rel) {
	for (const entry of CALLER_REWRITES) {
		if (entry.rel === rel) {
			text = text.replace(entry.pattern, entry.replacement);
		}
	}
	return text;
}
