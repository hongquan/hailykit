import * as fs from 'node:fs';

/**
 * AUTHOR-TIME TOOL ONLY. Never import this into an installer, hook, or any
 * path that runs during install/upgrade/a live session — it does lossy prose
 * editing meant for a human `git diff` review before commit. Invoke only via
 * scripts/compress-kit-prose.mjs, run manually by the maintainer.
 *
 * Deterministic protect->transform->restore prose compressor for kit markdown.
 * The compressed text becomes the committed, reviewed, CI-checked source.
 *
 * Sentinel is NUL-delimited (`\u0000<index>\u0000`) rather than caveman-shrink's
 * space-digit-space, which corrupts prose containing bare integers once restored
 * segments reintroduce spaces. A NUL byte cannot occur in committed markdown, so
 * `compressProse` pre-scans for one and skips the file outright if found —
 * removing the collision surface rather than only detecting it after the fact.
 *
 * Wordlists are English-only by design; kit content is English.
 */

const NUL = '\u0000';
const MAX_RESTORE_PASSES = 8;

/**
 * {skill:...} / {agent...:...} refs, duplicated from cli/installer/converter.ts
 * (SKILL_REF_RE / AGENT_REF_RE) rather than imported, so this module and the
 * compiled script stay standalone. Keep these two patterns in sync by hand if
 * the reference syntax ever changes.
 */
const SKILL_REF_RE = /\{skill:((?:hc|hd|hl|hs)-[a-z][a-z0-9-]*)\}/g;
const AGENT_REF_RE = /\{(agents?(?:-result)?):([a-z][a-z0-9,-]*)\}/g;

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const FENCE_OPEN_RE = /^(\s{0,3})(`{3,}|~{3,})/;
const HEADING_RE = /^#{1,6}[ \t].*$/gm;
const TABLE_ROW_RE = /^.*\|.*$/gm;
// Matches any line carrying an emphatic-caps prohibition ("NEVER", "must NOT",
// "Do NOT") or a bolded IMPORTANT callout — the word's caps signal intent
// regardless of the surrounding sentence's case.
const SAFETY_LINE_RE = /^.*(?:\bNEVER\b|\bNOT\b|\*\*IMPORTANT:?\*\*).*$/gm;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const PATH_RE = /\b[\w-]*[/\\][\w./\\-]+/g;
const FILENAME_RE = /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|py|toml|sh|ps1)\b/g;
const CONST_CASE_RE = /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g;
const FUNCTION_CALL_RE = /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g;
const VERSION_RE = /\b\d+\.\d+\.\d+\b/g;

/** Applied in order; each replaces its matches with a NUL-delimited sentinel. */
function getRegexProtections(): RegExp[] {
  return [
    SKILL_REF_RE, AGENT_REF_RE,
    HEADING_RE, TABLE_ROW_RE, SAFETY_LINE_RE,
    INLINE_CODE_RE, URL_RE, PATH_RE, FILENAME_RE,
    CONST_CASE_RE, FUNCTION_CALL_RE, VERSION_RE,
  ].map((re) => new RegExp(re.source, re.flags));
}

// Leaders and articles CONSUME (not lookahead) the character that follows their
// trailing whitespace, so removal can recapitalize it inline when the removed
// phrase itself was capitalized — the only reliable signal it opened a sentence.
// A separate blanket "capitalize every line start" pass was tried and rejected:
// it recapitalized lines that never had anything removed (`vs Streamlit` ->
// `Vs Streamlit`, `sqlc generates...` -> `Sqlc generates...`).
const LEADERS_RE = /^(you should|make sure to|remember to)\s+([a-z])/gim;

// "sure" deliberately excluded — it is the tail of the idiom "make sure" (extremely
// common in kit prose), and \bsure\b has no way to tell "Sure, I'll do that" apart
// from "make sure X is set" without a fragile lookbehind. Losing the rare standalone
// pleasantry is a better trade than corrupting "make sure" into "make X is set".
const PLEASANTRY_WORDS = 'please|kindly|thank you|thanks|certainly|of course|happy to|i\'?d be happy';
const HEDGE_WORDS = 'perhaps|maybe|it might be worth|you could consider';
const FILLER_WORDS = 'just|really|basically|actually|simply|essentially|quite|very|literally';

// (?!-) guards every wordlist below against hyphenated compounds — \b treats a
// hyphen as a boundary, so \bjust\b alone matches "Just" inside "Just-in-time"
// and strips it to "-in-time". Sentence-initial ("^...") variants consume and
// recapitalize the next character, mirroring LEADERS_RE/ARTICLES_RE, because a
// removed word at line start otherwise leaves the following word lowercase.
const PLEASANTRIES_INITIAL_RE = new RegExp(`^(${PLEASANTRY_WORDS})(?!-)\\b[,.]?\\s+([a-z])`, 'gim');
const PLEASANTRIES_RE = new RegExp(`\\b(?:${PLEASANTRY_WORDS})(?!-)\\b[,.]?\\s*`, 'gi');
const HEDGES_INITIAL_RE = new RegExp(`^(${HEDGE_WORDS})(?!-)\\b\\s+([a-z])`, 'gim');
const HEDGES_RE = new RegExp(`\\b(?:${HEDGE_WORDS})(?!-)\\b\\s*`, 'gi');
const FILLERS_INITIAL_RE = new RegExp(`^(${FILLER_WORDS})(?!-)\\b\\s+([a-z])`, 'gim');
const FILLERS_RE = new RegExp(`\\b(?:${FILLER_WORDS})(?!-)\\b\\s*`, 'gi');
const ARTICLES_RE = /\b(A|An|The|a|an|the)\s+([a-z])/g;

function protectFencedCode(text: string, protect: (m: string) => string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN_RE.exec(lines[i]);
    if (!open) { out.push(lines[i]); i++; continue; }
    const fenceChar = open[2][0] === '`' ? '`' : '~';
    const fenceLen = open[2].length;
    const closeRe = new RegExp(`^\\s{0,3}${fenceChar}{${fenceLen},}\\s*$`);
    const start = i;
    i++;
    while (i < lines.length && !closeRe.test(lines[i])) i++;
    if (i < lines.length) i++; // include closing fence line
    out.push(protect(lines.slice(start, i).join('\n')));
  }
  return out.join('\n');
}

function withProtectedSegments(text: string, transform: (s: string) => string): string {
  const segments: string[] = [];
  const protect = (match: string): string => {
    const idx = segments.length;
    segments.push(match);
    return `${NUL}${idx}${NUL}`;
  };

  let working = text.replace(FRONTMATTER_RE, protect);
  working = protectFencedCode(working, protect);
  for (const re of getRegexProtections()) {
    working = working.replace(re, protect);
  }

  let out = transform(working);

  const sentinelRe = /\u0000(\d+)\u0000/;
  for (let pass = 0; pass < MAX_RESTORE_PASSES; pass++) {
    if (!sentinelRe.test(out)) break;
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => segments[Number(i)]);
  }
  return out;
}

/** Collapses runs of 2+ spaces/tabs within a line — never touches leading indentation. */
function collapseIntraLineWhitespace(text: string): string {
  // [\s\S] (not `.`) so a CRLF file's trailing \r on each split line is
  // captured by the match instead of failing it — `.` excludes line
  // terminators, including a bare \r, and `$` (no /m/ here) demands one.
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*)([\s\S]*)$/.exec(line)!;
      return m[1] + m[2].replace(/[ \t]{2,}/g, ' ');
    })
    .join('\n');
}

function transformProse(text: string): string {
  let s = text;
  const recap = (_: string, _phrase: string, ch: string): string => ch.toUpperCase();
  // Sentence-initial variants run first and recapitalize what follows ("Just
  // collect X" -> "Collect X"); the general variants below then handle the
  // same words mid-sentence, where the surrounding case never changes.
  s = s.replace(LEADERS_RE, recap);
  s = s.replace(PLEASANTRIES_INITIAL_RE, recap);
  s = s.replace(HEDGES_INITIAL_RE, recap);
  s = s.replace(FILLERS_INITIAL_RE, recap);
  s = s.replace(PLEASANTRIES_RE, '');
  s = s.replace(HEDGES_RE, '');
  s = s.replace(FILLERS_RE, '');
  // Recapitalize only when the removed article itself was capitalized
  // ("The X" -> "X"); a lowercase mid-sentence article ("wrap a value") never
  // needs it, and leaving that decision to a separate blanket per-line pass is
  // what corrupted lowercase-by-design line starts like "vs" and "sqlc".
  s = s.replace(ARTICLES_RE, (_, article, ch) => (/^[A-Z]/.test(article) ? ch.toUpperCase() : ch));
  s = collapseIntraLineWhitespace(s);
  // Negative lookahead excludes "word .NET" / "file .env" — a space before
  // punctuation that's itself immediately followed by a letter/digit is not
  // sentence-ending spacing, it is a word boundary before a dotted proper
  // noun or filename, and collapsing it would fuse the two tokens.
  s = s.replace(/[ \t]+([,.;:!?])(?![A-Za-z0-9])/g, '$1');
  return s;
}

export interface CompressResult {
  compressed: string;
  before: number;
  after: number;
  skipped?: 'empty' | 'nul-in-input' | 'restore-failed' | 'error';
}

export function compressProse(text: string): CompressResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { compressed: text, before: 0, after: 0, skipped: 'empty' };
  }
  const before = text.length;
  if (text.includes(NUL)) {
    return { compressed: text, before, after: before, skipped: 'nul-in-input' };
  }

  let result: string;
  try {
    result = withProtectedSegments(text, transformProse);
  } catch {
    return { compressed: text, before, after: before, skipped: 'error' };
  }

  if (result.includes(NUL)) {
    return { compressed: text, before, after: before, skipped: 'restore-failed' };
  }

  return { compressed: result, before, after: result.length };
}

export function compressFile(filePath: string): CompressResult {
  const raw = fs.readFileSync(filePath, 'utf8');
  return compressProse(raw);
}
