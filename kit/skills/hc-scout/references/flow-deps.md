# Dependency Tracing Flow (--deps)

Traces downstream consumers of a module or API across repositories using `gh search code`. No running service required — only `gh auth login`.

## § Scope

**What --deps traces:**
- Repos that declare the module in their manifest (package.json, requirements.txt, go.mod)
- Files that actively import the module
- Repos pinned to an old major version (architectural drift)

**What --deps does NOT trace:**
- Transitive consumers (A → B → your module: only B surfaces)
- Consumers that copy-paste code rather than importing the package
- Repos on non-default branches (GitHub code search indexes default branch only)
- Private repos outside the authenticated `--owner` org
- Repos not hosted on GitHub

## § Org Inference

If `--owner` is not provided, infer from current repo's remote:

```bash
# Strip ssh:// scheme and user@ prefix, then extract the org component
git remote get-url origin \
  | sed 's|^ssh://[^@]*@||; s|^[^@]*@||' \
  | sed 's|github\.com[:/]\([^/]*\)/.*|\1|; s|github\.com[:/]\([^/]*\)$|\1|' \
  | sed 's|\.git$||'
```

Handles HTTPS (`https://github.com/org/repo`), SCP-style SSH (`git@github.com:org/repo`), and explicit SSH scheme (`ssh://git@github.com/org/repo`). The second sed has two alternatives: the first handles URLs that include a repo path; the second handles bare org-only URLs without a trailing slash.

Fall back to public-only search if inference fails (log: `ℹ No org inferred — searching public repos only`).

## § 3-Query Fan-Out

Run queries sequentially with a 7-second sleep between each (rate limit: 9 req/min).

### Query 1 — Declared Consumers (package.json)

```bash
gh search code "\"${MODULE_NAME}\"" \
  --filename package.json \
  --owner "${ORG}" \
  --json repository,path,url \
  --jq '[.[] | {repo: .repository.nameWithOwner, file: .path, url: .url}]'
```

- Highest precision; proves declared dependency
- For Python: `--filename requirements.txt` or `--filename pyproject.toml`
- For Go: `--filename go.mod`
- Result: list of `{repo, file}` — declared consumers

Log after: `✓ Deps [1/3]: [N] declared consumers found` then `sleep 7`

### Query 2 — Active Import Sites

TypeScript / JavaScript:
```bash
gh search code "from '${MODULE_NAME}'" \
  --owner "${ORG}" \
  --language typescript \
  --json repository,path,textMatches,url \
  --jq '[.[] | {repo: .repository.nameWithOwner, file: .path, match: .textMatches[0].fragment}]'
```

CJS variant: `"require('${MODULE_NAME}')"`  
Python variant: `"import ${MODULE_NAME}"` or `"from ${MODULE_NAME} import"` with `--language python`

For package names (not local paths), run the TypeScript query first; if the module name suggests Python (no `@`, no `/`), run the Python variant as a second pass.

Log after: `✓ Deps [2/3]: [N] active import sites found` then `sleep 7`

### Query 3 — Version Drift Detection

```bash
gh search code "\"${MODULE_NAME}\": \"${OLD_MAJOR_VERSION}" \
  --filename package.json \
  --owner "${ORG}" \
  --json repository,url \
  --jq '[.[] | {repo: .repository.nameWithOwner, url: .url}]'
```

- OLD_MAJOR_VERSION: the previous major if a newer one exists (e.g., `"1.` if current is `2.x`)
- Skip this query if the current version is not known or the module has never had a major version bump

Log after: `✓ Deps [3/3]: [N] drifted consumers found`

## § Deduplication and Classification

After all queries, merge results and classify each repo:

| Condition | Classification |
|-----------|---------------|
| In both Query 1 AND Query 2 | **ACTIVE** — declared and actively imported |
| In Query 1 only (not in Query 2) | **DECLARED_ONLY** — declared but no import site found; possibly unused or tree-shaken |
| In Query 3 | **DRIFTED** — pinned to old major version |
| In Query 2 but not Query 1 | **IMPLICIT** — importing without manifest declaration (vendored or transitive) |

Dedup by repo name: if same repo appears in multiple queries, classify by the highest-urgency rule (DRIFTED > ACTIVE > DECLARED_ONLY).

## § Consumer Table Format

```markdown
## Consumer Report: <module-name>
**Org:** <org> | **Branch:** default only | **Queries:** declared + import + drift | **Date:** YYYY-MM-DD

| Repo | File | Usage | Notes |
|------|------|-------|-------|
| my-org/service-a | package.json + src/client.ts | ACTIVE | latest version |
| my-org/legacy-api | package.json | DRIFTED | pinned to v1.x — current is v3.x |
| my-org/service-b | package.json | DECLARED_ONLY | no import site found |

**Summary:** [N] consumers — [A] active, [D] declared-only, [Dr] drifted, [I] implicit

⚠ Limitations: default branch only; transitive consumers not traced; results capped at ~1000 per query; language: [detected]
```

Sort order: DRIFTED first (highest urgency), ACTIVE second, DECLARED_ONLY last.

## § Rate Limit Protocol

`gh search code` rate limit: **9 requests/minute** (authenticated). The 3-query fan-out uses exactly 3 requests. 

- Always add `sleep 7` between queries (not between calls to `gh` generally — only between `gh search code` calls)
- If `--deps` is invoked multiple times in rapid succession and hits the limit, `gh` will return a 422 error. Log `⚠ Rate limited — retry in 10 seconds` and retry once

For orgs with >1000 consumers, results are truncated at ~1000. Log: `⚠ Result cap reached ([N] results) — add --filename or --language to narrow scope`.

## § Error Handling

| Condition | Response |
|-----------|----------|
| `gh: not authenticated` | Emit: `✗ --deps requires gh auth login. Run: gh auth login` |
| PR not found / 404 | Skip query, log `⚠ Query [N] failed — skipping` |
| Zero results across all queries | `ℹ No consumers found for <module> in <org>. Scope: default branch, language: [detected].` |
| Org inference fails | Fall back to public search, log: `ℹ No org inferred — searching public repos only` |

## § Module Name Detection

| Input type | Detection | Example |
|------------|-----------|---------|
| Package name | `@` or `/` in name, no file extension | `@my-org/api-client` |
| Local path | Has `/` and extension | `src/api/users.ts` |
| Bare name | No `@`, `/`, or extension | `my-package` |

For local paths: strip directory prefix and extension to derive the module stem; search for the stem as an import pattern (`import.*users` or `from.*users`).
