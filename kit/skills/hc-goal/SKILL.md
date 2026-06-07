---
name: hc-goal
description: "Autonomous development loop: give it a goal, it runs plan → cook → review → commit for each phase until done. Delegates to hc-plan, hc-cook, and haily-git-manager. Escalates only genuine blockers — ambiguity, security violations, all phases deferred."
when_to_use: "Invoke only when the user explicitly types /hc-goal. Do not auto-trigger from natural language — the scope of autonomous execution makes accidental activation harmful."
user-invocable: true
argument-hint: "\"<goal>\" [--retry N] [--auto] [--tdd]"
metadata:
  category: workflow
  keywords: [autonomous, goal, loop, orchestrate, automate, pipeline]
---

# Goal — Autonomous Development Loop

Give it a goal; it plans, implements, reviews, and commits each phase until the goal is achieved. Replaces the manual `{skill:hc-plan}` → `{skill:hc-cook}` → `{skill:hc-review}` → `{skill:hc-ship}` cycle.

## Usage

```
{skill:hc-goal} "<goal description>" [--retry N] [--auto]
```

| Flag | Behavior |
|------|----------|
| *(none)* | Interactive — pauses on issues as they arise; asks before deferring a failing phase |
| `--retry N` | Max analyze→fix attempts per failing phase before deferring (default: 3) |
| `--auto` | Autonomous — no prompts; resolves all decisions internally; escalates only critical blockers |
| `--tdd` | Pass-through to `{skill:hc-cook}` — write tests before each phase implementation. Use when the project has test infrastructure and the goal involves testable behavior |

```
{skill:hc-goal} "Add OAuth login with GitHub and Google"
{skill:hc-goal} "Add OAuth login with GitHub and Google" --auto
{skill:hc-goal} "Add OAuth login with GitHub and Google" --tdd --auto
{skill:hc-goal} "Migrate from Moment.js to date-fns across the codebase" --auto
{skill:hc-goal} "Implement rate limiting on all API endpoints" --retry 5 --auto
```

## Constraints

> **Required — goal-clarity:** At Route, assess whether the goal names a concrete, achievable outcome. Stop immediately if the goal is too vague to decompose into phases — e.g. "make it better", "improve performance", "add some features", "clean up the code". A valid goal identifies *what* to build or change and implies a done state. If unclear, halt with a one-sentence explanation of what's missing; do not proceed to Recon.

> **Required — recon-first:** Scan the codebase before planning. Collect project type, framework, relevant modules, in-flight plans in `.agents/`. Report 3–6 findings before delegating to `{skill:hc-plan}`.

> **Required — zero-regress:** Each phase commit must pass the full test suite and leave lint/type/build clean. A phase is not complete until Verify passes.

> **Required — phase-commit:** After every phase that passes Verify, commit via `haily-git-manager` before advancing. Never advance to the next phase without committing — uncommitted work is unprotected work.

> **Required — delegate-only:** Never implement, test, or review code directly. Invoke any registered skill or specialist agent that fits the situation — `{skill:hc-cook}`, `{skill:hc-debug}`, `{skill:hc-fix}`, `{skill:hl-brainstorm}`, `{skill:hc-lookup}`, `{skill:hc-optimize}`, `{skill:hc-security}`, `{skill:hc-db}`, `{skill:hl-research}`, and others. Do not create new skills.

## Process

1. **Route** — parse `<goal>`, extract `--retry` (default: 3) and `--auto` flag. Assess goal clarity: does it name a concrete outcome with an identifiable done state? If not, halt immediately — print one sentence explaining what information is missing. Do not proceed to Recon. Log `✓ Route: goal locked — mode=[interactive|auto], retry=[N]` only when goal passes.

2. **Recon** — spawn Explore agent; capture project type, framework, relevant modules, in-flight plans in `.agents/`. Log `✓ Recon: [N] findings`.

3. **Plan** — delegate to `{skill:hc-plan} --auto "<goal>"` → produces `plan.md` + `phase-XX-*.md` in `.agents/[date]-[slug]/`. Build Stage Graph from `blockedBy` fields.
   - **Checkpoint (Plan exit):** present plan summary (phase count, parallel-eligible phases). User: Approve / Revise / Abort. [skip: `--auto`]
   - Log `✓ Plan: [N] phases, Stage Graph built`.

4. **Execute** — loop over phases in Stage Graph order; run parallel when `blockedBy` allows:
   - Delegate to `{skill:hc-cook} <phase-plan.md>` (adds `--auto` when in `--auto` mode).
   - On success → spawn `haily-git-manager` to commit; advance to next phase.
   - On failure → enter Retry Loop (see § Retry Loop).
   - Throughout execution, invoke supplementary skills as the situation demands — not as a fixed sequence, but as needed: `{skill:hc-scout}` before a complex phase, `{skill:hl-brainstorm}` when an approach decision is ambiguous, `{skill:hc-lookup}` when library behavior is uncertain, `{skill:hc-db}` when schema work is involved, `{skill:hc-security}` when auth/payment surfaces appear, `{skill:hc-optimize}` when Verify surfaces a performance issue, `{skill:hl-research}` when a significant technical decision must be made. Any registered skill is available.
   - Log `✓ Execute: [M/N] phases complete` after each successful phase.

5. **Report** — spawn `haily-project-manager` to sync plan status. Emit completion summary: phases done, deferred phases with links to deferred reports, remaining blocked work.

## Retry Loop

When a phase fails (test failure, build error, review blocker):

1. Analyze failure; identify root cause category (logic error / missing dependency / integration mismatch).
2. Spawn `haily-debugger` for targeted fix; re-run the phase via `{skill:hc-cook}`.
3. Repeat up to `--retry N` times total.
4. After N attempts: write `deferred-<phase-slug>.md` to `.agents/<plan-dir>/reports/` with failure notes.
   - **Interactive:** ask user — defer and continue / abort / apply manual fix.
   - **`--auto`:** defer automatically; continue unless all remaining phases are blocked.
5. If all remaining phases have this deferred phase in their `blockedBy` chain → terminate and print deferred report.

## --auto Mode

All Checkpoints auto-proceed. Retry loop runs silently; issues logged to `.agents/<plan-dir>/reports/`. Escalates to user only on:

- Goal ambiguity that cannot be resolved from codebase context alone
- Critical severity regression (data loss, security hole, broken public contract)
- All phases deferred — nothing left to execute

## Output

- Plan directory: `.agents/[YYMMDD]-[HHMM]-[goal-slug]/`
- Deferred reports: `.agents/<plan-dir>/reports/deferred-<phase-slug>.md`
- Completion summary printed after Execute stage

## Workflow Position

**Follows:** `{skill:hl-brainstorm}` — after exploring approach options
**Precedes:** `{skill:hc-ship}` — if a formal release pipeline is needed after goal completion
**Related:** `{skill:hc-plan}`, `{skill:hc-cook}`, `{skill:hc-fix}`
