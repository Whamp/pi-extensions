### Review-only PR queue

This file retains the former Autopilot-stack entry point. It no longer constructs a dependent PR stack.

1. Read `../references/branch-workflow.md` and `autopilot-full.md`. Use one owner per independent PR and the same build, verification, review, and supervision requirements.
2. State the plan and wait for the operator's explicit go. Record that owners may build, push, open ready PRs, and verify them. They may not merge, arm auto-merge, or close PRs.
3. Every PR targets the repository's actual default branch. Run independent changes in parallel. Start dependent work after its prerequisite merges. Keep tightly coupled work in one lane and one PR. Do not rebase PRs onto worker branches.
4. Each owner reports REVIEW-READY with its exact published head SHA and verification evidence. The coordinator checks those receipts and the current PR head. Any changed head requires a new verdict.
5. Deliver the independent PR links, verdicts, and pending dependencies. The operator reviews and authorizes landing through `shipping.md`. A dependent unit remains pending until its prerequisite lands.
6. On a hold, send a zero-writes order to every owner. Confirm each writer stopped before transferring its branch to another agent.

Choose this procedure when the operator wants review before landing or has withheld merge authority. Choose Autopilot-full when independent PRs may be merged under an explicit landing grant.

**Reply.** The PR links, each verified head and verdict, pending dependencies, and the approvals still needed.
