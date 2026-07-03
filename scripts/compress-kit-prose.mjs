#!/usr/bin/env node
/**
 * compress-kit-prose.mjs — author-time dev tool. Run before committing edits
 * to kit/rules or kit/standards to strip filler/hedging/pleasantries from
 * English prose while leaving code, URLs, paths, refs, and safety-marker
 * lines byte-identical. The compressed output IS the reviewed, committed
 * source — `git diff` is the review gate, not a runtime or install-time step.
 *
 * Usage:
 *   node scripts/compress-kit-prose.mjs <file|dir> [--dry-run]
 *
 * Requires a build: imports the compiled compressor from dist/lib/.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(process.cwd());
const KIT_ROOT = join(REPO_ROOT, 'kit');
const COMPRESSOR_PATH = join(REPO_ROOT, 'dist', 'lib', 'prose-compressor.js');

if (!existsSync(COMPRESSOR_PATH)) {
  console.error(`compress-kit-prose: missing ${COMPRESSOR_PATH} — run "npm run build" first.`);
  process.exit(2);
}

const { compressProse } = await import(pathToFileURL(COMPRESSOR_PATH).href);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Usage: node scripts/compress-kit-prose.mjs <file|dir> [--dry-run] [--force]');
  process.exit(2);
}

const resolvedTarget = resolve(target);
const rel = relative(KIT_ROOT, resolvedTarget);
if (rel.startsWith('..')) {
  console.error(`compress-kit-prose: refusing target outside kit/: ${resolvedTarget}`);
  console.error('This tool only compresses kit/rules and kit/standards content — not docs/, README, or other repo files.');
  process.exit(2);
}

// Recovery guarantee: if compression corrupts a file, `git checkout -- <file>`
// must undo ONLY this run's changes, never collateral edits the maintainer
// already had in progress. --force bypasses this for a fresh clone or CI.
if (!dryRun && !force) {
  let dirty = '';
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', resolvedTarget], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    console.error('compress-kit-prose: could not check git status — run inside the repo, or pass --force.');
    process.exit(2);
  }
  if (dirty.trim()) {
    console.error(`compress-kit-prose: ${resolvedTarget} has uncommitted changes — commit or stash first.`);
    console.error('Running over already-dirty files means git checkout cannot cleanly undo a bad compression pass. Pass --force to override.');
    process.exit(2);
  }
}

function collectMarkdownFiles(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    console.error(`compress-kit-prose: path not found: ${path}`);
    process.exit(2);
  }
  if (stat.isFile()) {
    if (extname(path) !== '.md') {
      console.error(`compress-kit-prose: refusing non-markdown file: ${path}`);
      process.exit(2);
    }
    return [path];
  }
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(full));
    else if (entry.isFile() && extname(entry.name) === '.md') files.push(full);
  }
  return files;
}

const files = collectMarkdownFiles(resolvedTarget);
let totalBefore = 0;
let totalAfter = 0;
let skippedCount = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const { compressed, before, after, skipped } = compressProse(source);

  if (skipped) {
    console.warn(`skip: ${file} (${skipped})`);
    skippedCount++;
    continue;
  }

  totalBefore += before;
  totalAfter += after;
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  console.log(`${dryRun ? '[dry-run] ' : ''}${file}: ${before} -> ${after} bytes (-${pct}%)`);

  if (!dryRun && compressed !== source) {
    writeFileSync(file, compressed, 'utf8');
  }
}

const aggPct = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
console.log(`\n${files.length} file(s), ${skippedCount} skipped — ${totalBefore} -> ${totalAfter} bytes (-${aggPct}%)`);
