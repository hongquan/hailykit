# Auto-Detection Logic

Detect test runner, version file, and changelog format from project files.

## Test Runner Detection

Check in order (first match wins):

| Check | Test Command |
|-------|-------------|
| `package.json` → `scripts.test` exists | `npm test` |
| `Makefile` → has `test:` target | `make test` |
| `pytest.ini` OR `pyproject.toml` has `[tool.pytest]` | `pytest` |
| `Cargo.toml` exists | `cargo test` |
| `go.mod` exists | `go test ./...` |
| `Gemfile` + `Rakefile` with test task | `bundle exec rake test` |
| `build.gradle` or `build.gradle.kts` | `./gradlew test` |
| `pom.xml` | `mvn test` |
| `mix.exs` | `mix test` |
| `deno.json` | `deno test` |

**Detection script:**
```bash
if [ -f package.json ] && grep -q '"test"' package.json 2>/dev/null; then
  echo "npm test"
elif [ -f Makefile ] && grep -q '^test:' Makefile 2>/dev/null; then
  echo "make test"
elif [ -f pytest.ini ] || ([ -f pyproject.toml ] && grep -q '\[tool.pytest' pyproject.toml 2>/dev/null); then
  echo "pytest"
elif [ -f Cargo.toml ]; then
  echo "cargo test"
elif [ -f go.mod ]; then
  echo "go test ./..."
else
  echo "NONE"
fi
```

**If NONE:** Use `AskUserQuestion` — "No test runner detected. Options: A) Skip tests, B) Provide test command"

## Version File Detection

Check in order:

| Check | Read Pattern |
|-------|-------------|
| `VERSION` file | Read as semver string |
| `package.json` → `version` field | `jq -r .version package.json` |
| `pyproject.toml` → `version` | grep `version = "..."` |
| `Cargo.toml` → `version` | grep `version = "..."` |
| `mix.exs` → `@version` | grep `@version "..."` |

**If none found:** Skip version bump silently. Not all projects use versioning.

**Bump logic:**
```
Lines changed < 50  → patch (X.Y.Z → X.Y.Z+1)
Lines changed >= 50 → patch (safe default)
User explicitly says "breaking" or "major feature" → AskUserQuestion for minor/major
```

## Changelog Detection

| Check | Format |
|-------|--------|
| `CHANGELOG.md` | Keep-a-changelog format |
| `CHANGES.md` | Same |
| `HISTORY.md` | Same |

**If none found:** Skip changelog silently.

**Entry format:**
```markdown
## [X.Y.Z] - YYYY-MM-DD

### 🚀 Improvements
- New features from commits with `feat:` prefix
- Changes from commits with `refactor:`, `perf:` prefix
- Removals mentioned in commit messages

### 🐛 Fixes
- Bug fixes from commits with `fix:` prefix
```

**Infer categories from:**
1. Conventional commit prefixes in `git log main..HEAD --oneline`
2. File types changed (test files → test improvements, docs → documentation)
3. Diff content (new functions = Added, modified functions = Changed)

## Release Automation Detection

**Run this FIRST in Step 13** — before building artifacts or creating a release. If CI already publishes the release on tag push, a manual `gh release create` collides (`HTTP 422: Release.tag_name already exists`).

A workflow automates releases when it **both** triggers on tag push **and** publishes a release:

| Signal | Pattern in `.github/workflows/*.{yml,yaml}` |
|--------|---------------------------------------------|
| Triggers on tag push | `tags:` key under `on: push:` (e.g. `tags: ['v*']`) |
| Publishes a release | `gh release create` · `softprops/action-gh-release` · `actions/create-release` · `ncipollo/release-action` · `releases/create` (API) |

**Detection script:**
```bash
RELEASE_AUTOMATION="NONE"
for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$wf" ] || continue
  if grep -qE '^\s*tags:' "$wf" \
     && grep -qiE 'gh release create|action-gh-release|create-release|release-action|releases/create' "$wf"; then
    RELEASE_AUTOMATION="AUTOMATED"; echo "  Release automation: $wf"; break
  fi
done
echo "$RELEASE_AUTOMATION"
```

- **AUTOMATED:** do NOT run `gh release create`. Push the tag (CI builds + publishes), then optionally enrich notes with `gh release edit` (auto-generated notes are often just the tag name). Skip the local build + artifact steps — CI owns them.
- **NONE:** proceed with local build → artifact detection → manual `gh release create`.

## Release Command Detection

Detect a release build command to run before creating the GitHub release. Check in order (first match wins):

| Check | Release Command |
|-------|----------------|
| `package.json` → `scripts["release:pack"]` exists | `npm run release:pack` |
| `package.json` → `scripts["release"]` exists | `npm run release` |
| `Makefile` → has `release:` target | `make release` |
| `Cargo.toml` exists | `cargo build --release` |

**Detection script:**
```bash
if [ -f package.json ]; then
  for script in "release:pack" "release"; do
    if node -e "const s=require('./package.json').scripts||{}; process.exit(s['$script']?0:1)" 2>/dev/null; then
      echo "npm run $script"
      break
    fi
  done
elif [ -f Makefile ] && grep -q '^release:' Makefile 2>/dev/null; then
  echo "make release"
elif [ -f Cargo.toml ]; then
  echo "cargo build --release"
else
  echo "NONE"
fi
```

**If NONE:** Create GitHub release without artifacts — source-level release only.

## Artifact Detection

After the release build runs, detect files to attach to the GitHub release:

| Pattern | Description |
|---------|-------------|
| `dist/*.zip` | Distribution zip archives |
| `dist/*.tar.gz` | Distribution tarballs |
| `build/*.zip` | Build output archives |
| `build/*.tar.gz` | Build output tarballs |
| `target/release/<name>` (no extension, executable) | Rust compiled binaries |
| `*.zip` (repo root) | Root-level archives |

**Detection script:**
```bash
ARTIFACTS=""
for pattern in "dist/*.zip" "dist/*.tar.gz" "build/*.zip" "build/*.tar.gz" "*.zip"; do
  matches=$(ls $pattern 2>/dev/null)
  [ -n "$matches" ] && ARTIFACTS="$ARTIFACTS $matches"
done
echo $ARTIFACTS
```

**If no artifacts found:** Call `gh release create` without `--attach` flags.

## Main Branch Detection

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

Fallback: check if `main` or `master` exists:
```bash
git rev-parse --verify origin/main 2>/dev/null && echo "main" || echo "master"
```
