# Issue Triage Protocol

Discover, prioritize, and delegate GitHub issues to the implementation loop. One issue per invocation unless `--loop` is set.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--auto` | off | Skip interactive pick; choose highest-priority issue automatically |
| `--loop` | off | After closing one issue, pick the next (requires `--auto`) |
| `--filter <label>` | (none) | Restrict to issues with this label |
| `--max <N>` | 20 | Max issues to fetch |

## Priority Playbook

Issues are classified P1–P5 from labels and title keywords. Within a tier: more comments first, then oldest first.

| Priority | Labels / keywords | Examples |
|---|---|---|
| P1 | `bug`, `critical`, `security`, `blocker` | Login crash, data corruption, CVE |
| P2 | `test`, `ci`, `types`, `tooling`, `dx`, `infra` | Missing tests, type errors, CI failures |
| P3 | `feature`, `enhancement`, `feat` | New endpoint, new skill, new flag |
| P4 | `docs`, `polish`, `style`, `chore`, `ux` | Docs update, error message wording |
| P5 | `refactor`, `tech-debt`, `cleanup` | Code restructuring, dead code removal |
| — | (unlabeled) | Treat as P3 |

## Protocol

1. **Discover** — `gh issue list --state open --json number,title,body,labels,assignee,comments --limit <max>`. Apply `--filter` if set.

2. **Prioritize** — Classify each issue P1–P5. Sort by (priority asc, comment count desc, created_at asc). Print a compact table:

   ```
   [issues] 12 open issues (P1: 2, P2: 3, P3: 5, P4: 2)
   #42  P1  [bug, critical]  Login fails on Safari
   #17  P2  [ci]             Add type coverage
   ...
   ```

3. **Pick**
   - **Interactive (no `--auto`):** `AskUserQuestion` (header "Issue to work on") with top 4 issues as options.
   - **Auto (`--auto`):** Pick the top-ranked issue; log the choice.

4. **Assign** — If the selected issue has no assignee: `gh issue edit <number> --add-assignee @me`

5. **Delegate** — Build a goal description and invoke `{skill:hc-goal}`:

   ```
   Goal: "<title> (fixes #<number>)"
   Context: <issue body, first 600 chars>
   ```

6. **Close** — After `{skill:hc-goal}` completes: `gh issue close <number> --comment "Resolved — see commits above."`

7. **Loop** — If `--loop` is set: re-fetch issues (closed one won't appear) and repeat from step 1. Stop when no issues remain or user interrupts.

## Output Format

```
[issues] Found 12 open issues (P1: 2, P2: 3, P3: 5, P4: 2)
[issues] Working on #42 — P1 — Login fails on Safari
[hc-goal] ...
[issues] ✓ Closed #42
```

## Constraints

> **Required — single issue per delegation:** Delegate exactly one issue to `{skill:hc-goal}` at a time. Never batch multiple issues into one goal description.

> **Required — no close without completion:** Only call `gh issue close` after `{skill:hc-goal}` reports the work done. If `hc-goal` exits with unresolved tasks, comment progress on the issue instead of closing.

## Edge Cases

| Condition | Action |
|-----------|--------|
| `gh` not authenticated | Stop; print `gh auth login` |
| No open issues | "No open issues found." |
| All issues assigned to others | Show list anyway; note assignments; `AskUserQuestion` to confirm |
| `hc-goal` exits incomplete | `gh issue comment <number> --body "Partial progress: <summary>"` — do not close |
| `--loop` without `--auto` | Warn: `--loop requires --auto`; exit |
