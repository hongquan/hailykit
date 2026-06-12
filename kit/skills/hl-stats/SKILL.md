---
name: hl-stats
description: "Project code statistics — file counts, nLOC, complexity hotspots, LLM token estimate, COCOMO cost, test ratio, TODO/FIXME debt markers, oversized files, plus git insights: churn × complexity risk hotspots, bus factor, ownership, stale files, commit velocity, contributors, release cadence."
when_to_use: "Invoke when you need a codebase size snapshot, want to find high-complexity or high-risk (churn × complexity) hotspots, need a token budget before loading files into an LLM context, or want manager-facing metrics (COCOMO cost, bus factor, velocity, release cadence)."
user-invocable: true
argument-hint: "[path] [--json] [--lang <list>] [--top <n>] [--exclude <pattern>] [--since <days>] [--salary <n>] [--no-git]"
metadata:
  category: dev-tools
  keywords: [stats, metrics, loc, ncloc, complexity, hotspots, token, codebase, size, language]
---

# Stats — Project Code Metrics

Collect and display code statistics for a codebase path: file counts, nLOC, language breakdown (with comment density), complexity hotspots, LLM token estimate, COCOMO effort/cost estimate, test ratio, TODO/FIXME/HACK debt markers, oversized files, and git-history insights (risk hotspots, bus factor, ownership, stale files, 12-week commit velocity, contributor activity, release cadence). Runs on Haiku — fast and cheap.

## Usage

```
{skill:hl-stats} [path] [--json] [--lang <list>] [--top <n>] [--exclude <pattern>] [--since <days>] [--salary <n>] [--no-git]
```

| Flag | Behavior |
|------|----------|
| *(none)* | Human-readable table — language breakdown, COCOMO estimate, hotspots, git insights |
| `--json` | Compact JSON schema (`v`, `summary`, `cocomo`, `git`, `hotspots`, `thresholds`) |
| `--lang ts,py` | Filter to specific languages (name or extension) |
| `--top N` | Show top N complexity hotspots (default: 10) |
| `--exclude pattern` | Skip paths containing this substring |
| `--since <days>` | Git churn window in days (default: 180) |
| `--salary <n>` | Average annual salary for COCOMO cost (default: 56286 USD, scc-compatible) |
| `--no-git` | Skip git-history insights — also auto-skipped outside a git repo |

```
{skill:hl-stats}                     # scan current directory
{skill:hl-stats} ./src               # scan ./src subtree
{skill:hl-stats} ./cli --lang ts     # TypeScript files only
{skill:hl-stats} . --json            # machine-readable output
{skill:hl-stats} . --since 90        # churn over the last quarter
{skill:hl-stats} . --salary 120000   # COCOMO cost at local salary levels
```

## Process

Spawn `Task(subagent_type="haily-stats")` with the target path and all provided flags. Present the returned output directly.

## Output

**Table mode (default):** per-language rows (files · nLOC · comments + density % · complexity), COCOMO estimate, test ratio, debt markers, oversized files, complexity hotspots, then git insights — risk hotspots (churn × complexity), bus factor with top owners, stale files, 12-week activity sparkline, contributors, release cadence.

**JSON mode (`--json`):** structured schema — use for agent pipelines or follow-up analysis.

```json
{
  "summary": { "files": 54, "ncloc": 4376, "complexity": 1002, "token_est": 78768 },
  "tests": { "test_files": 10, "source_files": 49, "test_ncloc": 1145, "test_ncloc_ratio": 0.29 },
  "debt_markers": { "todo": 3, "fixme": 3, "hack": 3, "top": [{ "file": "report.ts", "total": 3 }] },
  "oversized": { "threshold": 200, "count": 4, "top": [{ "file": "merger.ts", "ncloc": 372 }] },
  "cocomo": { "effort_months": 12.2, "schedule_months": 6.5, "people": 1.9, "cost_usd": 137473, "salary_usd": 56286 },
  "git": {
    "window_days": 180, "bus_factor": 2,
    "owners": [{ "author": "alice", "share": 48 }],
    "risk_hotspots": [{ "file": "cli/installer/merger.ts", "risk": 710, "churn": 5, "complexity": 142 }],
    "stale_days": 365, "stale_total": 3, "stale": [{ "file": "legacy/parser.ts", "last": "2024-01-02" }],
    "activity": {
      "weekly_commits": [0, 1, 4, 2, 0, 3, 5, 2, 1, 0, 2, 8], "avg_per_week": 2.3,
      "active_authors_90d": 2, "total_authors": 3,
      "last_release": { "tag": "v1.6.7", "date": "2026-06-12" }, "releases_per_month": 1.3
    }
  },
  "hotspots": [{ "file": "cli/installer/merger.ts", "ncloc": 372, "complexity": 142 }],
  "thresholds": { "complexity_warn": 15, "complexity_error": 25, "file_loc_warn": 200 }
}
```

Reading the metrics:

- `token_est = ncloc × 18` — budget how many files fit in an LLM context window before loading them.
- `risk = churn × complexity` — files that are both complex and frequently changed; the highest-priority refactor targets (CodeScene's hotspot model).
- `bus_factor` — minimum number of contributors whose owned files cover ≥50% of nLOC; 1 means a single knowledge island.
- `cocomo` — COCOMO 81 organic-mode replacement-cost estimate (same model as scc); directional, not a bid.
- `tests.test_ncloc_ratio` — test nLOC / source nLOC; a fast coverage proxy without running a test runner.
- `debt_markers` — lines containing TODO/FIXME/HACK (word-boundary match); strings that merely mention the words also count, as in any grep-based counter.
- `activity.weekly_commits` — 12 weekly buckets, oldest → newest; rendered as a sparkline in table mode.
- `git: null` — path is not a git repo or `--no-git` was passed; all other metrics still work.

Thresholds: `⚠ complexity ≥ 15` · `✗ complexity ≥ 25` · file size warn ≥ 200 lines.

Auto-excluded: `node_modules` · `dist` · `.git` · `.next` · `coverage` · `__pycache__` · `target` · `.venv`.

## Workflow Position

**Standalone** — no required predecessor or successor.
**Use before:** {skill:hc-plan}, {skill:hl-research} — understand codebase scope before planning work.
**Use after:** implementation phases — verify complexity and file-size budgets stayed within thresholds.
**Related:** {skill:hc-scout} (file search + dependency map), Task(subagent_type="haily-tech-analyst") (full tech debt inventory).
