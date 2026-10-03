# Branch and program workflow

Use the repository's branch and worktree tool. In a Lane-adopted repository, use Lane. Follow the caller's AGENTS.md for other repositories. Installing a tool does not select it for a program.

## Independent PRs

Discover the actual default branch before creating branches or PRs. Do not assume `main`, `master`, or a particular remote name. On GitHub, read `gh repo view --json defaultBranchRef` from the selected repository.

Each PR targets that default branch. Run independent changes in parallel, with one writer per branch and worktree. Start dependent work after its prerequisite merges. Keep tightly coupled work in one lane and one PR when it must be reviewed together.

Do not construct dependent PR stacks, retarget PRs to worker branches, or use Graphite. A request to build a stack follows the review-only queue procedure in `../playbooks/autopilot-stack.md`. It preserves human review without constructing a branch chain.

## Branch ownership and landing

Use Lane to create and prepare lanes where adopted. `lane push` rebases onto the lane's base before pushing. That can change the head SHA. Verify the final published head, not an earlier commit.

GitHub CLI handles PRs, comments, checks, and authorized remote merges. It is not a second branch manager. A local `lane merge` must not bypass a repository's required PR review or protected-trunk workflow. After remote landing, confirm the change is on trunk before using Lane to clean up the worktree.

A coordinator may transfer a branch only after the previous writer has stopped and cannot continue writing. A failed stop does not authorize a replacement on the same branch. Keep write targets separate and report the blocker. A different worktree does not isolate two pushes to the same branch.

## Shared program directory

At program start, select one directory under the primary project checkout:

```text
<primary-checkout>/.pi/pstack/programs/<program-name>/
```

Use the following location when records must outlive the checkout or cover several repositories:

```text
~/.pi/pstack/programs/<project-id>/<program-name>/
```

Resolve the directory to an absolute path once. Pass it as `--store` or `ORCH_STORE` to every `orch` call. Include the same path in worker briefs, reports, and resume instructions. Never derive a new store from a worker's current directory. Confirm that project-local records are Git-ignored before writing them.

Model-routing documents remain policy inputs. Do not write changing job, PR, or verification records into them. Each `orch` register covers one repository because ledger keys use PR numbers. A multi-repository program uses separate named registers within its global program directory.

## PR snapshots

Orchestrate refreshes only PRs recorded in its `units.tsv`, or an explicit `--prs` inventory that includes those recorded PRs. It does not enroll all open PRs in the repository. An empty register remains valid after `orch init`; refresh it after the first PR is recorded.

`orch frontier set --repo <checkout>` reads GitHub's default branch, PR state, and remote head SHA. Open PRs on another base or still in draft fail the refresh. Closed and merged PRs remain historical records. Snapshot order is only numeric presentation order. It is not a dependency chain or a merge authorization.

Refresh before evaluating a verification result. Check the ledger using the snapshot's current head SHA. An old verdict remains history and does not verify a new head. A successful snapshot refresh does not prove CI, approval, or merge readiness. Before an authorized GitHub merge, use `gh pr merge --match-head-commit <verified-sha>` to reject a changed head.
