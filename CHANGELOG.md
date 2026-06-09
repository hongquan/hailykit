# Changelog

All notable changes to this project will be documented in this file.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 🐛 Fixes

- **`hc-ship`** Step 13 detects tag-triggered release workflows — skips manual `gh release create` (avoids `422 already exists`); enriches CI-published notes instead

---

## [1.3.0] (2026-06-09)

### 🚀 Improvements

- `hailykit [uninstall] [--help]`
- `hc-ship` upgrade

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

[1.3.0]: https://github.com/dxsl-org/hailykit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.1...v1.2.1
[1.1.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/dxsl-org/hailykit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dxsl-org/hailykit/releases/tag/v1.0.0
