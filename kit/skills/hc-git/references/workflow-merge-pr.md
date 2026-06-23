# Merge-PR Workflow

Review each PR with `haily-reviewer`, then label, merge, and watch CI to completion
via `haily-git-manager`. CI failure convergence delegates to `{skill:hc-fix}`.

## Variables

- `PR_REFS` — one or more PR numbers or GitHub PR URLs (input order preserved)
- `BASE` — target branch (read from each PR's `baseRefName`)
- `SHA` — merge commit hash (captured after each merge)
- `MERGE_METHOD` — `--squash` | `--merge` | `--rebase`

## Step 1: Validate PRs

```bash
gh auth status
for PR in $PR_REFS; do
  gh pr view "$PR" --json number,state,url,title,baseRefName,headRefName,mergeStateStatus,statusCheckRollup
done
```

Collect all refs that are invalid, closed, or inaccessible. If any exist: **stop the
entire batch** and report them before taking any action.

## Step 2: Review Gate

For each PR, delegate a full code review:

```
Task(haily-reviewer): review PR <N> — flag all Critical and Important findings
```

Gate passes only when all hold: zero Critical and zero Important findings, no merge
conflicts, all required CI checks green.

Any unresolved blocker → **halt the entire batch**; report PR number + blockers +
recommended fix. Never proceed to label or merge.

## Step 3: Label Tracking

Ensure the label exists (idempotent — treat "already exists" as success):

```bash
gh label create "ready to ship" --color "0E8A16" --description "Reviewed and ready to merge"
```

Apply to each reviewed-ready PR:

```bash
gh pr edit "$PR" --add-label "ready to ship"
```

Failure other than "already exists": stop and report the exact `gh` error.
Permission limitation only: warn and continue (non-blocking).

## Step 4: Ordered Merge

Detect allowed merge methods, then select in preference order (`--squash` > `--merge` > `--rebase`):

```bash
gh repo view --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed
```

Merge one at a time, strictly in input order. Before each merge, re-fetch current state:

```bash
gh pr view "$PR" --json mergeStateStatus,statusCheckRollup,baseRefName
```

Checks **green** → merge immediately:

```bash
gh pr merge "$PR" --delete-branch $MERGE_METHOD
```

Checks **pending** (branch protection waiting):

```bash
gh pr merge "$PR" --auto --delete-branch $MERGE_METHOD
```

Never force-push. Never direct-push to `main`, `master`, `production`, or `release/*`.

## Step 5: Post-Merge CI Watch

Capture the merge commit:

```bash
gh pr view "$PR" --json baseRefName,mergeCommit
```

Watch CI on the target branch for that exact commit:

```bash
gh run list --branch "$BASE" --commit "$SHA" --json databaseId,status,conclusion,name,url
gh run watch "$RUN_ID" --exit-status
```

If no run appears immediately, poll briefly before concluding no CI exists for this merge.

## Step 6: CI Failure Convergence

On target-branch CI failure:

1. Inspect logs:
   ```bash
   gh run view "$RUN_ID" --json status,conclusion,jobs
   gh run view "$RUN_ID" --job "$JOB_ID" --log
   ```
2. **Transient infra failure** → rerun once:
   ```bash
   gh run rerun "$RUN_ID" --failed
   ```
3. **Deterministic/repo-fixable failure** → activate:
   ```
   `{skill:hc-fix}` --auto "Fix post-merge CI failure: <workflow, run id, job id, exact error>"
   ```
   Ship the fix through PR → review (Step 2) → merge (Step 4) → re-watch CI (Step 5).

**Stop** (per PR) when: CI succeeds · an external blocker persists · the same blocker survives **3 fix-PR cycles** for that PR. Each fix-PR must itself re-clear the review gate (Step 2) before the cycle counter increments.

## Invariants

1. A PR is never merged without passing the review gate (Step 2).
2. Post-merge CI is always monitored — never exit until green or a documented blocker.
3. Merge order = input order, strictly.
4. Head branch is deleted after every successful merge.
5. Force-push and direct-push to protected branches are forbidden.

## Output Format

**Success:**
```
reviewed: PR #123 — approved, CI green
labeled:  PR #123 — ready to ship
merged:   PR #123 into main (SHA abc1234)
CI:       green for abc1234
```

**Blocked:**
```
stopped:    PR #123 not merge-ready
reason:     <finding / check / merge blocker>
suggestion: <next action>
```

## Error Handling

| Error | Action |
|-------|--------|
| Invalid / closed / inaccessible PR ref | Stop all; report before any action |
| Review: Critical or Important finding | Halt batch; report PR + blockers + fix |
| Review: merge conflict | Halt batch; surface for manual resolution |
| Label failure (non-permission error) | Stop; report exact `gh` error |
| Label failure (permission limited) | Warn and continue |
| Merge conflict at merge time | Stop; surface for manual resolution |
| No CI run after polling | Treat as no CI for this merge; continue |
| CI transient infra failure | Rerun once (`gh run rerun --failed`) |
| CI deterministic failure | `{skill:hc-fix}` `--auto`; max 3 attempts |
| Same CI blocker after 3 fix-PR cycles (per PR) | Stop; report as external blocker |
