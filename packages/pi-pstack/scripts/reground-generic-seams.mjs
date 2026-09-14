import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EXTENSION_COMMANDS = new Set(["/poteto-mode", "/setup-pstack", "/pstack"]);

const CURSOR_SLUG_ALT =
	"grok-4\\.6-fast-xhigh|claude-fable-5-1-thinking-max|gpt-5\\.6-sol-max|claude-opus-5-thinking-xhigh";
const CURSOR_DEFAULT_SLUGS = new RegExp(
	"`?(?:" + CURSOR_SLUG_ALT + ")`?(?:\\s*,\\s*`?(?:" + CURSOR_SLUG_ALT + ")`?)*",
	"g",
);

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
		pi: 'subagent({ action: "execute", input: { agent: "poteto-agent", task } })',
	},
	{
		id: "subagent-sicko",
		cursor: /subagent_type:\s*"Comment Sicko"/g,
		pi: 'subagent({ action: "execute", input: { agent: "comment-sicko", task } })',
	},
	{
		id: "subagent-worker",
		cursor:
			/`subagent_type`:\s*`generalPurpose`|subagent_type:\s*"generalPurpose"|subagent_type:\s*`?generalPurpose`?/g,
		pi: 'agent: "worker"',
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
		pi: "the subagent catalog",
	},
	{
		id: "task-response",
		cursor: /`Task` response body/g,
		pi: "workflow result",
	},
	{
		id: "task-schema",
		cursor: /Task schema/g,
		pi: "subagent catalog schema",
	},
	{
		id: "background-field",
		cursor: /run_in_background/g,
		pi: "async",
	},
	{
		id: "cloud-base-branch",
		cursor: /cloud_base_branch/g,
		pi: "baseRef",
	},
	{
		id: "cloud-environment",
		cursor: /`environment: "cloud"`/g,
		pi: "`async: true`",
	},
	{
		id: "local-environment",
		cursor: /`environment: "local"`/g,
		pi: "`cwd` for the required local checkout",
	},
	{
		id: "readonly-true",
		cursor: /`readonly`: `true`/g,
		pi: '`task`: instruct the child to inspect only and not modify files',
	},
	{
		id: "readonly-false",
		cursor: /`readonly`: `false`/g,
		pi: '`task`: state whether the child may modify files',
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
		pi: "the injected pstack role table",
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
		cursor: /(?<![\w/])\/([a-z][a-z0-9-]*)\b/g,
		pi: (m, name) => {
			if (EXTENSION_COMMANDS.has(`/${name}`)) return m;
			if (!skillNamesForSlash.has(name)) return m;
			return `/skill:${name}`;
		},
	},
];

export function refreshSkillNames(fromRoot, toRoot) {
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

