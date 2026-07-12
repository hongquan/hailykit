#!/usr/bin/env bash
# diff-tests.sh — Detect NEW test failures AND test-set shrinkage vs a baseline.
#
# Usage:
#   diff-tests.sh <baseline-file> <current-file> [declared-removals-file]
#
#   Files may be CTRF JSON, JUnit XML, or a plain-text exit-code file.
#   Format is auto-detected from file content.
#
#   declared-removals-file (optional): a plain-text file, one test name per
#   line, listing tests a phase intentionally removed. Names in this file are
#   excluded from the shrinkage check — undeclared removals still block.
#   EXPECTED SOURCE: this file should be generated FROM the committed plan
#   phase file's human-approved "removed tests" declaration (see hc-plan's
#   Draft-stage checkpoint), not written ad hoc by the agent running the gate.
#   See regression-gate.md §Test-Set Shrinkage for the full trust boundary.
#
# Exit codes:
#   0  no new failures, no undeclared test-name removal (gate passes)
#   1  new failures OR undeclared test-set shrinkage found (names printed to stdout)
#   2  error (missing files, unreadable, parser required but absent, etc.)
#
# Requires: jq for CTRF JSON — if absent, the gate FAILS CLOSED (exit 2), it
#           does not degrade to exit-code comparison (see diff_ctrf()).
#           xmllint for JUnit name-level diff — if absent, the gate FAILS
#           CLOSED (exit 2) rather than falling back to a count-only check
#           that cannot see shrinkage (see diff_junit()).
# Zero additional npm or system dependencies required.
#
# HONEST LIMIT: shrinkage detection needs the FULL test-name set, which only
# CTRF/JUnit signals carry. The plain-text exit-code path (format=exitcode,
# both files auto-detected as non-JSON/non-XML) cannot see removed tests at
# all — that is a genuine, disclosed degrade for callers who never wire up a
# structured reporter. It is distinct from — and NOT to be confused with —
# a structured file whose parser happens to be missing, which now fails
# closed instead of silently degrading to the same blind check.

set -uo pipefail

BASELINE="${1:-}"
CURRENT="${2:-}"
DECLARED_REMOVALS="${3:-}"

if [[ -z "$BASELINE" || -z "$CURRENT" ]]; then
  echo "Usage: diff-tests.sh <baseline-file> <current-file> [declared-removals-file]" >&2
  exit 2
fi

for f in "$BASELINE" "$CURRENT"; do
  [[ -f "$f" ]] || { echo "Error: file not found: $f" >&2; exit 2; }
done

# ── Shrinkage helper ──────────────────────────────────────────────────────────
# Filters a newline-separated list of "missing" test names down to the ones NOT
# declared as intentional removals. Skipped tests are never "missing" here —
# callers extract ALL names regardless of status, so a skipped test still
# counts as present.
filter_undeclared() {
  local names="$1"
  [[ -z "$names" ]] && return 0
  if [[ -n "$DECLARED_REMOVALS" && -f "$DECLARED_REMOVALS" ]]; then
    comm -23 <(printf '%s\n' "$names" | sort -u) <(sort -u "$DECLARED_REMOVALS")
  else
    printf '%s\n' "$names" | sort -u
  fi
}

# ── Format detection ──────────────────────────────────────────────────────────
detect_format() {
  local first
  first=$(head -c 2 "$1" 2>/dev/null | tr -d '\n')
  case "$first" in
    '{'*|'['*) echo "json" ;;
    '<'*)      echo "xml"  ;;
    *)         echo "text" ;;
  esac
}

# ── CTRF JSON path (requires jq) ──────────────────────────────────────────────
diff_ctrf() {
  if ! command -v jq &>/dev/null; then
    # NOTE: do NOT fall through to diff_exitcode here — CURRENT/BASELINE are
    # structured CTRF JSON files, not exit-code text. diff_exitcode would read
    # the whole JSON blob as a literal "exit code" string, the "0" == "$code_c"
    # equality would never match, and the gate would silently PASS (exit 0) on
    # real failures and on test-set shrinkage alike. Fail closed instead: a
    # missing parser on a structured input is a gate ERROR, not a green light.
    echo "❌  jq not found — cannot parse CTRF JSON; gate cannot be evaluated (install jq or provide plain-text exit-code output)" >&2
    exit 2
  fi

  local b_fails c_fails new b_names c_names missing undeclared
  b_fails=$(jq -r '.results.tests[] | select(.status == "failed") | .name' "$BASELINE" 2>/dev/null | sort -u)
  c_fails=$(jq -r '.results.tests[] | select(.status == "failed") | .name' "$CURRENT"  2>/dev/null | sort -u)

  new=$(comm -13 \
    <(printf '%s\n' "$b_fails" | sort -u) \
    <(printf '%s\n' "$c_fails" | sort -u) 2>/dev/null || true)

  # Shrinkage: ALL test names (any status — a skipped test still counts as
  # present), not just failures. A removed test leaves no failure record at
  # all, so comm -13 on failures alone can never see it.
  b_names=$(jq -r '.results.tests[] | .name' "$BASELINE" 2>/dev/null | sort -u)
  c_names=$(jq -r '.results.tests[] | .name' "$CURRENT"  2>/dev/null | sort -u)
  missing=$(comm -23 \
    <(printf '%s\n' "$b_names" | sort -u) \
    <(printf '%s\n' "$c_names" | sort -u) 2>/dev/null || true)
  undeclared=$(filter_undeclared "$missing")

  if [[ -n "$new" ]]; then
    echo "❌  new failures (signal: CTRF):"
    echo "$new"
    exit 1
  fi

  if [[ -n "$undeclared" ]]; then
    echo "❌  test-set shrinkage (signal: CTRF) — baseline test names missing from current run:"
    echo "$undeclared"
    echo "   If intentional, list removed names (one per line) in a file and pass it as the 3rd argument." >&2
    exit 1
  fi

  echo "✅  no new failures, no undeclared test removal (signal: CTRF)"
  exit 0
}

# ── JUnit XML path ────────────────────────────────────────────────────────────
diff_junit() {
  if command -v xmllint &>/dev/null; then
    # Name-level diff via XPath
    local b_fails c_fails new b_names c_names missing undeclared
    b_fails=$(xmllint --xpath '//testcase[failure or error]/@name' "$BASELINE" 2>/dev/null \
      | grep -oP '(?<==")[^"]+' | sort -u || true)
    c_fails=$(xmllint --xpath '//testcase[failure or error]/@name' "$CURRENT"  2>/dev/null \
      | grep -oP '(?<==")[^"]+' | sort -u || true)

    new=$(comm -13 \
      <(printf '%s\n' "$b_fails" | sort -u) \
      <(printf '%s\n' "$c_fails" | sort -u) 2>/dev/null || true)

    # Shrinkage: ALL testcase names (any status, including <skipped>) — see
    # diff_ctrf() comment for why failure-only diffing misses removals.
    b_names=$(xmllint --xpath '//testcase/@name' "$BASELINE" 2>/dev/null \
      | grep -oP '(?<==")[^"]+' | sort -u || true)
    c_names=$(xmllint --xpath '//testcase/@name' "$CURRENT"  2>/dev/null \
      | grep -oP '(?<==")[^"]+' | sort -u || true)
    missing=$(comm -23 \
      <(printf '%s\n' "$b_names" | sort -u) \
      <(printf '%s\n' "$c_names" | sort -u) 2>/dev/null || true)
    undeclared=$(filter_undeclared "$missing")

    if [[ -n "$new" ]]; then
      echo "❌  new failures (signal: JUnit/xmllint):"
      echo "$new"
      exit 1
    fi

    if [[ -n "$undeclared" ]]; then
      echo "❌  test-set shrinkage (signal: JUnit/xmllint) — baseline test names missing from current run:"
      echo "$undeclared"
      echo "   If intentional, list removed names (one per line) in a file and pass it as the 3rd argument." >&2
      exit 1
    fi

    echo "✅  no new failures, no undeclared test removal (signal: JUnit/xmllint)"
    exit 0
  fi

  # NOTE: do NOT degrade to a grep-count fallback or diff_exitcode here — this
  # is structured JUnit XML, and a name-blind count can't see shrinkage at all
  # (a removed <testcase> leaves no <failure> to count), so it would silently
  # PASS a test-set shrinkage attack. Fail closed instead: a missing parser on
  # a structured input is a gate ERROR, not a green light.
  echo "❌  xmllint not found — cannot parse JUnit XML by test name; gate cannot be evaluated (install xmllint or provide plain-text exit-code output)" >&2
  exit 2
}

# ── Exit-code / text fallback ─────────────────────────────────────────────────
diff_exitcode() {
  echo "⚠️  test-signal: exit-code only — new-failure detection is best-effort." >&2
  echo "   Pre-existing failures may mask regressions. Add a CTRF reporter for accuracy." >&2
  echo "⚠️  shrinkage detection requires CTRF/JUnit + jq; exit-code fallback cannot see removed tests." >&2

  local code_b code_c
  code_b=$(tr -d '[:space:]' < "$BASELINE" 2>/dev/null || echo "unknown")
  code_c=$(tr -d '[:space:]' < "$CURRENT"  2>/dev/null || echo "unknown")

  if [[ "$code_b" == "0" && "$code_c" != "0" ]]; then
    echo "❌  exit-code degraded: 0 → ${code_c} (signal: exit-code)"
    exit 1
  fi
  echo "✅  no new failures detected (signal: exit-code — best-effort)"
  exit 0
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
FMT_B=$(detect_format "$BASELINE")
FMT_C=$(detect_format "$CURRENT")

if [[ "$FMT_B" == "json" && "$FMT_C" == "json" ]]; then
  diff_ctrf
elif [[ "$FMT_B" == "xml" && "$FMT_C" == "xml" ]]; then
  diff_junit
else
  diff_exitcode
fi
