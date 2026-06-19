# Checks — User-Defined Per-Repo Review Criteria

Teams author `.agents/checks/*.yaml` files to define project-specific criteria that Stage 2 Quality applies in every review. The built-in checklists (`references/checklists/`) are not replaced — these are additive.

## YAML Schema

```yaml
name: "<short human-readable name>"
description: "<one sentence: what convention or invariant this enforces>"
severity: critical | high | medium | low
scope:
  - "<glob pattern>"   # relative to repo root
  - "<glob pattern>"   # one or more patterns; ANY match = check applies
criteria: |
  <Prose description of what to check. Be specific: what to look for,
  what constitutes a violation, and what the correct alternative is.
  The haily-reviewer reads this verbatim — write it as an instruction.>
```

### Field semantics

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ | Shown in the review output heading |
| `description` | ✅ | One-sentence summary |
| `severity` | ✅ | `critical` blocks delivery; `high`/`medium`/`low` are findings |
| `scope` | ✅ | List of glob patterns (use `["**"]` to apply repo-wide) |
| `criteria` | ✅ | Prose instruction for haily-reviewer; be specific |

## Glob Matching Protocol

At Stage 2 entry, the agent:

1. Scans `.agents/checks/*.yaml`. If the directory does not exist or is empty → Stage 2 proceeds unchanged.
2. For each check file: tests whether **any** `scope` glob pattern matches **any** file in the current diff.
   - Glob semantics: `**` matches zero or more path segments (crosses `/`); `*` matches within one segment; `?` matches one character.
   - Example: `src/**/*.ts` matches `src/auth/middleware.ts` but not `tests/auth.test.ts`.
   - Negation (`!`) is **not supported** in `scope` — scope is a positive-match list only. Put exclusions in `criteria` prose ("files in src/repositories/ are exempt").
3. Log `✓ Checks: [N] discovered, [M] matched` before Stage 2 delegation. Unmatched checks generate no output.
4. Matching checks are collected and injected into the haily-reviewer prompt (see § Stage 2 Injection).

## Stage 2 Injection Format

Matching checks are prepended to the haily-reviewer prompt as a dedicated section:

```
## Repo-Specific Checks (from .agents/checks/)

The following project-defined criteria apply to the files in this diff.
Evaluate each criterion and include findings in your review output,
labelled with the check name and severity.

### [HIGH] No console.log in production
Scope matched: src/auth/middleware.ts, src/api/routes.ts
Criteria: Verify that the changed TypeScript files contain no direct calls to
console.log, console.debug, or console.warn. These must use the project logger
(src/lib/logger.ts) instead. Flag each occurrence with its file:line reference.

### [CRITICAL] No hardcoded secrets
Scope matched: src/config/env.ts
Criteria: Check that no string literals resembling API keys, tokens, passwords,
or connection strings appear in the changed files. Secrets must be read from
environment variables only.
```

The standard diff + scout context follows below this block — haily-reviewer evaluates both together.

## Example Check Files

### `no-console-log.yaml`

```yaml
name: "No console.log in production"
description: "Use the project logger instead of raw console methods"
severity: high
scope:
  - "src/**/*.ts"
  - "src/**/*.tsx"
criteria: |
  Verify that changed files contain no direct calls to console.log, console.debug,
  console.warn, or console.error. Every logging call must use the project's
  structured logger at src/lib/logger.ts (e.g. logger.info(), logger.error()).
  Flag each occurrence with file:line. Exception: test files and scripts/ are exempt.
```

### `no-raw-sql.yaml`

```yaml
name: "No raw SQL in application layer"
description: "All DB queries must go through the repository layer"
severity: critical
scope:
  - "src/**/*.ts"
criteria: |
  Check that changed files contain no raw SQL strings — template literals or
  string constants containing SELECT, INSERT, UPDATE, DELETE, or FROM keywords.
  Exception: files under src/repositories/ and src/db/ are the designated query
  layer and are exempt. Flag any violation with file:line and the SQL fragment found.
  All application-layer code must use the repository abstraction in src/repositories/.
```

### `require-error-boundary.yaml`

```yaml
name: "React components need error boundaries"
description: "Top-level page components must be wrapped in an ErrorBoundary"
severity: medium
scope:
  - "src/pages/**/*.tsx"
  - "src/app/**/*.tsx"
criteria: |
  For each changed page/route component file, verify that the component is either:
  (a) wrapped in <ErrorBoundary> in its parent, or
  (b) uses the withErrorBoundary HOC.
  Components that render only layout primitives (no data fetching, no async ops)
  are exempt. Flag missing error boundaries with file:line.
```

## Creating Your First Check

1. Create `.agents/checks/` in your repo root. **Note:** `.agents/` is gitignored by default in HailyKit repos, so check files will not be committed or shared with teammates. For team-wide sharing, un-ignore the directory: add `!.agents/checks/` to your `.gitignore`, or store check files at `.checks/*.yaml` (committed path) and point teammates there.
2. Copy one of the examples above, save as `.agents/checks/<kebab-name>.yaml`.
3. Set `scope` to the file patterns where the convention applies.
4. Write `criteria` as a direct instruction to a code reviewer — specific, actionable, with the correct alternative.
5. Run `{skill:hc-review} --pending` to see the check applied to your next diff.

## Backward Compatibility

If `.agents/checks/` does not exist, contains no `.yaml` files, or no check's scope matches the current diff: Stage 2 runs exactly as it did before this feature existed. No behavior change for repos without check files.
