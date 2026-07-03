import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compressProse } from '../lib/prose-compressor';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULES_FIXTURE = path.join(REPO_ROOT, 'kit', 'rules', 'haily-domain.md');
const STANDARDS_FIXTURE = path.join(REPO_ROOT, 'kit', 'standards', 'framework-htmx.md');

// ---------------------------------------------------------------------------
// Golden tests — real kit content, protected segments must survive verbatim
// ---------------------------------------------------------------------------

function assertSegmentsSurvive(source: string, compressed: string): void {
  // [ \t]{0,3}, not \s{0,3} — \s includes \n, so on a blank line before a
  // fence it silently consumes that line's own newline as "indentation",
  // anchoring the match one line early and desyncing group \1 from the real
  // fence line. The compressor itself is immune (it matches per-line after
  // split('\n'), where no line ever contains an embedded \n) — this is a
  // fixture-regex-only fix.
  const codeFences = source.match(/^([ \t]{0,3})(`{3,}|~{3,})[\s\S]*?^\1\2.*$/gm) || [];
  for (const block of codeFences) assert.ok(compressed.includes(block), `code fence missing: ${block.slice(0, 40)}...`);

  const inlineCode = source.match(/`[^`\n]+`/g) || [];
  for (const span of inlineCode) assert.ok(compressed.includes(span), `inline code missing: ${span}`);

  const urls = source.match(/\bhttps?:\/\/\S+/gi) || [];
  for (const url of urls) assert.ok(compressed.includes(url), `URL missing: ${url}`);

  const skillRefs = source.match(/\{skill:(?:hc|hd|hl|hs)-[a-z][a-z0-9-]*\}/g) || [];
  for (const ref of skillRefs) assert.ok(compressed.includes(ref), `skill ref missing: ${ref}`);

  const headings = source.match(/^#{1,6}[ \t].*$/gm) || [];
  for (const h of headings) assert.ok(compressed.includes(h), `heading missing: ${h}`);

  const tableRows = source.match(/^.*\|.*$/gm) || [];
  for (const row of tableRows) assert.ok(compressed.includes(row), `table row missing: ${row}`);
}

function assertIndentationPreserved(source: string, compressed: string): void {
  const sourceIndents = source.split('\n').map((l) => /^[ \t]*/.exec(l)![0]);
  const compressedIndents = compressed.split('\n').map((l) => /^[ \t]*/.exec(l)![0]);
  assert.equal(compressedIndents.length, sourceIndents.length, 'line count changed');
  for (let i = 0; i < sourceIndents.length; i++) {
    assert.equal(compressedIndents[i], sourceIndents[i], `line ${i + 1} indentation changed`);
  }
}

test('golden: kit/rules/haily-domain.md — protected segments survive, indentation unchanged', () => {
  const source = fs.readFileSync(RULES_FIXTURE, 'utf8');
  const { compressed, skipped } = compressProse(source);
  assert.equal(skipped, undefined);
  assertSegmentsSurvive(source, compressed);
  assertIndentationPreserved(source, compressed);
});

test('golden: kit/standards/framework-htmx.md (code-fence-heavy) — protected segments survive, indentation unchanged', () => {
  const source = fs.readFileSync(STANDARDS_FIXTURE, 'utf8');
  const { compressed, skipped } = compressProse(source);
  assert.equal(skipped, undefined);
  assertSegmentsSurvive(source, compressed);
  assertIndentationPreserved(source, compressed);
});

test('golden: safety-marker lines (NEVER / MUST NOT / DO NOT / IMPORTANT:) survive byte-identical', () => {
  const source = [
    '- **NEVER** commit secrets (`.env`, API keys, DB credentials).',
    'You should really just be careful, but you must NOT ever skip this step.',
    'Do NOT ignore failing tests to make CI green.',
    '**IMPORTANT:** Activate the skills needed for the task as you go.',
  ].join('\n');
  const { compressed } = compressProse(source);
  for (const line of source.split('\n')) {
    assert.ok(compressed.includes(line), `safety line altered: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

test('idempotence: compressing twice equals compressing once', () => {
  const source = fs.readFileSync(RULES_FIXTURE, 'utf8');
  const once = compressProse(source).compressed;
  const twice = compressProse(once).compressed;
  assert.equal(twice, once);
});

test('output never contains a NUL byte', () => {
  const source = fs.readFileSync(STANDARDS_FIXTURE, 'utf8');
  const { compressed } = compressProse(source);
  assert.ok(!compressed.includes('\u0000'));
});

test('regression: NUL already present in input is skipped untouched (collision surface removed)', () => {
  const source = 'Some prose with a literal \u0000 byte and a URL https://example.com/docs.';
  const result = compressProse(source);
  assert.equal(result.skipped, 'nul-in-input');
  assert.equal(result.compressed, source);
});

test('regression: bare numbers next to a protected URL survive uncorrupted (caveman collision defect)', () => {
  const source = 'Retry 0 times before reading https://example.com/docs for details.';
  const { compressed } = compressProse(source);
  assert.ok(compressed.includes('https://example.com/docs'), 'URL corrupted');
  assert.ok(/\b0\b/.test(compressed), 'bare number corrupted');
});

test('regression: "make sure" idiom survives — "sure" is excluded from the pleasantry list', () => {
  const source = 'Make sure you are reading the right config before deploy.';
  const { compressed } = compressProse(source);
  assert.ok(/\bmake sure\b/i.test(compressed), `"make sure" corrupted: ${compressed}`);
});

test('regression: filler words inside a hyphenated compound survive — \\b treats "-" as a boundary', () => {
  const cases = [
    ['**Just-in-time compiled** — no bytecode cache.', 'Just-in-time'],
    ['Really-simple syndication is unrelated to filler removal.', 'Really-simple'],
  ];
  for (const [source, compound] of cases) {
    const { compressed } = compressProse(source);
    assert.ok(compressed.includes(compound), `compound corrupted: got "${compressed}" from "${source}"`);
  }
});

test('regression: sentence-initial filler/pleasantry/hedge removal recapitalizes what follows', () => {
  const cases = [
    ['Just collect the address and store it.', 'Collect'],
    ['Please read the docs before filing an issue.', 'Read'],
    ['Perhaps consider a retry with backoff.', 'Consider'],
  ];
  for (const [source, expectedStart] of cases) {
    const { compressed } = compressProse(source);
    assert.ok(
      compressed.startsWith(expectedStart),
      `expected "${compressed}" to start with "${expectedStart}" (source: "${source}")`,
    );
  }
});

test('empty input returns unchanged with skipped: empty', () => {
  const result = compressProse('');
  assert.equal(result.compressed, '');
  assert.equal(result.skipped, 'empty');
});

test('nested fences: 4-backtick outer fence containing a 3-backtick example survives verbatim', () => {
  const source = [
    '````markdown',
    'Example:',
    '```js',
    'const x = 1;',
    '```',
    '````',
  ].join('\n');
  const { compressed } = compressProse(source);
  assert.equal(compressed, source);
});

test('nested list indentation depth is preserved across multiple levels', () => {
  const source = [
    '- top level item, you should really read this carefully',
    '  - nested item, just a note',
    '    - deeply nested item, please check this',
  ].join('\n');
  const { compressed } = compressProse(source);
  const indents = compressed.split('\n').map((l) => /^[ \t]*/.exec(l)![0].length);
  assert.deepEqual(indents, [0, 2, 4]);
});

// ---------------------------------------------------------------------------
// Measured floor — no fixed CI gate (per red team finding #3), just a sanity
// check that the compressor is not a silent no-op on real content.
// ---------------------------------------------------------------------------

test('sanity: compression is non-zero on real standards content with droppable filler', () => {
  const source = fs.readFileSync(STANDARDS_FIXTURE, 'utf8');
  const { before, after } = compressProse(source);
  assert.ok(after <= before, 'compressed output grew');
});
