#!/usr/bin/env node
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptBbCallerGuidance } from "./reground-bb-callers.mjs";
import { adaptWatcherTypescript } from "./reground-watcher-typescript.mjs";

const EXTENSION_COMMANDS = new Set(["/poteto-mode", "/setup-pstack", "/pstack"]);

const CURSOR_FRONTMATTER_KEYS = new Set(["mode", "icon", "color", "reminder", "paths"]);

const CURSOR_SLUG_ALT =
	"claude-opus-5-5-xhigh|grok-4\\.7-xhigh-fast|claude-opus-5-5-max|grok-4\\.6-fast-xhigh|claude-fable-5-1-thinking-max|gpt-5\\.6-sol-max|claude-opus-5-thinking-xhigh";
const CURSOR_DEFAULT_SLUGS = new RegExp(
	"`?(?:" + CURSOR_SLUG_ALT + ")`?(?:\\s*,\\s*`?(?:" + CURSOR_SLUG_ALT + ")`?)*",
	"g",
);

export const CLASS_RULES = [
	{ pattern: "skills/make-bot-ui/**", class: "never-copy" },
	{ pattern: "make-bot-ui/**", class: "never-copy" },
	{ pattern: "assets/**", class: "never-copy" },
	{ pattern: "automations/**", class: "never-copy" },
	{ pattern: "docs/**", class: "never-copy" },
	{ pattern: ".cursor-plugin/**", class: "never-copy" },
	{ pattern: "agents/**", class: "never-copy" },
	{ pattern: "README.md", class: "never-copy" },
	{ pattern: "LICENSE", class: "never-copy" },

	{ pattern: "skills/*/agents/openai.yaml", class: "pi-only" },
	{ pattern: "skills/code-review/**", class: "pi-only" },
	{ pattern: "skills/poteto-help/**", class: "pi-only" },
	{ pattern: "skills/poteto-mode/references/bb-surface.md", class: "pi-only" },
	{ pattern: "skills/deslop/**", class: "pi-only" },
	{ pattern: "skills/setup-pstack/**", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.test.mjs", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/check-plan.test.ts", class: "never-copy" },
	{ pattern: "skills/poteto-mode/scripts/package.json", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/bun.lock", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/worktree-audit.sh", class: "pi-only" },
	{ pattern: "skills/poteto-mode/references/branch-workflow.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/orchestrate.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/autopilot-full.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/autopilot-stack.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/babysit.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/shipping.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/opening-a-pr.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/playbooks/multi-phase-plan.md", class: "pi-only" },
	{ pattern: "skills/poteto-mode/scripts/orch/**", class: "pi-only" },

	{ pattern: "skills/principle-*/**", class: "copy" },
	{ pattern: "skills/typescript-best-practices/references/patterns.md", class: "copy" },

	{ pattern: "skills/**", class: "adapt" },
];

const DEST_ONLY_NEVER = ["extensions/**", "package.json", "CHANGELOG.md", "agents/**", "README.md"];

const KNOWN_TOP = new Set(
	CLASS_RULES.map((rule) => rule.pattern.split("/")[0].replaceAll("*", "")).filter(Boolean),
);

const SKIP_WALK = new Set([".git", "node_modules"]);

let skillNamesForSlash = new Set(["deslop"]);

export const SEAMS = [
	{
		id: "ask-question",
		cursor: /AskQuestion/g,
		pi: "ask_user_question",
	},
	{
		id: "models-path",
		cursor: /~\/\.cursor\/rules\/pstack-models\.mdc/g,
		pi: "~/.pi/agent/pstack/models.json",
	},
	{
		id: "models-file-bare",
		cursor: /pstack-models\.mdc/g,
		pi: "~/.pi/agent/pstack/models.json",
	},
	{
		id: "role-line-preamble",
		cursor:
			/Each (?:spawn below names|reviewer and the synthesizer name) a role line in the `[^`]+` rule and a default\. Set `model` to that line's value, or to the default if the rule or the line is missing\. Leave `model` unset when the value is `auto` or `inherit-parent`\. If the Task tool rejects a slug, use the default and say so\. If it rejects the default, use the closest valid slug of the same family from its error message\./g,
		pi: "Each BB Pi worker names a role in `~/.pi/agent/pstack/models.json`. Resolve it through `model-routing`. Aliases copy the resolved parent Pi model. Inspect `bb provider models pi` on the execution host when a selector fails; use only permitted recovery routes. Never treat `inherit-parent` or `auto` as broken selectors.",
	},
	{
		id: "task-rejects-slug",
		cursor:
			/If the Task tool rejects a slug, use the default and say so\. If it rejects the default, use the closest valid slug of the same family from its error message\./g,
		pi: "If an explicit selector is unavailable, inspect `bb provider models pi` on the execution host and use only the recovery route permitted by `model-routing`. Never treat `inherit-parent` or `auto` as broken selectors.",
	},
	// Transcript locations. Path shape borrowed from backnotprop/pstack Harness
	// (https://github.com/backnotprop/pstack/blob/main/skills/poteto-mode/SKILL.md#harness)
	// and adapted to Pi-only wording (`$PI_SESSION_FILE`, sibling-slug fence).
	// The generic sessions-path seam used to rewrite
	// "Do not glob across `~/.cursor/projects/*/`" into
	// "Do not glob across `~/.pi/agent/sessions/`", which inverted the warning.
	{
		id: "cursor-transcript-file",
		cursor: /~\/\.cursor\/projects\/<slug>\/agent-transcripts\/<uuid>\/<uuid>\.jsonl/g,
		pi: "~/.pi/agent/sessions/--<slug>--/*.jsonl",
	},
	{
		id: "no-glob-cursor-projects",
		cursor: /Do not glob across `~\/\.cursor\/projects\/\*\/`/g,
		pi: "Stay inside `~/.pi/agent/sessions/--<slug>--/`. Do not glob sibling slugs under `~/.pi/agent/sessions/`",
	},
	{
		id: "dont-glob-cursor-projects",
		cursor: /Don't glob across `~\/\.cursor\/projects\/\*\/`/g,
		pi: "Stay inside `~/.pi/agent/sessions/--<slug>--/`. Do not glob sibling slugs under `~/.pi/agent/sessions/`",
	},
	{
		id: "sessions-path",
		cursor: /~\/\.cursor\/projects\/[^`\s]*/g,
		pi: "~/.pi/agent/sessions/",
	},
	{
		id: "skills-dir",
		cursor: /(?:~\/\.cursor\/skills\/|\.cursor\/skills\/)/g,
		pi: (m) => (m.startsWith("~") ? "~/.pi/agent/skills/" : ".pi/skills/"),
	},
	{
		id: "plugins-dir",
		cursor: /~\/\.cursor\/plugins\//g,
		pi: "~/.pi/agent/npm/node_modules/",
	},
	{
		id: "deslop",
		cursor:
			/the `deslop` skill from the `cursor-team-kit` plugin \(`\/deslop`\)|(?<!skill:)\/deslop\b/g,
		pi: (m) =>
			m.includes("cursor-team-kit") ? "the **deslop** skill (`/skill:deslop`)" : "/skill:deslop",
	},
	{
		id: "control-pair",
		cursor: /`control-ui` or `control-cli`|`control-cli` or `control-ui`/g,
		pi: "the project's verification skill or harness",
	},
	{
		id: "control-from",
		cursor: /`control-ui` from (?:`[^`]*`|\.)|`control-cli` from (?:`[^`]*`|\.)/g,
		pi: "the project's verification skill or harness",
	},
	{
		id: "control-publish",
		cursor:
			/the matching control skill\.\s*(?:`[^`]+`\s*)?publishes `control-cli` \(CLIs and TUIs\) and `control-ui` \(browser \/ Electron \/ web UIs\)/g,
		pi: "verify on the real surface: drive the browser or app through the project's verification skill or an automation harness",
	},
	{
		id: "cursor-team-kit",
		cursor: /`cursor-team-kit`|cursor-team-kit/g,
		pi: "the project's verification skill",
	},
	{
		id: "subagent-poteto",
		cursor: /subagent_type:\s*"poteto-agent"/g,
		pi: "pi_worker with the Poteto Mode skill path and the bounded task",
	},
	{
		id: "subagent-sicko",
		cursor: /subagent_type:\s*"Comment Sicko"/g,
		pi: "pi_worker with the Comment Sicko skill path and the bounded task",
	},
	{
		id: "subagent-worker",
		cursor:
			/`subagent_type`:\s*`generalPurpose`|subagent_type:\s*"generalPurpose"|subagent_type:\s*`?generalPurpose`?/g,
		pi: 'role: "worker"',
	},
	{
		id: "subagent-type-leftover",
		cursor: /`subagent_type`|subagent_type/g,
		pi: "agent",
	},
	{
		id: "inherit-parent",
		cursor: CURSOR_DEFAULT_SLUGS,
		pi: "inherit-parent",
	},
	{
		id: "task-subagent",
		cursor: /Task subagent/g,
		pi: "child",
	},
	{
		id: "task-call",
		cursor: /every `Task` call/g,
		pi: "every child launch",
	},
	{
		id: "task-calls",
		cursor: /`Task` calls/g,
		pi: "child launches",
	},
	{
		id: "task-call-one",
		cursor: /One `Task` call/g,
		pi: "One child launch",
	},
	{
		id: "three-task",
		cursor: /three `Task` calls/g,
		pi: "three child launches",
	},
	{
		id: "task-tool",
		cursor: /(?:the )?Task tool/g,
		pi: "pi_worker",
	},
	{
		id: "task-response",
		cursor: /`Task` response body/g,
		pi: "BB worker report",
	},
	{
		id: "task-schema",
		cursor: /Task schema/g,
		pi: "pi_worker schema",
	},
	{
		id: "readonly-true",
		cursor: /`readonly`: `true`/g,
		pi: '`tools`: `["read", "grep", "find", "ls"]`, plus specifically required read-only research tools',
	},
	{
		id: "readonly-false",
		cursor: /`readonly`: `false`/g,
		pi: "`tools`: explicitly list the tools required for this assignment",
	},
	{
		id: "create-skill-builtin",
		cursor: /the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)/g,
		pi: "`playbooks/authoring-a-skill.md` and `/skill:unslop`",
	},
	{
		id: "create-skill-use",
		cursor:
			/Use the \*\*create-skill\*\* skill \(Cursor's built-in for authoring SKILL\.md files\)\./g,
		pi: "Author SKILL.md to the Pi Agent Skills standard. Run `/skill:unslop` on every line.",
	},
	{
		id: "create-skill-cursor",
		cursor: /Cursor's built-in `create-skill`/g,
		pi: "`playbooks/authoring-a-skill.md`",
	},
	{
		id: "create-skill-tick",
		cursor: /`create-skill`/g,
		pi: "`playbooks/authoring-a-skill.md`",
	},
	{
		id: "create-skill-bare",
		cursor: /create-skill/g,
		pi: "authoring-a-skill",
	},
	{
		id: "under-loop",
		cursor: /under `\/loop`/g,
		pi: "under a recurring wake",
	},
	{
		id: "cursor-loop",
		cursor: /Cursor's `\/loop` command/g,
		pi: "a recurring wake",
	},
	{
		id: "with-loop",
		cursor: /with Cursor's `\/loop` command/g,
		pi: "with a recurring wake",
	},
	{
		id: "slash-loop",
		cursor: /`\/loop`/g,
		pi: "a recurring wake",
	},
	{
		id: "babysit-cursor",
		cursor: /not Cursor's built-in babysit skill/g,
		pi: "not any generic review command",
	},
	{
		id: "loop-until",
		cursor: /\/loop until X/g,
		pi: "run until X",
	},
	{
		id: "loop-command",
		cursor: /Cursor's `\/loop` command \(a built-in, not a pstack skill\)/g,
		pi: "a recurring wake or watcher loop (a built-in, not a pstack skill)",
	},
	{
		id: "loop-terminal",
		cursor: /a real terminal `\/loop`/g,
		pi: "a recurring wake",
	},
	{
		id: "home-cursor",
		cursor: /\$HOME\/\.cursor\/projects\/[^\s"']*/g,
		pi: "$HOME/.pi/agent/sessions",
	},
	{
		id: "cloud-agent",
		cursor: /, cloud-agent URL,/g,
		pi: ", an async run record,",
	},
	{
		id: "cursor-restart",
		cursor: /, a Cursor restart,/g,
		pi: ", a restart,",
	},
	{
		id: "cloud-vm",
		cursor: /on its own cloud VM at the PR head/g,
		pi: "at the PR head",
	},
	{
		id: "setup-rule",
		cursor: /the `\/setup-pstack` rule/g,
		pi: "the pstack role configuration resolved through `model-routing`",
	},
	{
		id: "ten-lanes",
		cursor: /Ten lanes on [^\n]+ at the PR head/g,
		pi: "Ten lanes at the PR head",
	},
	{
		id: "check-plan-path",
		cursor: /node pstack\/skills\/poteto-mode\/scripts\/check-plan\.mjs/g,
		pi: "node skills/poteto-mode/scripts/check-plan.mjs",
	},
	{
		id: "standing-goal",
		cursor: /arm a `\/goal` with this exact text/g,
		pi: "record a standing goal with this exact text",
	},
	{
		id: "standing-goal-tick",
		cursor: /the armed \/goal/g,
		pi: "the standing goal",
	},
	{
		id: "slash-skill",
		cursor: /(?<![\w/])\/([a-z][a-z0-9-]*)\b(?![/\w-])/g,
		pi: (m, name) => {
			if (EXTENSION_COMMANDS.has(`/${name}`)) return m;
			if (!skillNamesForSlash.has(name)) return m;
			return `/skill:${name}`;
		},
	},
];

function matchGlob(rel, pattern) {
	let out = "";
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "*" && pattern[i + 1] === "*") {
			out += ".*";
			i++;
		} else if (pattern[i] === "*") {
			out += "[^/]*";
		} else if (".+^${}()|[]\\".includes(pattern[i])) {
			out += `\\${pattern[i]}`;
		} else {
			out += pattern[i];
		}
	}
	return new RegExp(`^${out}$`).test(rel);
}

function matchesAny(rel, patterns) {
	return patterns.some((pattern) => matchGlob(rel, pattern));
}

export function asRelPath(value) {
	if (typeof value !== "string" || value === "") {
		throw new Error("rel path required");
	}
	if (value.includes("\\") || value.includes("..") || value.startsWith("/")) {
		throw new Error(`invalid rel path: ${value}`);
	}
	return value;
}

export function classify(rel) {
	rel = asRelPath(rel);
	for (const rule of CLASS_RULES) {
		if (matchGlob(rel, rule.pattern)) return rule.class;
	}
	if (rel === "skills" || rel.startsWith("skills/")) return "adapt";
	const top = rel.split("/")[0];
	if (rel.includes("/") && !top.startsWith(".") && !KNOWN_TOP.has(top)) {
		throw new Error(`unclassified Cursor path: ${rel}`);
	}
	return "never-copy";
}

export function parseArgs(argv) {
	let from;
	let to;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--from") {
			from = argv[++i];
		} else if (arg === "--to") {
			to = argv[++i];
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else {
			throw new Error(`unknown arg: ${arg}`);
		}
	}
	if (!from || !to) {
		throw new Error("usage: --from <cursor-pstack> --to <pi-pstack> [--dry-run]");
	}
	from = resolve(from);
	to = resolve(to);
	if (!existsSync(join(from, "skills"))) {
		throw new Error(`no skills/ in ${from}`);
	}
	if (!existsSync(join(to, "skills"))) {
		throw new Error(`no skills/ in ${to}`);
	}
	return { from, to, dryRun };
}

function walkFiles(root) {
	const out = [];
	function rec(dir, relBase) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP_WALK.has(ent.name)) continue;
			const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
			const abs = join(dir, ent.name);
			if (ent.isDirectory()) rec(abs, rel);
			else out.push(asRelPath(rel));
		}
	}
	rec(root, "");
	return out;
}

function refreshSkillNames(fromRoot, toRoot) {
	skillNamesForSlash = new Set(["deslop"]);
	for (const root of [fromRoot, toRoot]) {
		const dir = join(root, "skills");
		if (!existsSync(dir)) continue;
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			if (ent.isDirectory() && ent.name !== "make-bot-ui") {
				skillNamesForSlash.add(ent.name);
			}
		}
	}
}

function skillDirsAfter(to, actions) {
	const dir = join(to, "skills");
	const dirs = new Set(
		readdirSync(dir, { withFileTypes: true })
			.filter((ent) => ent.isDirectory())
			.map((ent) => ent.name),
	);
	for (const action of actions) {
		const rel = action.rel;
		if (!rel) continue;
		const m = /^skills\/([^/]+)\//.exec(rel);
		if (!m) continue;
		if (action.kind === "write") dirs.add(m[1]);
		if (action.kind === "delete" && rel === `skills/${m[1]}/SKILL.md`) dirs.delete(m[1]);
	}
	return dirs;
}

function playbookCountAfter(to, actions) {
	const dir = join(to, "skills/poteto-mode/playbooks");
	const files = new Set(
		existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : [],
	);
	for (const action of actions) {
		const m = action.rel && /^skills\/poteto-mode\/playbooks\/([^/]+\.md)$/.exec(action.rel);
		if (!m) continue;
		if (action.kind === "write") files.add(m[1]);
		if (action.kind === "delete") files.delete(m[1]);
	}
	return files.size;
}

function readOptional(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function needsCatalogCounts(to, counts) {
	const text = readOptional(join(to, "extensions/pstack/skill-catalog.test.ts"));
	return (
		!text.includes(`assert.equal(skills.length, ${counts.total})`) ||
		!text.includes(
			`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`,
		) ||
		!text.includes(`assert.equal(hidden.length, ${counts.hidden})`)
	);
}

function needsReadmeCounts(to, counts) {
	const text = readOptional(join(to, "README.md"));
	return (
		!text.includes(`**${counts.total} skills**`) ||
		!text.includes(`${counts.playbooks} playbooks`) ||
		!text.includes(`${counts.principles} principle skills`) ||
		!text.includes(`not all ${counts.total}`)
	);
}

const POTETO_INTRO = [
	"`/poteto-mode` enables this mode for the rest of the session.",
	"`/poteto-mode off` disables it.",
	"`/skill:poteto-mode` also enables it.",
	"Before selecting a delegated model, use `model-routing` to read the configured roles on demand.",
	"",
	"",
].join("\n");

const BB_WORKER_DEFAULTS = [
	"**Defaults for every BB worker launch.** Use `pi_worker` to create a fresh, visible, parented Pi thread. Work runs in the background. Pass a bounded brief and file pointers. Let the coordinator decide fanout, dependency order, retries, judging, and rolling windows. Do not replace its decisions with a workflow script.",
	"Set an explicit native tool allowlist for the assignment. Read-only reviewers receive read/search tools and the specific research tools they need. Writers use isolated workspaces. Verifiers may need bash to run tests; shell access is not read-only. Role model settings do not grant authority.",
	"Implementation playbooks use `feature implementation`, `refactoring implementation`, `bug-fix`, `perf-issue`, and `hillclimb`. Resolve role models through `model-routing` and `~/.pi/agent/pstack/models.json`. Defaults inherit the resolved parent Pi model. Use `judgment` for ordinary decisions, `prose` for writing, `hardest tasks` for difficult work, and the matching implementation role for code. Preserve the configured number of reviewers or candidates. An omitted model, `inherit-parent`, or `auto` copies the parent's resolved model and reasoning, never project defaults. Read `references/bb-surface.md` for execution and recovery.",
].join("\n\n");

const RETIRED_POTETO_EVIDENCE_BULLET =
	"- **Every claim carries its evidence or its label in the same sentence.** Measured, inferred, or guess. A prediction or an unseen cause is a guess. Never hand the human a check you could run.";

const POTETO_CODE_REVIEW_ROUTING = [
	"## Code review routing",
	"",
	"Read `../code-review/SKILL.md` relative to this skill directory for every route below. Use that file, not the globally registered skill name.",
	"",
	"- Ordinary requests to review a PR, diff, branch, or changes since a point use `code-review` Audit. A bare `review` also uses Audit.",
	"- Ask for a missing Audit base. Do not guess. A named PR supplies immutable base and head commits.",
	"- Use Challenge only for an explicit adversarial or design-interrogation request. Run Audit and Challenge when the user asks for both.",
	"- Challenge can review pinned design contents without a Git base.",
	"- PR-status requests such as `check on PR X` use the Babysit playbook.",
].join("\n");

const POTETO_BRANCH_WORKFLOW = [
	"## Branch workflow",
	"",
	"Read `references/branch-workflow.md` before a program, PR, babysit, or shipping workflow. Use the repository's branch tool. Run independent PRs in parallel. Start dependent work after its prerequisite merges, or keep coupled work in one PR. Do not construct dependent PR stacks or use Graphite.",
].join("\n");

function patchIndependentPrRoutes(text) {
	const routes = [
		{
			pattern: /^- Asked to land or ship a green stack.*$/m,
			replacement:
				"- Asked to land or ship a green PR queue → the **Shipping** playbook (`playbooks/shipping.md`). Green is not safe. Nothing gets armed before an independent per-PR verdict. Only individually verified and authorized PRs land.",
		},
		{
			pattern: /^- \*\*Babysit\.\*\*.*$/m,
			replacement:
				"- **Babysit.** Bring requested independent PRs to merge-ready. Conflicts, review threads, and CI. `playbooks/babysit.md`.",
		},
		{
			pattern: /^- \*\*Shipping\.\*\*.*$/m,
			replacement:
				"- **Shipping.** Independently verify requested PRs, then land only authorized PRs at their verified heads. Use the repository's forge. `playbooks/shipping.md`.",
		},
		{
			pattern: /^- \*\*Autopilot-stack\.\*\*.*$/m,
			replacement:
				'- **Review-only PR queue.** Build and verify independent PRs while the operator retains landing authority. Includes legacy "autopilot-stack" or "build the stack, I\'ll land it" requests, without constructing a branch chain. `playbooks/autopilot-stack.md`.',
		},
		{
			pattern: /^- \*\*Multi-phase or multi-PR plan\.\*\*.*$/m,
			replacement:
				"- **Multi-phase or multi-PR plan.** Work that spans phases or independent PRs. Dependent work starts after its prerequisite merges. `playbooks/multi-phase-plan.md`.",
		},
	];
	let result = text.replaceAll("many stacked PRs", "many independent PRs");
	for (const route of routes) {
		result = result.replace(route.pattern, route.replacement);
	}
	if (!result.includes("## Branch workflow")) {
		if (result.includes("## Autonomy")) {
			return result.replace("## Autonomy", `${POTETO_BRANCH_WORKFLOW}\n\n## Autonomy`);
		}
		return `${result.trimEnd()}\n\n${POTETO_BRANCH_WORKFLOW}\n`;
	}
	return result;
}

const POTETO_BB_SURFACE = [
	"## Interaction surface",
	"",
	"BB is the interaction surface and Pi runs the agents. Use fresh, nested BB Pi threads for Pstack workers. Read `references/bb-surface.md` before delegation, recovery, or presenting artifacts. `BB_THREAD_ID` alone identifies BB context; projectless work is valid. There is no Herdr or native-child fallback.",
].join("\n");

function patchPotetoModePi(text) {
	if (!text.includes("## Interaction surface")) {
		text = text.replace("## Non-negotiables", `${POTETO_BB_SURFACE}\n\n## Non-negotiables`);
	}
	if (!text.includes("`/poteto-mode` enables this mode")) {
		text = text.replace("# Poteto mode\n\n", `# Poteto mode\n\n${POTETO_INTRO}`);
	}
	if (!text.includes("## Code review routing")) {
		const anchor = "## Non-negotiables\n";
		if (!text.includes(anchor)) {
			throw new Error("Poteto caller guidance is missing its routing insertion point");
		}
		text = text.replace(anchor, `${POTETO_CODE_REVIEW_ROUTING}\n\n${anchor}`);
	}
	text = text.replace(/\*\*Defaults for every `Task` call\.\*\*[^\n]*/, BB_WORKER_DEFAULTS);
	return patchIndependentPrRoutes(text.replace(`${RETIRED_POTETO_EVIDENCE_BULLET}\n`, ""));
}

export function plan(paths) {
	refreshSkillNames(paths.from, paths.to);
	const cursorRels = walkFiles(paths.from);
	const cursorSet = new Set(cursorRels);
	const actions = [];

	for (const rel of cursorRels) {
		const fileClass = classify(rel);
		if (fileClass === "never-copy" || fileClass === "pi-only") {
			actions.push({ kind: "skip", rel, class: fileClass });
			continue;
		}
		actions.push({
			kind: "write",
			rel,
			dest: join(paths.to, rel),
			class: fileClass,
		});
	}

	const destSkillRoot = join(paths.to, "skills");
	const destRels = existsSync(destSkillRoot)
		? walkFiles(destSkillRoot).map((rel) => asRelPath(`skills/${rel}`))
		: [];
	for (const rel of destRels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only") continue;
		const counterpart = cursorSet.has(rel) ? classify(rel) : null;
		if (counterpart === "copy" || counterpart === "adapt") continue;
		if (counterpart === "pi-only") continue;
		actions.push({ kind: "delete", dest: join(paths.to, rel), rel });
	}

	const dirs = skillDirsAfter(paths.to, actions);
	const discoverable = [...dirs].filter((name) => {
		const rel = `skills/${name}/SKILL.md`;
		const imported = actions.some((action) => action.kind === "write" && action.rel === rel);
		const path = join(imported ? paths.from : paths.to, rel);
		if (!existsSync(path)) {
			return false;
		}
		const frontmatter =
			readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? "";
		return !/^disable-model-invocation:\s*true\s*$/m.test(frontmatter);
	}).length;
	const counts = {
		total: dirs.size,
		discoverable,
		hidden: dirs.size - discoverable,
		principles: [...dirs].filter((name) => name.startsWith("principle-")).length,
		playbooks: playbookCountAfter(paths.to, actions),
	};

	if (needsCatalogCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "extensions/pstack/skill-catalog.test.ts"),
			derived: "catalog-counts",
		});
	}
	if (needsReadmeCounts(paths.to, counts)) {
		actions.push({
			kind: "patch",
			dest: join(paths.to, "README.md"),
			derived: "readme-counts",
		});
	}
	return { paths, actions, counts };
}

export function printPlan(planned) {
	const tallies = { write: 0, delete: 0, patch: 0, skip: 0 };
	for (const action of planned.actions) {
		tallies[action.kind] += 1;
		if (action.kind === "write") {
			console.log(`write\t${action.class}\t${action.rel}`);
		} else if (action.kind === "delete") {
			console.log(`delete\t\t${action.rel}`);
		} else if (action.kind === "patch") {
			console.log(`patch\t${action.derived}\t${action.dest}`);
		} else {
			console.log(`skip\t${action.class}\t${action.rel}`);
		}
	}
	console.log(
		`# ${tallies.write} write, ${tallies.delete} delete, ${tallies.patch} patch, ${tallies.skip} skip`,
	);
	console.log(
		`# catalog ${planned.counts.total}/${planned.counts.discoverable}/${planned.counts.hidden} principles ${planned.counts.principles} playbooks ${planned.counts.playbooks}`,
	);
}

function frontmatterKey(line) {
	const i = line.indexOf(":");
	return i === -1 ? "" : line.slice(0, i).trim();
}

/** Remove Cursor-only metadata while preserving upstream skill invocation settings. */
export function applyFrontmatterPolicy(text) {
	if (!text.startsWith("---\n")) return text;
	const close = text.indexOf("\n---\n", 4);
	if (close === -1) return text;
	const body = text.slice(close + "\n---\n".length);
	const lines = text
		.slice(4, close)
		.split("\n")
		.map((line) => line.replace(/^name:\s*"?Poteto Mode"?\s*$/, "name: poteto-mode"))
		.filter((line) => !CURSOR_FRONTMATTER_KEYS.has(frontmatterKey(line)));
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
	[/the `how explorer` line/g, "`how explorers`"],
	[/your configured why-investigators model/g, "`why investigators`"],
	[/the `why investigators` line/g, "`why investigators`"],
	[/your configured why-synthesizer model/g, "`why synthesizer`"],
	[/the `why synthesizer` line/g, "`why synthesizer`"],
	[/your configured reflect-tooling model/g, "`reflect tooling reviewer`"],
	[/`reflect tooling`(?! reviewer)/g, "`reflect tooling reviewer`"],
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
			/(## Step 2b\. Direct Explain[\s\S]*?)(?:your configured how-explainer model|the `how explainer` line)/,
			"$1`how explainer`",
		);
		text = text.replace(
			/(## Step 3\. Synthesize[\s\S]*?)(?:your configured how-explainer model|the `how explainer` line)/,
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

const PI_CALLER_GUIDANCE_REPLACEMENTS = [
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern:
			/^- Contested design → the \*\*interrogate\*\* skill \(multi-model adversarial\) before shipping\.$/m,
		replacement:
			"- Contested design → read `../code-review/SKILL.md` relative to this skill directory and use Challenge before shipping.",
	},
	{
		rel: "skills/poteto-mode/playbooks/feature.md",
		pattern: /^7\. If the design is contested, `interrogate` before shipping\.$/m,
		replacement:
			"7. If the design is contested, read `../../code-review/SKILL.md` relative to this playbook's directory. Use Challenge before shipping.",
	},
	{
		rel: "skills/poteto-mode/playbooks/bug-fix.md",
		pattern: /before the step-3 architect\/interrogate fan-out\./,
		replacement:
			"before the step-3 `architect` and Pstack Challenge fan-out. For Challenge, read `../../code-review/SKILL.md` relative to this playbook's directory.",
	},
	{
		rel: "skills/architect/SKILL.md",
		pattern:
			/For adversarial pressure on the design before implementing, run the (?:`interrogate`|\*\*interrogate\*\*) skill on the synthesized sketch\./g,
		replacement:
			"For adversarial pressure on the design before implementing, read `../code-review/SKILL.md` relative to this skill directory. Use Challenge on the synthesized sketch.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^The parent finds its own transcript file before fanning out\. The system prompt names the active workspace's `agent-transcripts\/` directory\. Use that path\. Do not glob across `~\/\.cursor\/projects\/\*\/`\. That crosses workspace boundaries and reads private chats from unrelated projects\.\n\n```bash\nls -t <agent-transcripts>\/\*\.jsonl <agent-transcripts>\/\*\/\*\.jsonl <agent-transcripts>\/\*\/subagents\/\*\.jsonl 2>\/dev\/null \| head -10\n```\n\nThree transcript layouts: legacy flat \(`<id>\.jsonl`\), current nested \(`<id>\/<id>\.jsonl`\), and subagent \(`<parent>\/subagents\/<child>\.jsonl`\)\.\n\nFor each candidate, read the first JSONL line and check that `message\.content\[0\]\.text` contains the conversation's opening user prompt\. Take the matching path\. If no path resolves, write a tight digest of the session and pass that instead\.$/m,
		replacement:
			'The parent finds its own transcript file before fanning out. Prefer `$PI_SESSION_FILE` for the current session. Workspace transcripts live at `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-". Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That crosses workspace boundaries and reads private chats from unrelated projects.\n\n```bash\nls -t ~/.pi/agent/sessions/--<slug>--/*.jsonl 2>/dev/null | head -10\n```\n\nEach file is JSONL. Confirm a candidate by finding the conversation\'s opening user prompt in its first user message. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead.',
	},
	{
		rel: "skills/recall/SKILL.md",
		pattern:
			/^Transcripts live at `~\/\.cursor\/projects\/<slug>\/agent-transcripts\/<uuid>\/<uuid>\.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "\/" turned into "-" \(so `\/Users\/you\/proj` becomes `Users-you-proj`\)\. Every line is one chat message\.$/m,
		replacement:
			'Transcripts live at `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" (so `/Users/you/proj` becomes `Users-you-proj`). Prefer `$PI_SESSION_FILE` for the current session. Each file is JSONL. Stay inside that workspace directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`.',
	},
	{
		rel: "skills/automate-me/SKILL.md",
		pattern:
			/^Locate the active workspace's transcripts before fanning out\. The system prompt names the workspace's `agent-transcripts\/` directory\. Use only that path\. Don't glob across `~\/\.cursor\/projects\/\*\/`\. That crosses workspace boundaries and reads private chats from unrelated projects\.$/m,
		replacement:
			'Locate the active workspace\'s transcripts before fanning out. Use `~/.pi/agent/sessions/--<slug>--/`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-". Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That crosses workspace boundaries and reads private chats from unrelated projects.',
	},
	{
		rel: "skills/show-me-your-work/SKILL.md",
		pattern:
			/^At the end of the run, before handing back, check the log told the truth\. Read this run's transcript under the active workspace's `agent-transcripts\/` directory \(the system prompt names the path\)\. Don't glob across `~\/\.cursor\/projects\/\*\/`\. That reads unrelated private chats\. Walk the log against what actually happened:$/m,
		replacement:
			'At the end of the run, before handing back, check the log told the truth. Read this run\'s transcript. Prefer `$PI_SESSION_FILE`. Otherwise use `~/.pi/agent/sessions/--<slug>--/` (`<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-"). Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That reads unrelated private chats. Walk the log against what actually happened:',
	},
	{
		rel: "skills/show-me-your-work/SKILL.md",
		pattern:
			/^At the end of the run, before handing back, check the log told the truth\. Read this run's transcript under the active workspace's `agent-transcripts\/` directory \(the system prompt names the path\)\. Don't glob across `~\/\.cursor\/projects\/\*\/`\. That reads unrelated private chats\. Walk this run's rows against what actually happened\. Each stretch of them begins at one of this run's `start` rows, or at the first row if this run created the log, and ends at the next `start` row of another run:$/m,
		replacement:
			'At the end of the run, before handing back, check the log told the truth. Read this run\'s transcript. Prefer `$PI_SESSION_FILE`. Otherwise use `~/.pi/agent/sessions/--<slug>--/` (`<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-"). Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That reads unrelated private chats. Walk this run\'s rows against what actually happened. Each stretch of them begins at one of this run\'s `start` rows, or at the first row if this run created the log, and ends at the next `start` row of another run:',
	},
	{
		rel: "skills/poteto-mode/playbooks/session-pickup.md",
		pattern:
			/A local transcript under the active workspace's `agent-transcripts\/` directory \(the system prompt names the path\. Do not glob across `~\/\.cursor\/projects\/\*\/`, that crosses workspace boundaries and reads private chats from unrelated projects\), a cloud-agent URL, or a pushed branch\./,
		replacement:
			'A local transcript under `~/.pi/agent/sessions/--<slug>--/` (prefer `$PI_SESSION_FILE` for the current session. `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-". Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`, that crosses workspace boundaries and reads private chats from unrelated projects), an async run record, or a pushed branch.',
	},
	{
		rel: "skills/poteto-mode/playbooks/eval.md",
		pattern:
			/Read each candidate's local transcript under the active workspace's `agent-transcripts\/` directory \(the system prompt names this path\)\. Do not glob across `~\/\.cursor\/projects\/\*\/`\. That crosses workspace boundaries and reads private chats from unrelated projects\./,
		replacement:
			'Read each candidate\'s local transcript under `~/.pi/agent/sessions/--<slug>--/` (`<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-"). Stay inside that directory. Do not glob sibling slugs under `~/.pi/agent/sessions/`. That crosses workspace boundaries and reads private chats from unrelated projects.',
	},
	{
		rel: "skills/no-comments/SKILL.md",
		pattern:
			/^1\. Spawn `Task` with `subagent_type: "Comment Sicko"`\. Pass the scope\. Do not restate its rules\.$/m,
		replacement:
			"1. Launch a fresh `pi_worker` for Comment Sicko. Pass `../../agents/comment-sicko.md` relative to this skill directory and the scope. The worker reads that prompt and does not delegate further. Allow read/search tools, plus edit/write only when fixing comments is assigned. Do not restate its rules.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem\. Spawn all explorers in a single message:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explorer model \(default `grok-4\.6-fast-xhigh`\)\n- `readonly`: `true`\n\nEach explorer gets the prompt in `references\/explorer-prompt\.md` with its angle filled in\. Then go to Step 3\.$/m,
		replacement:
			"Decompose the question into 2 to 4 distinct exploration angles. Launch a fresh `pi_worker` per angle using `how explorers` and tools `read`, `grep`, `find`, and `ls`. Each gets `references/explorer-prompt.md` with its angle filled in. Launch all ready explorers without waiting for one to finish. Then go to Step 3.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/(?:^Spawn one Task subagent that explores and explains in one pass:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explainer model \(default `(?:claude-fable-5-1-thinking-max|claude-opus-5-5-xhigh)`\)\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` without the explorer-findings section\. Go to Step 4\.$|^Spawn one Task subagent that explores and explains in one pass:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `how explainer` line, default `claude-opus-5-5-xhigh`\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` without the explorer-findings section\. Go to Step 4\.$)/m,
		replacement:
			"Launch one fresh `pi_worker` using `how explainer` and tools `read`, `grep`, `find`, and `ls`. Build its task from `references/explainer-prompt.md` without the explorer findings. Wait for its BB completion report, then go to Step 4.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/(?:^Once all explorers have returned, spawn one Task subagent to synthesize their findings into one explanation:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured how-explainer model \(default `(?:claude-fable-5-1-thinking-max|claude-opus-5-5-xhigh)`\)\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` with every explorer's findings filled in\.$|^Once all explorers have returned, spawn one Task subagent to synthesize their findings into one explanation:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `how explainer` line, default `claude-opus-5-5-xhigh`\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` with every explorer's findings filled in\.$)/m,
		replacement:
			"Once all explorers finish, retrieve each full report by BB thread ID. Launch a fresh `pi_worker` using `how synthesizer` and tools `read`, `grep`, `find`, and `ls`. Give it `references/explainer-prompt.md` with every explorer finding filled in.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^Spawn all N subagents in one message with `run_in_background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale\.$/m,
		replacement:
			"Launch N fresh `pi_worker` candidates without waiting between launches. Each gets its `arena runners` model, shared grounding path, its own isolated workspace/output path, and the task to produce an artifact plus rationale. Give the tools required to create and verify its candidate. Record every BB thread ID.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/(?:^After all Phase B candidates complete, choose one model from the `arena cross-judge pool` in `~\/\.cursor\/rules\/pstack-models\.mdc` when present\. Otherwise use `(?:claude-fable-5-1-thinking-max|claude-opus-5-5-xhigh)`, `gpt-5\.6-sol-max`, `grok-4\.6-fast-xhigh`, `claude-opus-5-thinking-xhigh`\. Prefer a different model family from the parent's\. Spawn one readonly judge subagent on that model\. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale\. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves\. Don't spawn the judge while candidates are still writing\.$|^After all Phase B candidates complete, choose one model from the `arena cross-judge pool` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\. If the rule or that line is missing, choose from `claude-opus-5-5-xhigh` and `grok-4\.7-xhigh-fast`\. Prefer a different model family from the parent's\. Spawn one readonly judge subagent on that model\. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale\. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves\. Don't spawn the judge while candidates are still writing\.$)/m,
		replacement:
			"After all Phase B candidates finish, select one model from `arena judge pool` in `~/.pi/agent/pstack/models.json` when configured. Otherwise inherit the resolved parent Pi model. Prefer a different family from the parent within permitted model policy. Launch a fresh `pi_worker` judge with tools `read`, `grep`, `find`, and `ls`. It reads the rubric and completed candidate paths, scores every criterion, and recommends a base. Read the artifacts in BB while it runs. Never launch the judge while candidates are writing.",
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
			"Launch N fresh `pi_worker` threads without waiting between launches. Each gets its coverage slice, `swarm workers` model, required tool allowlist, workspace, and report contract. Desktop is the default; specialist work runs on its relevant prepared host. Record each thread ID in the coverage matrix.",
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern:
			/^When a worker must start from a non-default pushed branch, pass `cloud_base_branch`\.$/m,
		replacement:
			"Use the repository branch tool to prepare the required checkout at the intended base ref. Attach BB to that isolated workspace; do not create a nested worktree.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/(?:^One message, three `Task` calls, `subagent_type: generalPurpose`, explicit `model:` on each, agent mode \(`readonly: false`\)\. Reviewers need MCP access for context lookups \(tickets, chat threads, observability traces referenced in the transcript\)\. Readonly strips MCPs\.$|^One message, three `Task` calls, `subagent_type: generalPurpose`, with `model` set as below, agent mode \(`readonly: false`\)\. Reviewers need MCP access for context lookups \(tickets, chat threads, observability traces referenced in the transcript\)\. Readonly strips MCPs\.$)/m,
		replacement:
			"Launch three fresh `pi_worker` reviewers without waiting between launches, one per lens using the table below. Allow read/search and the specific research/MCP tools needed to check transcript references, but not file-writing tools. Pi tool allowlists do not inherently strip MCP access. Record their BB thread IDs.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^Pass each template verbatim, substituting the transcript path or digest where marked\. Reviewers return findings in the `Task` response body\.$/m,
		replacement:
			"Pass each template verbatim, substituting this run's transcript path or bounded digest where marked. Each reviewer returns findings in its BB conversation. Retrieve full reports after completion; parent notices may be abbreviated.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/(?:^One `Task` call, `subagent_type: generalPurpose`, using your configured reflect-judgment model \(default `(?:claude-fable-5-1-thinking-max|claude-opus-5-5-xhigh)`\), agent mode \(`readonly: false`\)\. The synthesizer's quality check includes spot-verifying citations, which can require MCP access\. Readonly strips MCPs\. Use `references\/synthesizer\.md` verbatim, with each reviewer's full output inlined where marked\. The synthesizer returns a structured Accepted \/ Rejected \/ Backlog list\.$|^One `Task` call, `subagent_type: generalPurpose`, with `model` from the `reflect judgment, divergent, synthesizer` line \(default `claude-opus-5-5-xhigh`\), agent mode \(`readonly: false`\)\. The synthesizer's quality check includes spot-verifying citations, which can require MCP access\. Readonly strips MCPs\. Use `references\/synthesizer\.md` verbatim, with each reviewer's full output inlined where marked\. The synthesizer returns a structured Accepted \/ Rejected \/ Backlog list\.$)/m,
		replacement:
			"After all reviewers finish, launch a fresh `pi_worker` using `reflect synthesizer`. Allow read/search and the research tools needed to spot-check citations. Use `references/synthesizer.md` verbatim with each full review inlined. It returns Accepted / Rejected / Backlog lists. The coordinator checks the synthesis against the evidence.",
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
			"Aim for a complete **coverage map**, not a minimal one. Document null results. Give investigators read/search tools and the specific MCP or research tools for their evidence category. Native Pi tool selection does not strip all MCP access.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Launch all matching investigators in a single message so they run concurrently\. Don't ask one agent to cover multiple MCPs\.$/m,
		replacement:
			"Launch a fresh `pi_worker` per matching evidence category without waiting between launches. Use `why investigators`. Do not ask one investigator to cover multiple categories. Once all finish, retrieve their full reports and launch the synthesizer in Step 4.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Subagent config \(each\):\n- `subagent_type`: `generalPurpose`\n- `model`: your configured why-investigators model \(default `grok-4\.6-fast-xhigh`\)\n- `readonly`: `false` \(agent mode\)\. \*\*Do not use readonly\/Ask mode\.\*\* It strips MCP access, which disables MCP-backed investigators entirely\. Investigators still shouldn't write anything\.$/m,
		replacement:
			"Each investigator uses `why investigators`, an explicit read/search and category-research tool allowlist, and an instruction not to modify files. Exclude edit/write and unrestricted bash unless the assignment requires shell execution.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Each investigator gets:\n1\. The base prompt from `references\/investigator-prompt\.md`\n2\. The category playbook `references\/sources\/<source>\.md` for the selected MCP, adapted from the examples in `references\/source-playbook\.md`\n3\. The cross-cutting `references\/sources\/incident-postmortem\.md` \*\*if the target code looks defensive\*\* \(null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers\)\n4\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n5\. The user's original question\n\n(?=### Investigator roster)/m,
		replacement:
			"Each investigator gets:\n1. The base prompt from `references/investigator-prompt.md`\n2. The category playbook `references/sources/<source>.md` and the matching research/MCP tools for direct source lookup\n3. Any evidence already collected for that category, including null results and gaps\n4. The cross-cutting `references/sources/incident-postmortem.md` **if the target code looks defensive** (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers)\n5. The code anchor from Step 2 (file paths, symbols, commit hashes, PR numbers, ticket IDs)\n6. The user's original question\n\n",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Spawn one investigator per category that has a matching MCP\. Each owns exactly one tool or MCP\.$/m,
		replacement:
			"Spawn one investigator per category with source-control evidence or a matching parent MCP. Each owns one source category and performs its own permitted source lookups.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/(?:^Spawn one synthesizer subagent:\n\n- `subagent_type`: `generalPurpose`\n- `model`: your configured why-synthesizer model \(default `(?:claude-fable-5-1-thinking-max|claude-opus-5-5-xhigh)`\)\n- `readonly`: `false` \(agent mode\)\. The synthesizer's quality check spot-verifies citations, which can require MCP access\. Readonly\/Ask mode strips MCPs and defeats that\.\n\nThe synthesizer gets:\n1\. The investigator findings, including any null results and any categories skipped with justification\n2\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n3\. The user's original question\n4\. The epistemics framework from `references\/epistemics\.md`\n5\. The synthesizer prompt template from `references\/synthesizer-prompt\.md`$|^Spawn one synthesizer subagent:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `why synthesizer` line, default `claude-opus-5-5-xhigh`\n- `readonly`: `false` \(agent mode\)\. The synthesizer's quality check spot-verifies citations, which can require MCP access\. Readonly\/Ask mode strips MCPs and defeats that\.\n\nThe synthesizer gets:\n1\. The investigator findings, including any null results and any categories skipped with justification\n2\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n3\. The user's original question\n4\. The epistemics framework from `references\/epistemics\.md`\n5\. The synthesizer prompt template from `references\/synthesizer-prompt\.md`$)/m,
		replacement:
			"After all investigators finish, launch a fresh `pi_worker` using `why synthesizer`. Give it full findings, including nulls and skipped categories, code anchors, the original question, the epistemics framework, and `references/synthesizer-prompt.md`. Allow read/search and the research tools needed to spot-check citations.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/^Launch all reviewers in a single message using the Task tool\. Use the `interrogate reviewers` list from `~\/\.cursor\/rules\/pstack-models\.mdc` when present, one reviewer per entry, extending or shrinking the Reviewer A\/B\/C\/D labels below to the configured entry count\. Otherwise use the table defaults\.$/m,
		replacement:
			"Launch fresh `pi_worker` reviewers without waiting between launches. Use `interrogate reviewers`, one reviewer per configured entry; otherwise use the table defaults. Each receives the full bounded brief and a read/search plus relevant research-tool allowlist. Retrieve every full report before synthesis.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^- `subagent_type`: `generalPurpose`$/m,
		replacement: '- role: "interrogate reviewers"',
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern: /^- `readonly`: `true`$/m,
		replacement:
			'- `tools`: `["read", "grep", "find", "ls"]`, plus specifically required read-only research tools\n- `task`: instruct the reviewer to inspect only and not modify files',
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/^If a model slug is rejected as unresolvable when you try to spawn the subagent, check the valid slugs in the Task tool's error message, pick the closest equivalent \(prefer the highest-reasoning tier of the same family\), spawn with the valid slug, and open a separate PR to update the configured value or default table\. Do not block the review on the slug issue\. If the configured value is `inherit-parent` or `auto`, omit `model` instead\. Never treat those aliases as broken slugs or enter this fallback for them\.$/m,
		replacement:
			"If an explicit model selector is unavailable, inspect `bb provider models pi` on the execution host, use only the recovery route permitted by `model-routing`. Explicit selectors do not fall back. Open a separate PR to update a stale configured value or default table. Do not block the review on a stale selector. If the configured value is `inherit-parent` or `auto`, omit `model`; never treat those aliases as broken selectors or enter this fallback for them.",
	},
	{
		rel: "skills/poteto-mode/SKILL.md",
		pattern:
			/^\*\*Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step\*\* \(code-writing delegates, ad-hoc helpers\)\. `\/poteto-mode` and `poteto-agent` route through the same wrapper\. Routed workflow skills \(`how`, `why`, `interrogate`, `reflect`, `swarm`\) set their own `subagent_type` for diverse-model review\. Respect what the skill prescribes, don't override to `poteto-agent`\.$/m,
		replacement:
			"**Use a fresh BB Pi worker for any delegated playbook step.** Pass this skill path for Poteto behavior. Routed How, Why, Interrogate, Reflect, Swarm, Arena, and Architect skills retain their own models and role instructions. Use `pi_worker`, not native Pi child runtimes.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem\. Spawn all explorers in a single message:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `how explorer` line, default `grok-4\.7-xhigh-fast`\n- `readonly`: `true`\n\nEach explorer gets the prompt in `references\/explorer-prompt\.md` with its angle filled in\. Then go to Step 3\.$/m,
		replacement:
			"Decompose the question into 2 to 4 distinct exploration angles. Launch a fresh `pi_worker` per angle using `how explorers` and tools `read`, `grep`, `find`, and `ls`. Each gets `references/explorer-prompt.md` with its angle filled in. Launch all ready explorers without waiting for one to finish. Then go to Step 3.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Spawn one Task subagent that explores and explains in one pass:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `how explainer` line, default `claude-opus-5-5-max`\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` without the explorer-findings section\. Go to Step 4\.$/m,
		replacement:
			"Launch one fresh `pi_worker` using `how explainer` and tools `read`, `grep`, `find`, and `ls`. Build its task from `references/explainer-prompt.md` without the explorer findings. Wait for its BB completion report, then go to Step 4.",
	},
	{
		rel: "skills/how/SKILL.md",
		pattern:
			/^Once all explorers have returned, spawn one Task subagent to synthesize their findings into one explanation:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `how explainer` line, default `claude-opus-5-5-max`\n- `readonly`: `true`\n\nBuild its prompt from `references\/explainer-prompt\.md` with every explorer's findings filled in\.$/m,
		replacement:
			"Once all explorers finish, retrieve each full report by BB thread ID. Launch a fresh `pi_worker` using `how synthesizer` and tools `read`, `grep`, `find`, and `ls`. Give it `references/explainer-prompt.md` with every explorer finding filled in.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/(?:^3\. Pick the runners\. Use the `arena runners` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\. If the rule or that line is missing, default to one each on `claude-opus-5-5-max`, `gpt-5\.6-sol-max`, `grok-4\.7-xhigh-fast`\. An `auto` or `inherit-parent` entry in this line or the cross-judge line means the parent model, so omit `model` for it\. If the Task tool rejects a configured entry, run that seat on its family's default and say so\. Families go by prefix: `claude-\*`, `gpt-\*`, and `grok-\*`\. With no family match, use `claude-opus-5-5-max`\. If it rejects a default, use the closest valid slug of the same family from its error message\. Spawn more when the arena covers multiple design directions\. Same model N times when the work is generation-bound rather than judgment-sensitive\.$|^3\. Pick the runners\. Use the `arena runners` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\. If the rule or that line is missing, default to one each on `claude-opus-5-5-xhigh` and `grok-4\.7-xhigh-fast`\. An `auto` or `inherit-parent` entry in this line or the cross-judge line means the parent model, so omit `model` for it\. If the Task tool rejects a configured entry, run that seat on its family's default and say so\. Families go by prefix: `claude-\*` and `grok-\*`\. With no family match, use `claude-opus-5-5-xhigh`\. If it rejects a default, use the closest valid slug of the same family from its error message\. Spawn more when the arena covers multiple design directions\. Same model N times when the work is generation-bound rather than judgment-sensitive\.$)/m,
		replacement:
			"3. Pick the runners. Use `arena runners` from `~/.pi/agent/pstack/models.json` when present. Otherwise default to one each on inherit-parent. An `auto` or `inherit-parent` entry means the parent model, so omit `model` for it. If an explicit selector is unavailable, inspect `bb provider models pi` on the execution host, use only the recovery route permitted by `model-routing`. Never treat `inherit-parent` or `auto` as broken selectors. Spawn more when the arena covers multiple design directions. Same model N times when the work is generation-bound rather than judgment-sensitive.",
	},
	{
		rel: "skills/arena/SKILL.md",
		pattern:
			/^After all Phase B candidates complete, choose one model from the `arena cross-judge pool` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\. If the rule or that line is missing, choose from `claude-opus-5-5-max`, `gpt-5\.6-sol-max`, `grok-4\.7-xhigh-fast`\. Prefer a different model family from the parent's\. Spawn one readonly judge subagent on that model\. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale\. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves\. Don't spawn the judge while candidates are still writing\.$/m,
		replacement:
			"After all Phase B candidates finish, select one model from `arena judge pool` in `~/.pi/agent/pstack/models.json` when configured. Otherwise inherit the resolved parent Pi model. Prefer a different family from the parent within permitted model policy. Launch a fresh `pi_worker` judge with tools `read`, `grep`, `find`, and `ls`. It reads the rubric and completed candidate paths, scores every criterion, and recommends a base. Read the artifacts in BB while it runs. Never launch the judge while candidates are writing.",
	},
	{
		rel: "skills/architect/SKILL.md",
		pattern:
			/(?:^Take the runners from the `architect runners` line in the `pstack-models\.mdc` rule, in place of the `arena runners` line\. If the rule or that line is missing, use `claude-opus-5-5-max`, `gpt-5\.6-sol-max`, `grok-4\.7-xhigh-fast`\. Alias and rejected entries follow the runner rules in the \*\*arena\*\* skill's Phase A\.$|^Take the runners from the `architect runners` line in the `pstack-models\.mdc` rule, in place of the `arena runners` line\. If the rule or that line is missing, use `claude-opus-5-5-xhigh` and `grok-4\.7-xhigh-fast`\. Alias and rejected entries follow the runner rules in the \*\*arena\*\* skill's Phase A\.$)/m,
		replacement:
			"Override Arena's candidate selector with `architect runners` (defaults inherit-parent). Require at least two candidates. The Arena judge still uses `arena judge pool`.",
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern:
			/^4\. Pick the worker model from the `swarm workers` line in `~\/\.cursor\/rules\/pstack-models\.mdc`\. If the rule or that line is missing, use `grok-4\.7-xhigh-fast`\. For `auto` or `inherit-parent`, omit `model` so the workers run on the parent model\. If the Task tool rejects a slug, use the default and say so\. If it rejects the default, use the closest valid slug of the same family from its error message\. For a model race, name each arm's model up front\.$/m,
		replacement:
			"4. Pick the worker model from `swarm workers` in `~/.pi/agent/pstack/models.json` when present. Otherwise use inherit-parent. For `auto` or `inherit-parent`, omit `model`. If an explicit selector is unavailable, inspect `bb provider models pi` on the execution host, use only the recovery route permitted by `model-routing`. Never treat `inherit-parent` or `auto` as broken selectors. For a model race, name each arm's model up front.",
	},
	{
		rel: "skills/swarm/SKILL.md",
		pattern:
			/^Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 4 model, left unset for `auto` or `inherit-parent`\. Use `environment: "local"` only when the worker needs access to something on the user's computer\.$/m,
		replacement:
			"Launch N fresh `pi_worker` threads without waiting between launches. Each gets its coverage slice, `swarm workers` model, required tool allowlist, workspace, and report contract. Desktop is the default; specialist work runs on its relevant prepared host. Record each thread ID in the coverage matrix.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Subagent config \(each\):\n- `subagent_type`: `generalPurpose`\n- `model`: the `why investigators` line, default `grok-4\.7-xhigh-fast`\n- `readonly`: `false` \(agent mode\)\. \*\*Do not use readonly\/Ask mode\.\*\* It strips MCP access, which disables MCP-backed investigators entirely\. Investigators still shouldn't write anything\.$/m,
		replacement:
			"Each investigator uses `why investigators`, an explicit read/search and category-research tool allowlist, and an instruction not to modify files. Exclude edit/write and unrestricted bash unless the assignment requires shell execution.",
	},
	{
		rel: "skills/why/SKILL.md",
		pattern:
			/^Spawn one synthesizer subagent:\n\n- `subagent_type`: `generalPurpose`\n- `model`: the `why synthesizer` line, default `claude-opus-5-5-max`\n- `readonly`: `false` \(agent mode\)\. The synthesizer's quality check spot-verifies citations, which can require MCP access\. Readonly\/Ask mode strips MCPs and defeats that\.\n\nThe synthesizer gets:\n1\. The investigator findings, including any null results and any categories skipped with justification\n2\. The code anchor from Step 2 \(file paths, symbols, commit hashes, PR numbers, ticket IDs\)\n3\. The user's original question\n4\. The epistemics framework from `references\/epistemics\.md`\n5\. The synthesizer prompt template from `references\/synthesizer-prompt\.md`$/m,
		replacement:
			"After all investigators finish, launch a fresh `pi_worker` using `why synthesizer`. Give it full findings, including nulls and skipped categories, code anchors, the original question, the epistemics framework, and `references/synthesizer-prompt.md`. Allow read/search and the research tools needed to spot-check citations.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^One message, three `Task` calls, `subagent_type: generalPurpose`, with `model` set as below, agent mode \(`readonly: false`\)\. Reviewers need MCP access for context lookups \(tickets, chat threads, observability traces referenced in the transcript\)\. Readonly strips MCPs\.$/m,
		replacement:
			"Launch three fresh `pi_worker` reviewers without waiting between launches, one per lens using the table below. Allow read/search and the specific research/MCP tools needed to check transcript references, but not file-writing tools. Pi tool allowlists do not inherently strip MCP access. Record their BB thread IDs.",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/(?:^\| Lens \| Role line \| Default `model` \| Prompt template \|\n\|---\|---\|---\|---\|\n\| Judgment \| `reflect judgment, divergent, synthesizer` \| `claude-opus-5-5-max` \| `references\/judgment-reviewer.md` \|\n\| Tooling \| `reflect tooling` \| `gpt-5\.6-sol-max` \| `references\/tooling-reviewer.md` \|\n\| Divergent \| `reflect judgment, divergent, synthesizer` \| `claude-opus-5-5-max` \| `references\/divergent-reviewer.md` \|$|^\| Lens \| Role line \| Default `model` \| Prompt template \|\n\|---\|---\|---\|---\|\n\| Judgment \| `reflect judgment, divergent, synthesizer` \| `claude-opus-5-5-xhigh` \| `references\/judgment-reviewer\.md` \|\n\| Tooling \| `reflect tooling` \| `grok-4\.7-xhigh-fast` \| `references\/tooling-reviewer\.md` \|\n\| Divergent \| `reflect judgment, divergent, synthesizer` \| `claude-opus-5-5-xhigh` \| `references\/divergent-reviewer\.md` \|$)/m,
		replacement:
			"| Lens | `model` | Prompt template |\n|---|---|---|\n| Judgment | `reflect judgment reviewer` (default inherit-parent) | `references/judgment-reviewer.md` |\n| Tooling | `reflect tooling reviewer` (default inherit-parent) | `references/tooling-reviewer.md` |\n| Divergent | `reflect divergent reviewer` (default inherit-parent) | `references/divergent-reviewer.md` |",
	},
	{
		rel: "skills/reflect/SKILL.md",
		pattern:
			/^One `Task` call, `subagent_type: generalPurpose`, with `model` from the `reflect judgment, divergent, synthesizer` line \(default `claude-opus-5-5-max`\), agent mode \(`readonly: false`\)\. The synthesizer's quality check includes spot-verifying citations, which can require MCP access\. Readonly strips MCPs\. Use `references\/synthesizer.md` verbatim, with each reviewer's full output inlined where marked\. The synthesizer returns a structured Accepted \/ Rejected \/ Backlog list\.$/m,
		replacement:
			"After all reviewers finish, launch a fresh `pi_worker` using `reflect synthesizer`. Allow read/search and the research tools needed to spot-check citations. Use `references/synthesizer.md` verbatim with each full review inlined. It returns Accepted / Rejected / Backlog lists. The coordinator checks the synthesis against the evidence.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/(?:^Launch all reviewers in a single message using the Task tool\. Use the `interrogate reviewers` line in `~\/\.cursor\/rules\/pstack-models\.mdc`, one reviewer per entry, extending or shrinking the Reviewer A\/B\/C labels below to the configured entry count\. If the rule or that line is missing, use the table defaults\.$|^Launch all reviewers in a single message using the Task tool\. Use the `interrogate reviewers` line in `~\/\.cursor\/rules\/pstack-models\.mdc`, one reviewer per entry, extending or shrinking the Reviewer A\/B labels below to the configured entry count\. If the rule or that line is missing, use the table defaults\.$)/m,
		replacement:
			"Launch fresh `pi_worker` reviewers without waiting between launches. Use `interrogate reviewers`, one reviewer per configured entry; otherwise use the table defaults. Each receives the full bounded brief and a read/search plus relevant research-tool allowlist. Retrieve every full report before synthesis.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/(?:^If the Task tool rejects a configured entry, run that reviewer on the table default of its family and say so\. Families go by prefix: `claude-\*`, `gpt-\*`, and `grok-\*`\. With no family match, use Reviewer A's default\. If it rejects a table default, check the valid slugs in the Task tool's error message, pick the closest equivalent \(prefer the highest-reasoning tier of the same family\), spawn with it, and open a separate PR to update the default table\. Do not block the review on the slug issue\. Never treat an alias entry as a rejected slug or apply either fallback to it\.$|^If the Task tool rejects a configured entry, run that reviewer on the table default of its family and say so\. Families go by prefix: `claude-\*` and `grok-\*`\. With no family match, use Reviewer A's default\. If it rejects a table default, check the valid slugs in the Task tool's error message, pick the closest equivalent \(prefer the same family and reasoning tier\), spawn with it, and open a separate PR to update the default table\. Do not block the review on the slug issue\. Never treat an alias entry as a rejected slug or apply either fallback to it\.$)/m,
		replacement:
			"If an explicit model selector is unavailable, inspect `bb provider models pi` on the execution host, use only the recovery route permitted by `model-routing`. Explicit selectors do not fall back. Open a separate PR to update a stale configured value or default table. Do not block the review on a stale selector. If the configured value is `inherit-parent` or `auto`, omit `model`; never treat those aliases as broken selectors or enter this fallback for them.",
	},
	{
		rel: "skills/interrogate/SKILL.md",
		pattern:
			/^- `model`: the configured `interrogate reviewers` entry, or the table default with no configured line\. For an `auto` or `inherit-parent` entry, omit `model` so that reviewer runs on the parent model\.$/m,
		replacement:
			"- `model`: the configured `interrogate reviewers` entry, or the table default with no configured line",
	},
];

/** Translate executable Cursor caller guidance to the Pi role and BB worker contracts. */
export function applyPiCallerGuidanceTransforms(text, rel) {
	text = adaptBbCallerGuidance(text, rel);
	text = adaptWatcherTypescript(text, rel);
	for (const replacement of PI_CALLER_GUIDANCE_REPLACEMENTS) {
		if (replacement.rel === rel) {
			text = text.replace(replacement.pattern, replacement.replacement);
		}
	}
	return text;
}

const SINGLE_PROGRAM_PERFORMANCE_GUIDANCE = [
	{
		rel: "skills/poteto-mode/playbooks/perf-issue.md",
		beforeStep: /^3\. Plan the fix from the trace\./m,
		instruction:
			"   For a bottleneck within one executable program, read the installed `~/.agents/skills/perform-like-jeff-and-sanjay/SKILL.md` and use its Diagnose route before selecting the fix. Reuse existing measurements. Distributed-systems performance and ML-hardware tuning stay with domain-specific methods.",
	},
	{
		rel: "skills/poteto-mode/playbooks/hillclimb.md",
		beforeStep: /^5\. Loop, one hypothesis per iteration:/m,
		instruction:
			"   For performance within one executable program, read the installed `~/.agents/skills/perform-like-jeff-and-sanjay/SKILL.md` before the first attempt and use its gated causal hypothesis method for each attempt. Reuse existing measurements. Distributed-systems performance and ML-hardware tuning stay with domain-specific methods.",
	},
];

// Reapply the approved local instructions without freezing the upstream playbooks.
function applyPerformanceGuidance(text, rel) {
	const guidance = SINGLE_PROGRAM_PERFORMANCE_GUIDANCE.find((entry) => entry.rel === rel);
	if (!guidance || text.includes(guidance.instruction)) return text;
	if (!guidance.beforeStep.test(text)) {
		throw new Error(`Approved performance guidance anchor missing: ${rel}`);
	}
	return text.replace(guidance.beforeStep, `${guidance.instruction}\n$&`);
}

export function applyBodyTransforms(text, rel) {
	text = applyPiCallerGuidanceTransforms(text, rel);
	for (let i = 0; i < 20; i++) {
		let next = text;
		for (const seam of SEAMS) {
			next = next.replace(seam.cursor, seam.pi);
		}
		if (next === text) {
			return applyPerformanceGuidance(applyAtomicRoleTransforms(next, rel), rel);
		}
		text = next;
	}
	throw new Error("seam fixpoint did not converge");
}

export function renderWrite(action, paths) {
	const src = join(paths.from, action.rel);
	let text = readFileSync(src, "utf8");
	const parts = action.rel.split("/");
	const base = parts[parts.length - 1];
	if (base === "SKILL.md") {
		text = applyFrontmatterPolicy(text);
	}
	if (action.rel === "skills/poteto-mode/SKILL.md") {
		text = patchPotetoModePi(text);
	}
	if (action.class === "adapt") {
		text = applyBodyTransforms(text, action.rel);
	}
	return text;
}

function writeIfChanged(dest, text, modeSrc) {
	mkdirSync(dirname(dest), { recursive: true });
	if (existsSync(dest) && readFileSync(dest, "utf8") === text) return false;
	const opts = {};
	if (modeSrc && existsSync(modeSrc)) {
		opts.mode = lstatSync(modeSrc).mode & 0o777;
	} else if (existsSync(dest)) {
		opts.mode = lstatSync(dest).mode & 0o777;
	}
	writeFileSync(dest, text, opts);
	return true;
}

function patchCatalogCounts(text, counts) {
	return text
		.replace(
			/assert\.equal\(skills\.length, \d+\)/g,
			`assert.equal(skills.length, ${counts.total})`,
		)
		.replace(
			/assert\.equal\(skills\.filter\(\(skill\) => skill\.hidden\)\.length, \d+\)/g,
			`assert.equal(skills.filter((skill) => skill.hidden).length, ${counts.hidden})`,
		)
		.replace(
			/assert\.equal\(hidden\.length, \d+\)/g,
			`assert.equal(hidden.length, ${counts.hidden})`,
		);
}

function patchReadmeCounts(text, counts) {
	return text
		.replace(/\*\*\d+ skills\*\*/g, `**${counts.total} skills**`)
		.replace(/not all \d+/g, `not all ${counts.total}`)
		.replace(/\d+ playbooks/g, `${counts.playbooks} playbooks`)
		.replace(/\d+ principle skills/g, `${counts.principles} principle skills`);
}

export function applyDerivedPatch(kind, destRoot, counts) {
	if (kind === "catalog-counts") {
		const dest = join(destRoot, "extensions/pstack/skill-catalog.test.ts");
		writeIfChanged(dest, patchCatalogCounts(readFileSync(dest, "utf8"), counts));
		return;
	}
	if (kind === "readme-counts") {
		const dest = join(destRoot, "README.md");
		writeIfChanged(dest, patchReadmeCounts(readFileSync(dest, "utf8"), counts));
	}
}

export function apply(planned) {
	refreshSkillNames(planned.paths.from, planned.paths.to);
	for (const action of planned.actions) {
		if (action.kind === "skip") continue;
		if (action.kind === "write") {
			writeIfChanged(
				action.dest,
				renderWrite(action, planned.paths),
				join(planned.paths.from, action.rel),
			);
			continue;
		}
		if (action.kind === "delete") {
			if (existsSync(action.dest)) unlinkSync(action.dest);
			continue;
		}
		if (action.kind === "patch") {
			applyDerivedPatch(action.derived, planned.paths.to, planned.counts);
		}
	}
}

const LEGACY_PI_CALLER_GUIDANCE_RULES = [
	{
		id: "cursor-loop-command",
		pattern: /\/loop\b/,
	},
	{
		id: "legacy-flat-subagent-call",
		pattern: /subagent\(\s*\{(?!\s*action\s*:)/,
	},
	{
		id: "cursor-run-in-background-field",
		pattern: /\brun_in_background\s*:/,
	},
	{
		id: "cursor-environment-field",
		pattern: /\benvironment`?\s*:/,
	},
	{
		id: "cursor-environment-schema",
		pattern: /catalog schema including `environment`/,
	},
	{
		id: "cursor-runtime-guidance",
		pattern: /\bCursor (?:dashboard|restart)\b/,
	},
	{
		id: "cursor-readonly-field",
		pattern: /\breadonly`?\s*:/,
	},
	{
		id: "cursor-cloud-base-branch-field",
		pattern: /\bcloud_base_branch\b/,
	},
	{
		id: "object-form-runs-run",
		pattern: /\bruns\.run\(\s*\{/,
	},
	{
		id: "unawaited-runs-all-guidance",
		pattern:
			/\b(?:In `workflowScript`, (?:use|launch)[^`\n]*|Inside the script, use|Use) `runs\.all\(\[/,
	},
	{
		id: "task-tool-launch-language",
		pattern:
			/\b(?:[Ll]aunch|[Ss]pawn|[Rr]esume|[Dd]rain|[Ee]xecute|[Rr]un)(?:ed|ing|es|s)?\b[^\n]{0,80}\bTask(?: tool)?\b|\b(?:using|through|via)\s+(?:the\s+)?Task tool\b|\bTask (?:response body|schema)\b/,
	},
];

function isExecutablePiGuidance(rel) {
	return (
		rel === "README.md" ||
		rel === "skills/poteto-help/references/recipes.md" ||
		/^skills\/[^/]+\/SKILL\.md$/.test(rel) ||
		/^skills\/poteto-mode\/playbooks\/[^/]+\.md$/.test(rel)
	);
}

const HISTORICAL_GUIDANCE_LINE = /\b(?:deprecated|historical|legacy|previously|removed)\b/i;

/** Reject stale executable Pi caller examples without scanning historical or third-party reference prose. */
export function assertNoLegacyPiCallerGuidance(destRoot) {
	const rels = walkFiles(destRoot).filter(isExecutablePiGuidance);
	const findings = [];
	for (const rel of rels) {
		const text = readFileSync(join(destRoot, rel), "utf8");
		for (const rule of LEGACY_PI_CALLER_GUIDANCE_RULES) {
			const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
			for (const match of text.matchAll(pattern)) {
				const lineStart = text.lastIndexOf("\n", match.index) + 1;
				const lineEnd = text.indexOf("\n", match.index);
				const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
				if (HISTORICAL_GUIDANCE_LINE.test(lineText)) continue;
				const line = text.slice(0, match.index).split("\n").length;
				findings.push(`${rel}:${line}: ${rule.id}`);
			}
		}
	}
	if (findings.length > 0) {
		throw new Error(`legacy Pi caller guidance remains:\n${findings.join("\n")}`);
	}
}

export function assertNoCursorSeams(destRoot) {
	const skillsRoot = join(destRoot, "skills");
	const rels = walkFiles(skillsRoot).map((rel) => asRelPath(`skills/${rel}`));
	const leftover = [];
	for (const rel of rels) {
		if (matchesAny(rel, DEST_ONLY_NEVER)) continue;
		const fileClass = classify(rel);
		if (fileClass === "pi-only" || fileClass === "never-copy") continue;
		const text = readFileSync(join(destRoot, rel), "utf8");
		if (text.includes("AskQuestion")) leftover.push(`${rel}: AskQuestion`);
		if (text.includes("subagent_type")) leftover.push(`${rel}: subagent_type`);
		if (text.includes("~/.cursor/rules/pstack-models.mdc"))
			leftover.push(`${rel}: pstack-models.mdc`);
		if (text.includes("pstack-models.mdc")) leftover.push(`${rel}: pstack-models.mdc`);
		if (text.includes("cursor-team-kit")) leftover.push(`${rel}: cursor-team-kit`);
		if (text.includes("grok-4.7-xhigh-fast") || text.includes("claude-opus-5-5-max"))
			leftover.push(`${rel}: cursor default slug`);
		if (text.includes("<<<<<<<")) leftover.push(`${rel}: merge marker`);
		if (text.includes("Task subagent")) leftover.push(`${rel}: Task subagent`);
		if (text.includes("$HOME/.cursor")) leftover.push(`${rel}: $HOME/.cursor`);
		if (text.includes("@cursor-skill")) leftover.push(`${rel}: @cursor-skill`);
		if (text.includes("agent-transcripts")) leftover.push(`${rel}: agent-transcripts`);
		if (/Do not glob across `~\/\.pi\/agent\/sessions\/`/.test(text))
			leftover.push(`${rel}: inverted sessions glob`);
		if (/Don't glob across `~\/\.pi\/agent\/sessions\/`/.test(text))
			leftover.push(`${rel}: inverted sessions glob`);
		if (/from \./.test(text)) leftover.push(`${rel}: from .`);
	}
	if (leftover.length) {
		throw new Error(`cursor seams remain:\n${leftover.join("\n")}`);
	}
}

export function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const planned = plan(args);
	if (args.dryRun) {
		printPlan(planned);
		return;
	}
	apply(planned);
	assertNoCursorSeams(args.to);
	assertNoLegacyPiCallerGuidance(args.to);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	}
}
