# Git Automation Compatibility

hc-ship runs in repos that already automate parts of the release. **Detect the repo's regime first, then adapt — never fight it, never bypass it.** The cardinal rule: if the repo delegates a concern (versioning, changelog, tagging, release) to a tool, hc-ship must NOT also do it manually.

> **Required — never bypass:** Never `git commit --no-verify`, `git push --no-verify`, or `-c commit.gpgsign=false`. Hooks and policies are part of the contract. If one rejects, fix the cause.

## 1. Release Regime Detection (gates Steps 6, 7, 13)

Detect who owns **version bump + changelog + tag + GitHub release**. First match wins; once matched, hc-ship delegates those steps.

| Regime | Detection signal | hc-ship behavior (Steps 6/7/13) |
|--------|------------------|---------------------------------|
| **semantic-release** | `.releaserc*`, `release.config.{js,cjs,mjs,json}`, or `semantic-release` in `package.json` devDeps | **Delegate fully.** Do NOT bump/changelog/tag/release. Ensure commits are conventional (semantic-release derives the version from them). Merge to the release branch; CI's semantic-release versions, tags, changelogs, and publishes. |
| **release-please** | `release-please-config.json`, `.release-please-manifest.json`, or `googleapis/release-please-action` in a workflow | **Delegate fully.** Land conventional-commit PRs only. The release-please bot maintains a "release PR" with version + CHANGELOG; releasing = merging that bot PR (do so only if the user asks). |
| **changesets** | `.changeset/config.json` | **Add a changeset, don't bump.** Write `.changeset/<slug>.md` with the bump level + summary instead of editing version/CHANGELOG. CI consumes changesets to version + publish. |
| **standard-version / commit-and-tag-version** | dep present, or `scripts.release` invokes it | **Delegate to the script.** Run `npm run release` (it bumps + changelogs + tags atomically), then push commits + tags. Don't hand-edit version/CHANGELOG. |
| **GoReleaser** | `.goreleaser.{yml,yaml}` | Tag-triggered. Push the tag; GoReleaser (in CI) builds + publishes. Do NOT `gh release create`. |
| **Tag-triggered release workflow** | a `.github/workflows/*.{yml,yaml}` with `tags:` under `on: push:` AND a release publisher (`gh release create`, `softprops/action-gh-release`, `actions/create-release`, `ncipollo/release-action`) | Push the tag; CI publishes. Enrich notes via `gh release edit` only (best-effort). |
| **Manual (no match)** | — | hc-ship owns version + changelog + tag + release (the default flow in Steps 6/7/13). |

**Detection script (release regime):**
```bash
REGIME="manual"
if ls .releaserc* release.config.* 2>/dev/null | grep -q . || node -e "const d={...require('./package.json').devDependencies,...require('./package.json').dependencies};process.exit(d['semantic-release']?0:1)" 2>/dev/null; then REGIME="semantic-release"
elif ls release-please-config.json .release-please-manifest.json 2>/dev/null | grep -q . || grep -rqs "release-please-action" .github/workflows 2>/dev/null; then REGIME="release-please"
elif [ -f .changeset/config.json ]; then REGIME="changesets"
elif node -e "const d={...require('./package.json').devDependencies,...require('./package.json').dependencies};process.exit(d['standard-version']||d['commit-and-tag-version']?0:1)" 2>/dev/null; then REGIME="standard-version"
elif ls .goreleaser.y*ml 2>/dev/null | grep -q .; then REGIME="goreleaser"
elif ( for wf in .github/workflows/*.y*ml; do [ -f "$wf" ] && grep -qE '^\s*tags:' "$wf" && grep -qiE 'gh release create|action-gh-release|create-release|release-action' "$wf" && exit 0; done; exit 1 ); then REGIME="tag-workflow"
fi
echo "$REGIME"
```

Log the detected regime in Step 1 pre-flight, e.g. `✓ Release regime: changesets (version/changelog delegated)`.

## 2. Commit-Time Compatibility (Step 10)

Hooks run via husky, lefthook, `pre-commit`, simple-git-hooks, or `core.hooksPath`. hc-ship must cooperate:

| Situation | Detection | Behavior |
|-----------|-----------|----------|
| **Hook reformats staged files** (prettier/eslint --fix/gofmt via lint-staged) | working tree dirty after `git commit`, or `lint-staged` in config | lint-staged re-stages automatically. If the tree is still dirty with hook-applied formatting, `git add -A && git commit --amend --no-edit`. Never `--no-verify`. |
| **Hook rejects** (lint/type/test/secret gate) | non-zero commit exit | Read the error; fix the real cause (lint, type, secret) and retry. Do not bypass. |
| **commitlint / conventional enforcement** | `commitlint.config.*`, `.commitlintrc*`, or `@commitlint` dep | Conform the message to the repo config — read it for allowed `type`/`scope` enums before composing. |
| **GPG/SSH signing required** | `git config commit.gpgsign` = true | Let the commit sign normally. If signing fails, surface it — never `-c commit.gpgsign=false`. |
| **DCO sign-off required** | `Signed-off-by` in CONTRIBUTING, or DCO app on repo | Commit with `git commit -s`. |

## 3. Push-Time Compatibility (Step 11)

| Situation | Detection | Behavior |
|-----------|-----------|----------|
| **pre-push hook** (tests/build) | hook present | Let it run. If it fails, fix — don't `--no-verify`. |
| **Branch protection blocks direct push** | `gh api repos/{owner}/{repo}/branches/{branch}/protection` ≠ 404 | Never push to a protected target directly. Always go feature-branch → PR (Step 12). If hc-ship inferred direct-to-target, switch to a feature branch first. |
| **Linear history required** | protection `required_linear_history` | Merge via squash or rebase only (see Step 12). |

## 4. PR & Merge Compatibility (Step 12)

| Situation | Detection | Behavior |
|-----------|-----------|----------|
| **Required reviews / CODEOWNERS** | protection `required_pull_request_reviews`, or `.github/CODEOWNERS` | hc-ship **stops after creating the PR** — do not auto-merge. Output: "PR open, awaiting required review." |
| **Required status checks** | protection `required_status_checks` | Wait for those checks (Step 12 already does); merge only when green. |
| **Merge method restriction** | `gh api repos/{owner}/{repo}` → `allow_squash_merge`/`allow_merge_commit`/`allow_rebase_merge` | Use an allowed method: `gh pr merge --squash|--merge|--rebase`. With linear history, prefer `--squash`/`--rebase`. |
| **Merge queue** | repo has a merge queue configured | Enqueue with `gh pr merge --auto`; don't expect an immediate merge. |
| **Auto-merge already enabled** | repo `allow_auto_merge` + PR set to auto | Use `gh pr merge --auto`; let the platform merge when checks pass. |
| **Semantic PR title lint** | `amannn/action-semantic-pull-request` (or similar) in workflows | Compose a conventional PR title (`type(scope): summary`). |

## Cardinal Rules

1. **Detect before acting.** Run regime detection in pre-flight; gate Steps 6/7/13 on it.
2. **Delegate, don't duplicate.** If a tool owns versioning/release, hc-ship contributes its input (conventional commits, changeset file) and stops.
3. **Cooperate, don't bypass.** Hooks, signing, protections, required reviews are contracts — fix failures, never `--no-verify` / `--force` / disable signing.
4. **Stop for humans when required.** Required reviews → open PR and hand off; never self-approve or force-merge.
