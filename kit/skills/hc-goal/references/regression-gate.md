# Regression Gate — Baseline-Relative Completion Criterion

Replaces `zero-regress` (entire suite must be green) with **no-new-failures**: a phase passes its test gate if it introduces zero **new** failing test names compared to a baseline captured at Route.

This unblocks repos with pre-existing failures, flaky tests, or missing test runners — all conditions that made `zero-regress` impossible to satisfy in practice.

## Concept

Borrowed from the SWE-bench fail2pass/pass2pass methodology: snapshot per-test name+status before implementation → diff after on test-name identity. Exit-code comparison alone is insufficient: 3 pre-existing failures exit 1 before and after, silently masking 5 new failures.

## Runner Detection Table

Reuse `{skill:hc-test}` runner detection rather than re-implementing it. Format priority: CTRF > JUnit XML > machine JSON > exit-code.

| Language / runner | Preferred format | Capture command |
|---|---|---|
| Jest / Vitest | CTRF JSON | `npx jest --reporter @ctrf-io/jest-ctrf-json-reporter --outputFile current.json` |
| pytest | CTRF JSON | `pytest --ctrf current.json` |
| Go test | CTRF JSON | `go test ./... -json \| ctrf-go current.json` |
| Playwright | CTRF JSON | `playwright test --reporter @ctrf-io/playwright-ctrf-json-reporter` |
| Rust (cargo nextest) | JUnit XML | `cargo nextest run --profile ci --junit-output-file current.xml` |
| Flutter | machine JSON | `flutter test --machine > current.json` |
| Any (fallback) | exit-code text | `<test-command>; echo $? > current.txt` |

## File-Path Convention

All test result files use the plan directory and a consistent format-matched extension:

| Signal | Baseline file | Current file (per phase) |
|--------|--------------|--------------------------|
| CTRF JSON | `.agents/<plan-dir>/baseline-tests.json` | `.agents/<plan-dir>/current-tests.json` |
| JUnit XML | `.agents/<plan-dir>/baseline-tests.xml` | `.agents/<plan-dir>/current-tests.xml` |
| exit-code | `.agents/<plan-dir>/baseline-tests.txt` | `.agents/<plan-dir>/current-tests.txt` |

`diff-tests.sh` detects format from file content (not extension), so the extension is cosmetic — but the **exact path** must exist or `diff-tests.sh` exits 2 (file-not-found), which the gate treats as "omitted."

An optional declared-removals file, `.agents/<plan-dir>/declared-removed-tests.txt`, lists test names (one per line) a phase intentionally deletes — see § Test-Set Shrinkage Check.

## Baseline Capture (Route Stage)

Before any implementation begins, run the test suite once and record the output to the appropriate baseline path:

```bash
# CTRF (preferred)
<test-command> --ctrf .agents/<plan-dir>/baseline-tests.json

# JUnit fallback
<test-command> --junit-xml .agents/<plan-dir>/baseline-tests.xml

# exit-code fallback
<test-command>; echo $? > .agents/<plan-dir>/baseline-tests.txt
```

Record the detected signal strength in the run ledger (`baseline_signal: ctrf|junit|exit-code|none`).

If no test runner is detected: log `no runner — gate omitted` in the ledger. The gate is skipped for that repo (never blocks a run due to missing infrastructure).

## Per-Phase Gate

After each phase implementation, before the commit: re-run the test suite and capture current results to the matching format path:

```bash
# Example (CTRF path):
<test-command> --ctrf .agents/<plan-dir>/current-tests.json
```

Then diff vs baseline:

```bash
kit/skills/hc-goal/scripts/diff-tests.sh \
  .agents/<plan-dir>/baseline-tests.json \
  .agents/<plan-dir>/current-tests.json \
  .agents/<plan-dir>/declared-removed-tests.txt   # optional, see below
```

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | No new failures, no undeclared test-name removal | Phase gate passes → advance |
| 1 | New failures OR undeclared test-set shrinkage, listed by name | Phase gate fails → Retry Loop |
| 2 | Script error (missing files, OR required parser absent for a structured format) | Log, treat as gate-omitted |

**Parser-absent is a gate ERROR, not a pass.** If the baseline/current files are CTRF JSON but `jq` is missing, or JUnit XML but `xmllint` is missing, `diff-tests.sh` exits 2 rather than silently degrading to a check that cannot see the structured content. Install the parser or capture in exit-code format instead — never treat exit 2 here as "tests passed."

## Test-Set Shrinkage Check (PRIMARY Reward-Hacking Guard)

`diff-tests.sh` also compares the **full test-name set** (any status, not just failures) between baseline and current. A baseline test name absent from the current run means the test was **deleted**, not merely failing — the failure-only diff above cannot see this at all, since a deleted test leaves no failure record.

This is the load-bearing guard against an agent quietly deleting an inconvenient test to make a phase pass: unlike the edit-tripwire in `checkLoopGuardTripwire` (`kit/hooks/haily-lib/directory.cjs`, agent-writable marker, bypassable), this check reads test **results** the agent does not author. A determined agent can unset an env marker; it cannot make a deleted test reappear in the current run's output.

- **Skipped ≠ removed:** a test with `status: skipped` (CTRF) or a `<skipped>` child (JUnit) still counts as present — only a name entirely absent from the result set counts as shrinkage.
- **Flaky-adjacent re-run rule:** before declaring shrinkage, re-run the current suite once. If the missing name reappears (collection flake, filter applied only on that run), it was not removed — do not block. Log it as `shrinkage-flaky-noted` in the ledger row.
- **Intentional removal:** if a phase explicitly deletes tests (e.g. removing dead code's tests), list the names in `.agents/<plan-dir>/declared-removed-tests.txt` (one per line) and pass it as `diff-tests.sh`'s 3rd argument — declared names are excluded from the shrinkage check. Silent removal (no declaration) still blocks.
- **Declared-removals source, and its honest limit:** `declared-removed-tests.txt` is a self-certifiable escape hatch — `diff-tests.sh` trusts every name in it unconditionally, and nothing in the script verifies who wrote it. An agent under pressure to pass the gate can list every test it deleted and zero out the shrinkage signal with no one else looking. This file is trustworthy **only insofar as its source is human-approved**: generate it from the committed plan phase file's explicit "removed tests" declaration, agreed at the Draft/plan checkpoint (before implementation), never from a scratch file an implementing agent writes for itself mid-phase. Under `--auto` — where no human reviews the run before it advances — there is no human-approved source to draw from, so any shrinkage must be treated as **blocking**, even if a `declared-removed-tests.txt` happens to exist; do not accept an agent-authored declared-removals file as sufficient justification under `--auto`.
- **Signal requirement:** feasible only on CTRF or JUnit+xmllint signals, which carry the full name set. If the required parser is absent for a structured format, `diff-tests.sh` now exits 2 (gate error) instead of silently degrading to a blind check — see § Degraded-Signal Honesty. The only signal that legitimately cannot see shrinkage is the plain-text exit-code format itself (when neither file is JSON/XML).

## Flaky Re-Run Rule

Before declaring a new failure: re-run the changed-status test once. If it flips back to passing, it is flaky — **do not** count it as a new failure. Log it as `flaky-noted` in the ledger row's residual risk.

## Completion Semantics

A phase is complete when any one of:

1. **No-new-failures:** gate script exits 0 (default; no new failing test names).
2. **Gate omitted:** no runner detected, or script error — logged, not blocking.
3. **`--strict` mode:** the entire suite must be green (restores old `zero-regress` behavior). Use `--strict` on greenfield repos or when no-new-failures proves insufficient.

`--strict` is the rollback escape hatch. Keep it for one release while `no-new-failures` proves out; remove once validated.

## Degraded-Signal Honesty

When running on exit-code fallback (no CTRF or JUnit available), log explicitly:

```
⚠️  test-signal: exit-code only — new-failure detection is best-effort.
    Pre-existing failures may mask regressions. Add a CTRF reporter for full coverage.
⚠️  shrinkage detection requires CTRF/JUnit + jq; exit-code fallback cannot see removed tests.
```

This exit-code path only runs when the captured files are genuinely plain-text (both auto-detected as `exitcode` format). It is NOT what runs when a structured file's parser is missing — that case now exits 2 (gate error) instead of silently falling back to this degraded check, closing the false-pass it previously allowed (see `diff-tests.sh` `diff_ctrf()`/`diff_junit()`).

Always record which signal strength was used for each phase in the ledger row. Never claim "tests pass" or "no test removal" when only a degraded signal was checked.

## Honest Residual

The shrinkage check catches test **deletion**. It does not catch **assertion-weakening at a stable test count** (e.g. an agent replaces `expect(x).toBe(5)` with `expect(x).toBeDefined()` without touching the test-name set) — the name set is unchanged, so `diff-tests.sh` sees no signal. This residual is backstopped by `{skill:hc-review} --deep` refuter votes and the human quiz gate, not by this script. Do not overclaim mechanical coverage beyond deletion detection.
