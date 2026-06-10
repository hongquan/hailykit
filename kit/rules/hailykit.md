# Hailykit Rules

Rules for contributors and AI agents working on the hailykit repo.

## Metadata Deletions (MANDATORY)

When renaming or deleting ANY file under `kit/` (skills, hooks, agents, standards, templates), add the old relative path to `kit/metadata.json` `deletions[]`. This tells the installer to remove stale files from user machines on upgrade. Skipping it leaves orphaned files that cause conflicts.

## Skill Registry Contract

Canonical skill names live in each `kit/skills/*/SKILL.md` frontmatter `name:` field. Domain prefixes:

- `hl-` — universal/utility (thinking, planning, tools, design)
- `hc-` — coding (incl. AI app frameworks, MCP, docs/extraction)

## Skill Reference Syntax

All skill cross-references in `kit/**/*.md` (skills, agents, rules) use the **provider-neutral canonical form**:

```
{skill:prefix-name}    e.g. {skill:hc-cook}
```

Use the **registered name** (frontmatter `name:`) — it matches the directory name (`hc-cook` dir → `name: hc-cook` → `{skill:hc-cook}` ref).

## Cross-Reference Integrity (CI-enforced)

CI runs `node scripts/check-skill-cross-refs.js` on every push. It builds a registry from all `SKILL.md` `name:` fields and checks every `{skill:hX-name}` (and any legacy `/hX-name`) reference in `kit/**/*.md` resolves to a registered skill. A wrong prefix — writing `hl-debug` when the skill is registered as `hc-debug` — fails CI.

Before committing reference changes: `node scripts/check-skill-cross-refs.js`. When adding a skill to a routing rule (`workflow.md`, `domain.md`), update BOTH the rule and the skill's `## Workflow Position`.

## Model Tiers (agents)

Agent frontmatter `model:` uses provider-neutral tiers — `thinking` / `medium` / `fast` — resolved per provider by the installer. Never hard-code `opus`/`gpt-5`/etc. in agent source. The authoritative tier→model map ships as `kit/model-map.json` (built-in fallback: `MODEL_MAP` in `cli/installer/converter.ts`; user pin: `~/.hailykit/model-map.json`). When vendor model IDs change, update `kit/model-map.json` — no code change needed. CI validates agent tiers and the map shape via `scripts/check-skill-cross-refs.js`.

## Deep Tier / Ultra Mode

`deep` is a fourth map tier reserved for runtime escalation via the `hl-ultra` skill — never pin it on an agent (CI rejects it). In skill body text, `{model:deep}` placeholders resolve to the provider's deep model at install time. Ultra escalation is whitelist-based: only `haily-planner`, `haily-implementor`, `haily-reviewer`, `haily-brainstormer`, `haily-debugger` escalate; mechanical agents keep their pins. When adding a skill to the ultra-eligible list, update BOTH the skill's `## --ultra Mode` section and the eligible list in `kit/skills/hl-ultra/SKILL.md`.
