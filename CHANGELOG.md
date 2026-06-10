# Changelog

All notable changes to this project will be documented in this file.
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] (2026-06-11)

### 🚀 Features

- **`hl-ultra` skill** — explicit opt-in deep-model escalation: main loop + five core reasoning agents (`haily-planner`, `haily-implementor`, `haily-reviewer`, `haily-brainstormer`, `haily-debugger`) escalate to the `deep` tier; mechanical agents (git, tester, docs) keep their pins regardless. Single entry point prevents accidental half-escalation.
- **`deep` model tier** — 4th model tier resolved at install time for all providers; user pin via `~/.hailykit/model-map.json` `{"claude": {"deep": "claude-fable-5"}}` + `hailykit upgrade`.
- **`resolveModelRefs()`** — install-time resolver for `{model:<tier>}` body placeholders; eliminates verbatim tier strings shipping to any provider.

### 🚀 Improvements

- **11 eligible skills** (`hl-brainstorm`, `hc-plan`, `hc-cook`, `hc-review`, `hc-fix`, `hc-optimize`, `hc-cop`, `hl-reasoning`, `hc-goal`, `hc-security`, `hl-research`) — added `--ultra` mode section; bare `--ultra` flag redirects to `hl-ultra` with explanation.
- **CI** — `check-skill-cross-refs.js` validates `deep` tier only in `model-map.json`; agent frontmatter using `deep` fails CI.
- **`kit/model-map.json`** — ships as user-overridable tier→model map alongside the installer built-in.

### 🐛 Fixes

- **Gemini / Antigravity / Codex** — `{model:deep}` and `model: deep` no longer leak verbatim to any provider; `resolveModel` + `resolveModelRefs` now applied on all native skill install paths.
- **Codex** — angle-bracket strip scoped to `description:` line only; usage docs (`<skill>`, `<eligible-skill>`, `<free text>`) no longer mangled.
- **Zed** — orphan skill cleanup runs before the `installed.length === 0` early return; stale skills are now removed even when no new skills install.
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

[1.5.0]: https://github.com/dxsl-org/hailykit/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dxsl-org/hailykit/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dxsl-org/hailykit/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.1...v1.2.1
[1.1.1]: https://github.com/dxsl-org/hailykit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/dxsl-org/hailykit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dxsl-org/hailykit/releases/tag/v1.0.0
