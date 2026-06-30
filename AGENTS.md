## Project
hailykit — zero-dependency TypeScript tool-execution engine + multi-provider skill-catalog installer for AI coding agents. Two subs: `cli/` (executable) and `kit/` (catalog). Distributed via GitHub release zip. Repo: `github.com/dxsl-org/hailykit`.

## Tooling
- Build: `npm run build` — tsc → dist/ + postbuild copies cli/tools/ → dist/tools/
- Test: `npm test` — pretest compiles to .test-build/ first; delete .test-build/ after removing source test files
- Release: `npm run release:pack`

## Scope Rule — Global vs Project

Files under `~/.claude/` (rules, hooks, agents, settings) are **machine-local** — modifying them only affects this machine and will not be shipped to users. To ship a change, make it inside `kit/` (skills, hooks, rules, agents, templates) and release via GitHub. Reading global files for reference is fine; writing to them is not a substitute for a proper kit change.

## Safety Rules
- NEVER commit secrets (.env, API keys, credentials)
- NEVER add npm-registry runtime dependencies — Node built-ins with `node:` prefix only
- NEVER use `npm publish` — distribution is GitHub release zip only
- NEVER use path aliases — relative imports only (break dist/ resolution without a build-time dep)
- NEVER ignore failing tests to make CI green

## Skill Authoring Standard

When creating or rewriting ANY `kit/skills/*/SKILL.md`, use in order:
1. **`docs/engineering-standards.md`** — terminology, pipeline vocabulary, writing voice, banned phrases
2. **`docs/skill-template.md`** — canonical section order, constraint callout syntax, Workflow Position format

Quick rules:
- Guardrail callout: `> **Required — [shorthand]:** [what must hold]`
- No `<HARD-GATE>` XML, no numbered steps (`1. **Detect**` is fine; `Step 1: Detect` is not)
- Stage names: Route, Recon, Draft, Build, Verify, Ship — not "Step 1", "Phase"
- Cross-reference syntax: `` {skill:hc-plan} `` in body text; `/hc-plan` is terminal syntax only
- Banned phrases: "Hard Gate", "nail the spec", "blast surface", "brutal honesty", "elite expert", `metadata: author: claudekit`

## Docs
Read before acting on a relevant task:
- [engineering-standards.md](docs/engineering-standards.md) — full terminology, pipeline vocab, writing voice, banned phrases
- [skill-template.md](docs/skill-template.md) — canonical skill section order and constraint callout syntax
- [system-architecture.md](docs/system-architecture.md) — architecture + directory map
- [tech-stack.md](docs/tech-stack.md) — NDJSON stdio protocol, tool wire format
