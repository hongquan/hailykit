# Changelog

All notable changes to this project will be documented in this file.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.6.5] (2026-06-12)

### 🐛 Fixes

- **`install.ps1`** — now creates `hailykit.ps1` wrapper (alongside `.cmd`) pointing to `dist/bin.js`, overwriting any stale wrapper from old installs; also adds `gh auth token` fallback for private-repo auth
- **`install.sh`** — adds `gh auth token` fallback via `curl_github` helper; download also uses auth header

---

## [1.6.4] (2026-06-12)

### 🐛 Fixes

- **`hailykit upgrade` / `install`** — auto-reads token from `gh auth token` (gh CLI) as a fallback when `GITHUB_TOKEN`/`GH_TOKEN` env vars are not set; enables upgrade from private repos without manual token setup

---

## [1.6.3] (2026-06-12)

### 🐛 Fixes

- **`hailykit upgrade` / `install`** — reads `GITHUB_TOKEN` / `GH_TOKEN` env var for private-repo auth

---

## [1.6.2] (2026-06-12)

### 🚀 Improvements

- **`hailykit stats` command + `hl-stats` skill** — zero-dependency code statistics: file counts, nLOC per language, cyclomatic complexity hotspots, LLM token estimate
- **`hailykit stats`** — added Gleam language support
- Model tracer + usage enabled by default

---

## [1.5.0] (2026-06-11)

### 🚀 Improvements

- **`hl-ultra` skill** — explicit opt-in deep-model escalation: main loop + five core reasoning agents escalate to the `deep` tier

### 🐛 Fixes

- **Gemini / Antigravity / Codex / Zed** — ` upgrade.
- **Test isolation** — `HAILYKIT_HOME` env mutation in converter tests now guarded with `before`/`after` hooks; no cross-test contamination.

---

## [1.4.0] (2026-06-10)

### 🚀 Improvements

- **Block auto deep-research / dynamic workflows** — installer force-sets `workflowKeywordTriggerEnabled=false` on install + upgrade; explicit `/deep-research`, `/workflows`, `/effort ultracode` still work
- **`hl-research` upgrade** — token-bounded cost discipline (snippet-first, sufficiency gate), active claim refutation, reverse/inversion fallback when forward search is dry, positioning vs native `/deep-research`
- **`hailykit uninstall`** now strips dangling hook refs from `settings.json` (keeps security deny-rules)

---

## [1.3.0] (2026-06-09)

### 🚀 Improvements

- `hailykit [uninstall] [--help]`
- `hc-ship` upgrade, auto detect git/release automation

### 🐛 Fixes

- `hc-cop` skill now reachable from routing files
- CI now enforces the skill cross-reference check

---

## [1.2.1] (2026-06-08)

### 🚀 Improvements

- **`hc-ship` / `hc-docs` / `hc-new`** upgrade
- **`AGENTS.md`** — adopted as canonical project context file
- Workflow cross-references — added missing links between skills
- Provider specs
- **`hc-goal`** — autonomous development loop: give it a goal, it runs plan → cook → review → commit for each phase until done.

### 🐛 Fixes

- **Crush** skills install as `hc-name/SKILL.md` per Agent Skills spec
- Remove `user-invocable` field not in agentskills.io spec

---

## [1.1.0] (2026-06-07)

### 🚀 Improvements

- Kimi & Crush provider

### 🐛 Fixes

- Model stripping for user-configured providers: `cursor`, `zed`, `windsurf`, `crush`, `opencode`, `kimi`
- **OpenCode** `globalDir` on macOS and Windows

---

## [1.0.0] (2026-06-04)

### 🚀 Improvements

- Zero-dep TypeScript engine; native + polyglot NDJSON-over-stdio execution
- `list`, `run`, `info` CLI commands with `--tools`, `--input`, `--timeout`
- Multi-provider installer: Claude, Gemini, Cursor, Windsurf, OpenCode, Codex, Zed
- 30 skills in `hc-*` (coding) and `hl-*` (universal) prefixes
- `hailykit install [--provider] [--project]`, `upgrade`, `status`
- SKILL.md → TOML (Gemini), Markdown (Cursor/Windsurf), catalog (Codex)
- `settings.json` deny rules: union-add only, never removes user entries
- `PreToolUse` hook blocks private keys, secrets, and credential files
- `UserPromptSubmit` PII guard warns on emails and card numbers; opt-in
- `migrateSettings()` upgrades hook format on upgrade non-destructively
- `metadata.json` `deletions[]` removes stale files from user installs
- `settings.json` writes use temp-file + rename for atomicity

---

[1.6.2]: https://github.com/dxsl-org/hailykit/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/dxsl-org/hailykit/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/dxsl-org/hailykit/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/dxsl-org/hailykit/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dxsl-org/hailykit/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dxsl-org/hailykit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.1...v1.2.1
[1.1.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/dxsl-org/hailykit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dxsl-org/hailykit/releases/tag/v1.0.0
