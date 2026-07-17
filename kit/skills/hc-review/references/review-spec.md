---
name: spec-compliance-review
description: First-pass review checking implementation matches spec/plan requirements before quality review
---

# Spec Compliance Review

## Purpose

Verify implementation matches what was requested BEFORE evaluating code quality.
Well-written code that doesn't match requirements is still wrong.

## When to Use

- After implementing features from a plan
- Before code quality review pass
- When plan/spec exists for the work being reviewed

## Process

1. **Load spec/plan** — Read the plan.md or phase file that defined this work
2. **List requirements** — Extract every requirement, acceptance criterion. When the spec carries stable `AC-N` ids (`{skill:hc-spec}`), key each entry by its id; specs without ids keep freeform bullets (backward compatible)
3. **Check each requirement** against actual implementation:
   - Present? → PASS
   - Missing? → MISSING (must fix before quality review)
   - Extra (not in spec)? → EXTRA (flag for removal unless justified)
4. **Two-way drift check (AC-id granularity)** — with AC-ids available, walk both directions:
   - Every spec `AC-N` id maps to code plus a test/evidence reference (`review-decision.json` `acceptanceCoverage` entry or `execution-evidence.json` `criterionId`) → else MISSING
   - Every new public behavior or interface introduced by the diff maps back to an `AC-N` id → else EXTRA (drift — un-speced behavior)
   No AC-ids in scope: skip this step, rely on the freeform check in step 3
5. **Verdict:**
   - All requirements/AC-ids met, no unjustified extras → PASS → proceed to quality review
   - Missing requirements/AC-ids → FAIL → implementer fixes → re-review
   - Unjustified extras or drift → WARN → discuss with user

## Checklist Template

| # | AC-id | Requirement | Status | Notes |
|---|-------|-------------|--------|-------|
| 1 | AC-1 | [from spec] | PASS/MISSING/EXTRA | [evidence] |

Specs without AC-ids: leave the AC-id column `—` and fall back to the freeform requirement check.

## Red Flags

- Skipping spec review because "code looks good"
- Accepting extra features without spec justification
- Treating spec review as optional
- Reviewing code quality before confirming spec compliance
- Ignoring the two-way drift check when AC-ids exist (checking MISSING only, skipping EXTRA)
