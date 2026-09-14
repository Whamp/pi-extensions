import { applyPiCallerGuidanceTransforms } from "./reground-caller-guidance.mjs";
import { SEAMS } from "./reground-generic-seams.mjs";
import { DISCOVERABLE } from "./reground-path-policy.mjs";

const CURSOR_FRONTMATTER_KEYS = new Set(["mode", "icon", "color", "reminder", "paths"]);

const POTETO_INTRO = [
	"`/poteto-mode` enables this mode for the rest of the session.",
	"`/poteto-mode off` disables it.",
	"`/skill:poteto-mode` also enables it.",
	"The role table is injected from `~/.pi/agent/pstack/models.json` only when a role has a real model slug.",
	"",
	"",
].join("\n");

const SUBAGENT_DEFAULTS = [
	'**Defaults for every child launch.** Set `input.async: true` for background work. Pass file pointers instead of inlining context. Select an explicit model per role when `/setup-pstack` configures one. Multiple children or dependent stages use one `subagent({ action: "execute", input: { workflowScript, ... } })` call. Inside the script, use `await runs.all([{ key: "stable-key", ... }])` for fan-out and `return runs.run("stable-key", { ... })` for a direct or final child. Count every later synthesis or review child in `input.maxSubagentSpawnsPerRun` when the workflow sets that limit.',
	"A child does not inherit ambient MCP or extension tools. Keep MCP lookup in the parent for `why`, `reflect`, and `interrogate` unless the selected custom agent lists the tool and loads its provider through `extensions` or `subagentOnlyExtensions`. Do not invent per-call tools.",
	"Defaults inherit-parent. Ordinary judgment uses `judgment`. User-facing writing uses `prose`. Escalated difficult work uses `hardest tasks`. Implementation playbooks use `feature implementation`, `refactoring implementation`, `bug-fix`, `perf-issue`, and `hillclimb`. Role lines choose only the model. They never grant tools, authority, or isolation. Code delegates tier by difficulty. The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms) go to `hardest tasks` when configured, else the parent model, whether the task needs judgment on vague intent or is a precisely specified sequence of steps to execute to the letter. Trivial mechanical edits go to your fast code model. Per-role lines in the injected pstack role table override these defaults and the model choices in the routed skills (`how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`). A role with no line keeps its default, and a role line of `inherit-parent` or `auto` runs that role on the parent chat model. Omit `model` in that case.",
].join("\n\n");

const RETIRED_POTETO_EVIDENCE_BULLET =
	"- **Every claim carries its evidence or its label in the same sentence.** Measured, inferred, or guess. A prediction or an unseen cause is a guess. Never hand the human a check you could run.";

export function patchPotetoModePi(text) {
	if (!text.includes("`/poteto-mode` enables this mode")) {
		text = text.replace("# Poteto mode\n\n", `# Poteto mode\n\n${POTETO_INTRO}`);
	}
	text = text.replace(/\*\*Defaults for every `Task` call\.\*\*[^\n]*/, SUBAGENT_DEFAULTS);
	return text.replace(`${RETIRED_POTETO_EVIDENCE_BULLET}\n`, "");
}

function frontmatterKey(line) {
	const i = line.indexOf(":");
	return i === -1 ? "" : line.slice(0, i).trim();
}

export function applyFrontmatterPolicy(text, skillDir) {
	if (!text.startsWith("---\n")) return text;
	const close = text.indexOf("\n---\n", 4);
	if (close === -1) return text;
	const body = text.slice(close + "\n---\n".length);
	const lines = text
		.slice(4, close)
		.split("\n")
		.map((line) => line.replace(/^name:\s*"?Poteto Mode"?\s*$/, "name: poteto-mode"))
		.filter((line) => {
			const key = frontmatterKey(line);
			if (CURSOR_FRONTMATTER_KEYS.has(key)) return false;
			if (key === "disable-model-invocation") return false;
			return true;
		});
	if (!DISCOVERABLE.includes(skillDir)) {
		lines.push("disable-model-invocation: true");
	}
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

const ATOMIC_ROLE_REPLACEMENTS = [
	[/`arena cross-judge pool`/g, "`arena judge pool`"],
	[/your configured feature model/g, "the `feature implementation` role"],
	[/your configured refactoring model/g, "the `refactoring implementation` role"],
	[/your configured bug-fix model/g, "the `bug-fix` role"],
	[/your configured perf-issue model/g, "the `perf-issue` role"],
	[/your configured hillclimb model/g, "the `hillclimb` role"],
	[/your configured how-explorer model/g, "`how explorers`"],
	[/your configured why-investigators model/g, "`why investigators`"],
	[/your configured why-synthesizer model/g, "`why synthesizer`"],
	[/your configured reflect-tooling model/g, "`reflect tooling reviewer`"],
	[
		/Use your configured architect runners \(defaults inherit-parent\)\./g,
		"Override Arena's candidate selector with `architect runners` (defaults inherit-parent). Require at least two candidates. The Arena judge still uses `arena judge pool`.",
	],
];

/** Rewrite upstream role prose to the atomic Pi schema, with file-specific How and Reflect splits. */
export function applyAtomicRoleTransforms(text, rel) {
	for (const [cursor, pi] of ATOMIC_ROLE_REPLACEMENTS) {
		text = text.replace(cursor, pi);
	}
	if (rel === "skills/how/SKILL.md") {
		text = text.replace(
			/(## Step 2b\. Direct Explain[\s\S]*?)your configured how-explainer model/,
			"$1`how explainer`",
		);
		text = text.replace(
			/(## Step 3\. Synthesize[\s\S]*?)your configured how-explainer model/,
			"$1`how synthesizer`",
		);
	}
	if (rel === "skills/reflect/SKILL.md") {
		text = text.replace(
			/(\| Judgment \| )your configured reflect-judgment model/,
			"$1`reflect judgment reviewer`",
		);
		text = text.replace(
			/(\| Divergent \| )your configured reflect-judgment model/,
			"$1`reflect divergent reviewer`",
		);
		text = text.replace(
			/using your configured reflect-judgment model/,
			"using `reflect synthesizer`",
		);
	}
	return text;
}

export function applyBodyTransforms(text, rel) {
	text = applyPiCallerGuidanceTransforms(text, rel);
	for (let i = 0; i < 20; i++) {
		let next = text;
		for (const seam of SEAMS) {
			next = next.replace(seam.cursor, seam.pi);
		}
		if (next === text) {
			return applyAtomicRoleTransforms(next, rel);
		}
		text = next;
	}
	throw new Error("seam fixpoint did not converge");
}

