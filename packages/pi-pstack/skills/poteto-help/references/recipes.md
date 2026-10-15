# Prompts worth copying

Swap in the real paths, skills, and done checks. Informal wording works.

## Understand

- `/poteto-mode read <thread>. restate the underlying issue in your own words, in plain english.`
- `/poteto-mode investigate why <symptom>. give me what we know, what data you used, and your best hypotheses. don't change any code yet.`
- `use /skill:how to understand <subsystem>. then use /skill:why to find out why it broke recently.`
- `/skill:recall my work on <topic> from last week, then read <issue>.`
- `/skill:in-your-own-words` restates the user's goals and underlying problem.
- `/skill:teach me why you implemented it this way and not <other way>. what did you trade off?`
- `/poteto-mode take over this branch. read the decision log, find what's done, and continue. don't redo finished work.`

## Build

- Bug: `/poteto-mode <symptom>. repro first, then fix and verify.`
- Bug in an app: `/poteto-mode repro this with /verify-<app>. if it repros on main, fix it and show me a video as proof.`
- Bug with a cheap test: `/poteto-mode repro <bug> first. if there's a cheap test path, /skill:tdd it. then fix and rerun.`
- Feature: `/poteto-mode add <behavior>. <current output> stays byte-identical. verify both.`
- Refactor: `/poteto-mode move <code> into one module, zero behavior change. record the current output first and prove it's unchanged after.`
- Perf: `/poteto-mode <operation> takes <time> on <fixture>. trace it, fix the measured cause, show me before and after.`

## Design and plan

- `/skill:sharpen <task>` refines the approach and constraints, then does the work.
- `/poteto-mode prototype a few options for <feature>. take screenshots or videos for me to compare.`
- `/poteto-mode we need <feature>. /skill:architect it first, and answer open questions with prototypes. let me review before proceeding.`
- `/poteto-mode write a tutorial for how i would use <new package> first. then /skill:teach me why it beats the current one.`
- `ask /skill:arena for a second opinion on this thread and our approach.`
- `/poteto-mode turn this design into a plan. small verifiable PRs, each with its own verification steps.`
- `/poteto-mode plan the migration of <library> to <target>. small verifiable PRs. the result must match the original exactly, bugs included.`

## Review and ship

- `/skill:interrogate the whole branch, but skeptically. don't change anything yet. no nitpicks unless it's a real bug or regression.` Read the dismissals too.
- `/skill:swarm check every package under <dir> against its check script. one worker per package. one report.`
- `/poteto-mode open the pr. small ordered commits, evidence in the description.`
- `/poteto-mode babysit this pr. get it green.` For status only: `/poteto-mode check on pr <number>. anything outstanding?`
- `/poteto-mode land the stack.`

## Away and back

Check recurrence capabilities before using the away recipe. When available, use one bounded `until` recurrence in the owning live Pi session. Give it a positive done predicate, an explicit timeout, and a stop or cancel condition. For work that must survive a crash or session replacement, use an existing durable scheduler instead. If the required capability is missing, report a capability blocker and do not invent a wake mechanism.

- `/poteto-mode im going to bed. <goal> in a fresh worktree off <base>. done means <positive checks>. keep a decision log. don't ask me before committing. check for a bounded live-session until recurrence, or an existing durable scheduler if this must survive session loss. recheck every <interval>, with timeout <duration>. stop and cancel the recurrence when done, when i say stop, or at timeout. if the required capability is missing or you're truly stuck, stop and report the blocker.`
- `/skill:ketchup` catches you up on changes since your last message and names any decisions only you can make.
- `/skill:show-me-your-work catch me up on what you did last night.` Read its Attention section first.
- `/poteto-mode full autopilot on this queue. each item is independent.`
- `/poteto-mode autopilot these changes but stack them, don't ship. i'll land the stack.`
- `/skill:reflect capture what we learned so the next run doesn't repeat it.` Approve only edits that change a future decision.
- `/skill:bro` restates the last reply in plain words.
