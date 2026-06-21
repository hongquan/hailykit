# Memory Bridge (--resume)

Bidirectional protocol between `hc-plan --resume` and the auto-memory system (`~/.claude/projects/<project>/memory/`).

Two operations: **READ** (before Research stage) and **WRITE** (after Red Team stage).

---

## § READ Protocol

Runs between Scope Check and Research. Gracefully skips if MEMORY.md is absent (fresh project).

**Steps:**

1. Check `~/.claude/projects/<project>/memory/MEMORY.md` exists. If absent: log `ℹ Memory: no MEMORY.md found — skipping injection`. Stop.

2. **Type filter** — load only entries relevant to planning:
   - Always include: `type: feedback`, `type: project`
   - Include if plan task involves external tools: `type: reference`
   - Skip: `type: user` (communication style — not planning-relevant by default)

3. **Keyword scan** — tokenize the plan topic into nouns. For each MEMORY.md index entry: check if ≥1 topic noun appears in the entry's one-line description (case-insensitive). Collect matching entries.

4. **Recency sort** — sort matched entries by date (frontmatter `metadata.date` or file mtime). Prefer entries <90 days old. Entries >90 days: keep in results but mark `(⚠ verify — N days old)`.

5. **Cap at 5 entries** — take the top-5 by relevance (recency + type weight: `feedback` > `project` > `reference`). If >5 match, log dropped entries count.

6. **Read selected files** — read each memory file. If total content exceeds ~400 tokens, load `description:` field only (not full body) for lower-priority entries to stay within cap.

7. **Inject** — surface loaded memories to planning context before spawning researchers.

8. **Emit:** `✓ Memory: [N] loaded — [names]. [M] entries flagged for verification (>90 days).`

**Type relevance table:**

| Planning stage | Types to load |
|---------------|--------------|
| Research | feedback, project |
| Solution Design | feedback, project, reference |
| Plan Writing | feedback, project |

---

## § WRITE Protocol

Runs after Red Team passes, before Validation. Fires only if `--resume` is set. In `--auto` mode, writes without AskUserQuestion.

**What to write (decision taxonomy):**

| Decision type | Memory type | Condition |
|--------------|-------------|-----------|
| Rejected alternative (tech choice ruled out + why) | `feedback` | Any option evaluated and eliminated during Solution Design |
| Discovered constraint (external limit, compliance req, infra fact) | `project` | Any constraint found during Research that isn't in the codebase |
| Observed user preference (scope, style, risk tolerance) | `feedback` | User expressed a preference that surprised you (non-obvious) |
| External resource pointer (found a key doc, API spec, schema location) | `reference` | Found a resource that took effort to locate |

**What NOT to write:**
- Approved implementation steps (those live in phase files)
- Phase file content or plan summaries (already in plan.md)
- "We used X" — only "We rejected Y because Z" is memory-worthy
- Transient session facts (tool output, CI run IDs, session timestamps)

**Steps:**

1. After Red Team, review planning session for decisions in the table above.

2. For each decision: **dedup check** — scan MEMORY.md index descriptions. If an entry's description has ≥50% noun overlap with the new decision, update that file rather than creating a new one.

3. **Write memory file** to `~/.claude/projects/<project>/memory/`:
   - Filename: `[type]-[kebab-slug].md` (e.g., `feedback-redis-rejected-licensing.md`)
   - Required frontmatter:
     ```markdown
     ---
     name: redis-rejected-licensing
     description: Redis rejected for session storage — licensing cost in production
     metadata:
       type: feedback
     ---
     ```
   - Body structure for `feedback` and `project` types:
     ```
     [Rule or fact]
     
     **Why:** [The reason discovered during this planning session]
     **How to apply:** [When this should influence future planning]
     ```

4. **Update MEMORY.md index** — add or update the one-line entry for this memory. Keep entries <150 chars.

5. **Emit:** `✓ Memory: wrote [N] decisions — [names]`

---

## § Dedup Guard

Before writing a new memory, check if one exists:

1. Extract 3–5 key nouns from the new decision's description
2. Scan MEMORY.md one-line entries for those nouns (case-insensitive)
3. If ≥50% of key nouns appear in an existing entry → read that file and UPDATE it rather than creating a new one
4. If unsure whether an update or new entry is correct: write a new one; the user can prune duplicates later

---

## § Staleness Handling

A memory entry is stale when its date is >90 days old. Stale memories are hypotheses about what was true at that time, not current facts.

- Do NOT silently discard stale memories — surface them with the age annotation
- Surface to planning context as: `[name] (⚠ verify — 127 days old): [description]`
- Do NOT act on stale memories about specific APIs, function names, or file paths without verifying the current state of the code

---

## § Examples

**Rejected alternative → write as feedback:**
```markdown
---
name: redis-rejected-session-storage
description: Redis rejected for session storage — cost prohibitive at current scale
metadata:
  type: feedback
---

Do not propose Redis for session storage.

**Why:** Evaluated during auth redesign planning (2026-06-21). Redis licensing cost at production scale (>10k active sessions) exceeds budget. Team consensus was to use PostgreSQL with a sessions table.
**How to apply:** Any time session/cache storage comes up in planning — propose PostgreSQL sessions table first; only escalate to Redis if sub-millisecond latency is a hard requirement.
```

**Discovered constraint → write as project:**
```markdown
---
name: payment-api-rate-limit
description: Payment provider API capped at 100 req/s — batch operations required
metadata:
  type: project
---

Payment provider enforces a 100 req/s hard rate limit on the production key.

**Why:** Discovered during payment integration planning (2026-06-21). Hitting the limit returns 429 with a 1-second retry-after header. Current sync design would hit 400 req/s at peak.
**How to apply:** Any payment feature plan must budget for batching or queue-based processing. Never design synchronous per-request payment calls at high volume.
```

**External resource pointer → write as reference:**
```markdown
---
name: internal-api-schema-location
description: Internal user service schema lives in api-contracts repo, not the service repo
metadata:
  type: reference
---

User service API contracts (OpenAPI spec + Protobuf definitions) are maintained in `github.com/my-org/api-contracts/services/user/`.

**Why:** Discovered during user profile planning — the schema is not in the service repo and is easy to miss.
**How to apply:** Before any change touching user service contracts, read from `api-contracts` repo, not the service repo.
```

---

## § Failure Modes to Avoid

| Failure | Prevention |
|---------|-----------|
| Token overload from too many memories | Cap at 5 files; use description-only for lower-priority entries |
| Staleness poisoning | Date-weight retrieval; flag >90-day entries; verify before acting |
| Duplicate noise | Dedup guard before writing; update-before-write discipline |
| Summary distortion | Write atomic per-fact memories, not narrative "planning summaries" |
| False confidence on stale API names | Memories are hypotheses — verify file/function existence before recommending |
