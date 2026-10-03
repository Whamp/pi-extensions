### Shipping

**You own what lands. Verify each PR independently and merge only the PRs whose landing is authorized.**

Read `../references/branch-workflow.md`. This procedure follows `babysit.md`. It does not create or land dependent PR stacks.

1. **Resolve the forge and scope.** GitHub CLI is the default. Use the repository's configured forge if its supported interface is available. Freeze the requested PR inventory. Every open PR must target the actual default branch. If a PR targets another worker branch, stop that PR and report the unsupported dependency. Do not retarget it silently.
2. **Verify each PR independently.** Use a fresh reviewer that did not write its code. Give it the immutable base and head commits, the applicable checks, and the real artifact. It exercises the relevant behavior and reports PASS, PASS+NOTES, or FAIL with evidence. PASS and PASS+NOTES pass. CI green and bot approval do not replace this verdict. Keep blocked coverage explicit.
3. **Check the published head.** Read the current PR head, base, CI, review state, and mergeability. The verdict must describe that exact head. If the owner rebases or pushes, rerun applicable checks and obtain the required review at the new head. A matching patch-id alone does not make an older SHA verdict current.
4. **Prepare through the owning branch tool.** The branch owner updates its own lane against current trunk when needed. Nobody else changes that branch while the owner can write. A local Lane merge must not bypass required PR approval or protected-trunk rules. Repeat step 3 after a branch update.
5. **Merge one authorized PR at a time.** On GitHub, use `gh pr merge <pr> --squash --match-head-commit <verified-sha>`. Arm `--auto` only when the user's grant includes merge-when-ready. Respect all forge-enforced approvals and merge-queue requirements. A head mismatch stops landing and returns the PR to verification.
6. **Confirm landing.** Read the forge's state until the PR is MERGED or has a terminal blocker. Auto-merge being armed is not proof of a merge. Use an observable sidecar or a session-owned `until` condition watch for the wake. Do not add a sleep loop. Cancellation, closed-without-merge state, and failed required checks must not be reported as success.
7. **Refresh after each merge.** Fetch the actual trunk and confirm the merged change is present. Refresh program records, inspect remaining PRs, and recompute their current heads and eligibility. Numeric PR order is not a dependency order. Unverified PRs do not block unrelated verified PRs.
8. **Stop at the authority boundary.** Report each merge and every remaining gap. Leave PRs without current verification or approval unmerged. Do not expand the requested inventory. Clean up landed lanes only after confirming no uncommitted work or later commits would be lost.

**Reply.** Each PR's verdict and reviewer, what landing was authorized, what was armed, what actually merged, and what remains blocked or unverified.
