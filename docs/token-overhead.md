# Kit Content Token Overhead

> Honest numbers for HailyKit's own recurring context cost — inspired by the discipline in `juliusbrussee/caveman`'s `HONEST-NUMBERS.md`: publish where a change wins and where it doesn't.

## What actually gets injected, and when

| Cost class | Content | When it's paid |
|---|---|---|
| One-time cacheable prefix | `kit/rules/*.md` | Claude Code auto-loads `~/.claude/rules/` once; a 5-minute-TTL reminder hook (`haily-rules.cjs`) re-injects a **path pointer**, not the file body |
| Recurring per session, claude only | `kit/standards/*.md` | 1–3 files injected on demand per detected stack (`context.cjs`) |
| Recurring per session, all providers | Skill `description:` frontmatter | Every session's skill list |

Rules are cheap on a per-session basis because they're a cached prefix, not a re-sent payload. Standards and skill descriptions are the two classes that actually recur.

## Measured (2026-07-03)

Reproduce with `node scripts/measure-kit-overhead.mjs` — before = last commit (`git show HEAD:<path>`), after = working tree.

| Cost class | Before (bytes / est. tokens) | After (bytes / est. tokens) | Delta |
|---|---|---|---|
| Rules (one-time cacheable prefix) | 27,192 / 6,798 | 27,566 / 6,892 | +1% |
| Standards (recurring, claude only) | 613,800 / 153,450 | 613,127 / 153,282 | 0% |
| Skill descriptions (recurring, all providers) | 7,856 / 1,964 | 7,825 / 1,956 | 0% |

Standards realistic exposure: 106 files, avg ~5.8KB each after compression. A session injects 1–3 of them (~1,450–4,340 tokens est.), never the full 613KB catalog.

**Rules grew, not shrank.** The compression pass (dropping articles/filler via `scripts/compress-kit-prose.mjs`) saved bytes, but this same change added a new `## Output Economy` section to `haily-coding.md`, and the net is a small increase. This is the honest result, not a rounding error — a compressor with no fixed floor can coexist with a file that gets bigger because new content was added. Reporting only the compressor's isolated effect would hide that.

**Standards and descriptions barely moved.** kit content is written tersely by mandate already (`docs/engineering-standards.md`), so there was little filler left to remove — matching the ~1–2% yield already observed when the compressor was first run in isolation, before other content additions.

## Ref-expansion caveat

Installed rules are post-resolution, not source bytes. `kit/rules` contains 160 `{skill:...}` refs and 0 `{agent:...}` refs. For the claude provider, `{skill:hc-x}` resolves to `/hc-x` (`merger.ts`) — this **shrinks** installed rules by roughly 7 bytes per ref (~1.1KB total here), on top of the source-level numbers above. `{agent:X}` resolves to a much longer sentence (`` Delegate to a **X** subagent — use `Task(subagent_type="X")`. ``), but that tag never appears in `kit/rules` — it lives in skill reference docs, which this measurement does not cover. Do not assume source-byte savings equal installed-byte savings without checking which ref types are actually present.

## What this does NOT save

- Skill and agent body prose (deliberately out of scope — wording precision matters more there than a few hundred bytes; see `scripts/compress-kit-prose.mjs` module header)
- Tool-call results injected into a running session
- The user's own prompts and file context, which dominate a real session's token spend

Session-level savings are always smaller than any single-class number above, because input context — not kit content — is most of what a coding agent reads per turn.

## Verify yourself

The only fully honest test is an A/B: run comparable sessions with and without this change and compare your provider's own usage page. Re-run `node scripts/measure-kit-overhead.mjs` after any future kit edit to get current numbers — this page's table is a snapshot, not a live figure.
