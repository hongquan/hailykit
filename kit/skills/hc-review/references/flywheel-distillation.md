---
name: flywheel-distillation
description: Findings-to-rules flywheel — appends accepted findings to a local history log, detects recurrence, and proposes distillation into shared standards/guards/lint/memory with a deterministic id anchored in each committed target. Loaded by hc-review Act and hc-fix Finalize.
---

# Findings-to-Rules Flywheel

Deterministic history append (no model judgment) plus a recurrence check that PROPOSES — never silently writes — a shared artifact once the same finding class repeats.

## Scope Guard

Activates only in repos with an `.agents/` directory (HailyKit-managed projects). No `.agents/` → skip the entire flywheel; this is the expected bare-repo behavior, not a failure, and needs no log line.

## Honest Scope

`.agents/` is gitignored (see `.gitignore`) — `review-history.jsonl` is per-developer, per-machine. A recurring finding on a teammate's machine does not feed your recurrence check, and vice versa; this history does not observe team-wide activity. What compounds across the team is the DISTILLED OUTPUT — a `docs/code-standards.md` entry, a `.claude/haily.json` guard pattern, or a lint rule — because those are committed and shared. Local history only decides *when* to propose; never describe it as team-wide learning in the proposal text or the final report.

## History Line Shape

Append one line per ACCEPTED finding — Stage 3 Accept verdicts in `{skill:hc-review}`, applied fixes in `{skill:hc-fix}` — to `.agents/review-history.jsonl` (repo root; create the file on first write):

```json
{"date":"2026-07-07","skill":"hc-review","category":"missing-error-handling","module":"kit","file":"kit/hooks/haily-guard/pattern.cjs","severity":"Medium","summary":"async fs read has no try/catch"}
```

Fields:
- `date` — ISO date (`YYYY-MM-DD`)
- `skill` — `hc-review` | `hc-fix`
- `category` — short kebab-case finding class; reuse the reviewer's own taxonomy tag (checklist ID or a stable freeform slug) so recurrence matching stays exact
- `module` — top-level directory of `file` (`kit`, `cli`, `docs`, …)
- `file` — path relative to repo root
- `severity` — `Critical` | `Medium` | `Low`
- `summary` — one line; strip secrets first (reuse the diff secret-redaction pass already applied to review artifacts)

Append-only, one JSON object per line. This step is a mechanical write, not a decision point — no model judgment involved.

## Recurrence Detection

At the end of Act (`{skill:hc-review}`) / Finalize (`{skill:hc-fix}`), for each finding just accepted: read `.agents/review-history.jsonl` (skip the check if the file is absent — first occurrence, nothing to compare) and count prior lines sharing the same `category` + `module` pair.

- 0–1 prior occurrences: append the new line and stop.
- ≥2 prior occurrences (this finding is the 3rd+ of its class in this module): append, then PROPOSE distillation (below).

## Distillation ID

Every distillation gets a deterministic id before it is proposed, so the same rule always resolves to the same committed anchor regardless of who writes it or how the finding was phrased:

```
<category>__<module>__<rule-slug>
```

- `category` — the finding's `category` field, unchanged (already a stable slug per History Line Shape above).
- `module` — the finding's `module` field, unchanged.
- `rule-slug` — computed from the finding's `summary` field by this exact normalization:
  1. Lowercase the text.
  2. Replace every run of non-alphanumeric characters with a single hyphen; trim leading/trailing hyphens.
  3. Split on hyphens into tokens; drop any token in the stopword list below.
  4. Sort the remaining tokens alphabetically and collapse consecutive duplicates — sorting makes reordered phrasings of the same rule collapse to the identical slug.
  5. Join with hyphens; cap at 50 characters, truncating at the last hyphen boundary at or before the limit (never mid-word).

**Stopword list (fixed):** `a an the is are was were be been being to of in on at for with without and or but not no this that these those has have had do does did should must always never missing needs need around`

**Worked example — two phrasings, one id:**

| Summary | Normalized tokens (stopwords dropped, sorted) |
|---|---|
| "Async fs.readFile call has no try/catch wrapper" | `async, call, catch, fs, readfile, try, wrapper` |
| "Missing try/catch wrapper around the async fs.readFile call" | `async, call, catch, fs, readfile, try, wrapper` |

Both instances produce `rule-slug = async-call-catch-fs-readfile-try-wrapper`. For `category=missing-error-handling`, `module=kit`, both resolve to the same id:

```
missing-error-handling__kit__async-call-catch-fs-readfile-try-wrapper
```

Compute the id once, before choosing a target — it is what the id-grep in Write Protocol below matches on, and what gets cited in the checkpoint text.

## Held-Out Validation

Runs right after the id is computed, before anything reaches the checkpoint in `## Distillation Proposal` below. Its outcome decides what the checkpoint is allowed to offer — application, advisory, or a conflict flag.

Mechanical validation applies only to the two targets a rule can be expressed as a regex against — deterministic guard and lint. Standards and memory targets are prose; they get the contradiction check at the bottom of this section instead.

- **Partition the tree scan.** Run the proposed guard/lint pattern across the working tree using the same walk the `secrets`/`vuln-scan` commands already use (`cli/lib/fs-scan.ts` `listFiles` — respects `.gitignore`, skips binaries; do not stand up a second scanner). Split hits into two sets:
  - **Held-in** — hits landing on the files already cited as the finding instances for this proposal (the 2–3 `date`+`file` citations below). Expected — this is why the rule exists.
  - **Held-out** — hits on any other file, i.e. code the repo currently treats as passing.
- **Decision rule.**
  - Held-out count = 0 → clean. Offer the pattern for application at the checkpoint; on acceptance, mark it applied on the Phase 1 id anchor.
  - Held-out count > 0 → too broad to auto-apply. Present it **advisory-only** at the checkpoint with the false-positive file list, or ask the user to narrow the pattern before it can be offered again.
  - **Inconclusive exception — do not hard-reject:** a held-out hit on a file that itself belongs to a KNOWN finding class (same `category`+`module` appear in history, just not this exact instance — its line may have rotated out of the retained `review-history.jsonl`) is INCONCLUSIVE, not disqualifying. Surface it to the user as "matches a known finding class, instance history may be truncated" — never silently reject the pattern and never silently keep it either.
- **Record the outcome on the Phase 1 anchor — no separate store.** Append `heldOut: checked=<N> fp=<M>` (`checked` = files scanned, `fp` = held-out hits found) to the SAME committed anchor from Phase 1, regardless of the clean/advisory/inconclusive outcome, so a later run sees it was already validated and does not re-propose the same broad pattern from scratch:
  - Standards/lint comment: `<!-- playbook-id: <id> seen:N heldOut:checked=<N>,fp=<M> -->`
  - Guard `guardMeta` entry: add a sibling field, `{"guardMeta": {"<pattern>": {"playbookId": "<id>", "seen": N, "heldOut": {"checked": <N>, "fp": <M>}}}}`
- **Non-greppable rules degrade to advisory.** A rule that can't be expressed as a regex (a semantic lint, a structural convention only a model can judge) skips the mechanical scan entirely — state this explicitly at the checkpoint ("not mechanically checkable, offered as advisory only"); never present it as validated when it wasn't scanned.
- **Prose targets (standards/memory): contradiction check only, no tree scan.** Grep `docs/code-standards.md` and existing memory `feedback-*.md` entries for a rule already covering the same `category`+`module`. If one exists with the opposite guidance, flag the conflict for the user instead of writing silently — this replaces held-out validation for prose targets, it does not add to it.

**Worked example — over-broad `catch` pattern:**

Finding class `missing-error-handling__kit__async-call-catch-fs-readfile-try-wrapper` proposes the deterministic guard pattern `catch\s*\(\s*\)\s*\{\s*\}` (empty catch block) after its 3rd occurrence. Held-in: the 3 cited instances all use an empty `catch {}`. Scanning the tree with the `secrets`/`vuln-scan` fs-scan posture also matches 40 other files that intentionally swallow non-critical errors (test cleanup, best-effort cache warm). None of those 40 are in the finding-instance citation, so held-out count = 40 > 0 — the pattern downgrades to advisory. The checkpoint shows the guard proposal plus the 40-file false-positive list and asks the user to narrow it (e.g. require the block body to also lack a suppressing comment, or scope the pattern by directory) before it can ever be written to `.claude/haily.json`. The anchor still records `heldOut: checked=<N> fp=40` so the next occurrence doesn't re-run the same rejected proposal from scratch.

## Distillation Proposal

> **Required — checkpoint, never silent:** always surface the proposal before anything is written. Interactive sessions use `AskUserQuestion`; non-interactive modes (`--fix`, `--comment`, `--batch` in `{skill:hc-review}`; `--auto` in `{skill:hc-fix}`) fold the proposal into the returned report instead of blocking on a prompt. A distillation write never happens without this checkpoint having been shown.

Cite the 2–3 prior instances by `date` + `file` before proposing anything. **Already-distilled check first:** run the id-grep from Write Protocol against the committed artifacts; if the id already exists as an applied anchor, surface `already distilled (id <id>) — reinforce or refine?` instead of proposing a new entry (reinforce = bump the anchor's `seen` count only; refine = update the entry's wording using this instance's context, same id, same anchor). This still requires the checkpoint above — never silent. If the id is not found, pick ONE target, in this order:

| Target | When | Write location | Anchor form |
|---|---|---|---|---|
| Project standards entry | Lesson is a repo-specific convention (naming, structure, required pattern) | `docs/code-standards.md` — create with a minimal header (`# Code Standards`) if absent; if the project has no `docs/` convention at all, fall through to memory | `<!-- playbook-id: <id> seen:N -->` appended to the entry line |
| Deterministic guard | Class is a path pattern that should never be touched a certain way (mechanically detectable by path) | `.claude/haily.json` → `guard.block` / `guard.allow` arrays (`kit/hooks/haily-guard/pattern.cjs`) | JSON has no comment syntax, so the id cannot live on the array entry itself — add a sibling `guard.guardMeta` object keyed by the literal pattern string: `{"guardMeta": {"<pattern>": {"playbookId": "<id>", "seen": N}}}`. Additive-only; `pattern.cjs` still reads only `guard.block`/`guard.allow` for matching, so this never changes guard behavior |
| Lint rule | The project's linter already expresses the exact check (e.g. `no-restricted-imports`, a custom rule) | Note the rule name + config location; do not hand-roll a rule the linter can't express — fall through to standards or memory instead | No anchor possible in an external lint config — record the id on the `docs/code-standards.md` pointer line that names the rule, same `<!-- playbook-id: <id> seen:N -->` form |
| Memory `feedback` file | Lesson is behavioral, not mechanically enforceable (a judgment call, a rejected approach, a style preference) | `~/.claude/projects/<project>/memory/feedback-<slug>.md` per `{skill:hc-plan}` `references/memory-bridge.md` § WRITE Protocol frontmatter/body shape | `metadata.playbook-id: <id>` and `metadata.playbook-seen: N`, sibling fields to `metadata.type` in the existing frontmatter |

## Write Protocol

- One finding-class per entry — never bundle two unrelated categories into a single standards line or guard pattern.
- Cite 2–3 concrete historical instances (`date` + `file`) pulled from the history lines that triggered the proposal.
- **Dedup before writing (exact id-grep):** compute the id (`## Distillation ID`), then grep for it INSIDE THE COMMITTED ARTIFACT the target would write to — `docs/code-standards.md`, `.claude/haily.json`, or the memory file — never a `.agents/` file; `review-history.jsonl` only decided *when* to propose, it is never the dedup key.
  - Standards/lint → grep `docs/code-standards.md` for `playbook-id: <id>`.
  - Guard → look up `<id>` under `guard.guardMeta` values in `.claude/haily.json`.
  - Memory → grep memory files' frontmatter for `playbook-id: <id>` (for distillation writes this replaces the noun-overlap dedup in `references/memory-bridge.md` § Dedup Guard; that guard is unchanged for memory-bridge's other callers).
  - **Found** → UPDATE the existing entry in place: refine the wording if this instance sharpens it, and increment the anchor's `seen` count. Never append a second entry for the same id.
  - **Not found** → create the entry with its anchor, `seen: 1`.
  - This id-grep replaces the fuzzy noun-overlap heuristic for distillation dedup — the grep target is unchanged (still the committed artifact, still cross-machine); only the match key got exact.
- Every written entry is deletable like any other standards line, guard pattern, or memory file — a bad distillation is not permanent.

## Retention

`review-history.jsonl` lives at the repo root, not inside a plan folder — it is excluded from the `.agents/` report-retention archive sweep (`haily-documentation.md` § Report Retention) and persists across plan archival cycles.
