---
name: hl-ultra
description: "Run a reasoning-heavy skill on the deep-tier model — main loop and core agents both escalate. Explicit opt-in for maximum-quality, token-expensive runs."
when_to_use: "Invoke when a task deserves the strongest available model: high-stakes planning, architecture decisions, adversarial review, hard debugging."
user-invocable: true
disable-model-invocation: true
argument-hint: "<skill> [args] | <continuation message>"
model: deep
metadata:
  category: utilities
  keywords: [ultra, deep, model, escalation, opus, fable, quality, expensive, opt-in]
---

# Ultra — Deep-Model Escalation

Runs an eligible skill with the deep-tier model on both levels: this invocation's main loop (via this skill's `model:` frontmatter) and the skill's reasoning-core agents (via Task model override). Strictly user-initiated — never auto-invoked, never inferred from task difficulty.

Deep model for this install: `{model:deep}` (pin a stronger one in `~/.hailykit/model-map.json` under tier `deep`, then run `hailykit upgrade`).

## Usage

```
{skill:hl-ultra} <eligible-skill> [args...]   # start a workflow in ultra mode
{skill:hl-ultra} <free text>                  # continue an in-progress ultra workflow in a new turn
{skill:hl-ultra}                              # re-arm ultra and continue (no new input)
```

Examples:

```
{skill:hl-ultra} hc-plan "redesign the auth module around OAuth2"
{skill:hl-ultra} hl-brainstorm --debate "migrate monolith to services"
{skill:hl-ultra} "yes, proceed with option B"        # continuation after an interruption
```

Eligible skills: `{skill:hl-brainstorm}` · `{skill:hc-plan}` · `{skill:hc-cook}` · `{skill:hc-review}` · `{skill:hc-fix}` · `{skill:hc-optimize}` · `{skill:hc-cop}` · `{skill:hl-reasoning}` · `{skill:hc-goal}` · `{skill:hc-security}` · `{skill:hl-research}`

## Constraints

> **Required — explicit opt-in only:** Ultra mode activates only through a direct user invocation of this skill. The `--ultra` marker passed downstream is internal plumbing — never present it to users as a flag, never suggest-and-activate in the same turn, never escalate because a task "looks hard".

> **Required — whitelist-only escalation:** Escalate judgment, not mechanics. Only Task calls to deep-eligible agents get `model: {model:deep}`; every other agent keeps its pinned tier, regardless of which skill in the chain spawns it.

> **Required — cost gate for long runs:** Before starting `{skill:hc-goal}`, `{skill:hc-cook}`, or `{skill:hc-optimize}` in ultra mode, state the expected scale of token spend in one line and confirm via `AskUserQuestion` unless the user passed `--auto`.

## Process

1. **Route** — first argument matches an eligible skill name → start mode; anything else (or no arguments) → continuation mode.
2. **Start mode** — announce `✓ Ultra: <skill> on {model:deep}`, then invoke the target skill with the remaining arguments plus `--ultra`. The ultra state is turn-scoped: every skill in the resulting chain sees it.
3. **Continuation mode** — treat the arguments as the user's reply to the in-progress workflow and continue it under ultra. The prior workflow state lives in conversation context; re-invoking this skill only restores the deep model for the new turn.
4. **Escalation rule (applies all turn)** — Task calls to deep-eligible agents pass `model: {model:deep}`; if the model is rejected as unavailable, retry once with the thinking tier and tell the user which model actually ran.
5. **Ineligible skill requested** — do not run it; list the eligible skills and stop.

Deep-eligible agents: `haily-planner`, `haily-implementor`, `haily-reviewer`, `haily-brainstormer`, `haily-debugger`. All others — `haily-researcher`, `haily-tester`, `haily-git-manager`, `haily-docs-writer`, `haily-project-manager`, `haily-reporter`, and the rest — always keep their pins.

## Output

No artifact of its own — output is whatever the escalated skill produces. Each turn under ultra starts with the `✓ Ultra:` status line so the active model is always visible.

## Workflow Position

**Precedes:** any eligible skill — it is the entry point that wraps them.
**Used alongside:** `{skill:hl-help}` — discoverability of eligible skills.
