#!/usr/bin/env node
/*
 * Build dist/ and package the release artifact `release/hailykit.zip`.
 *
 * The artifact ships the compiled CLI/library plus metadata — and nothing
 * else, because hailykit has zero runtime dependencies (no node_modules
 * needed to run dist/bin.js). Zero-dependency itself: it shells out to the
 * platform's zip tool, mirroring src/installer/extractor.ts.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createZip } from './zip-writer.mjs';

const ROOT = process.cwd();
const RELEASE_DIR = join(ROOT, 'release');
const STAGE_DIR = join(RELEASE_DIR, 'hailykit');
const OUT_ZIP = join(RELEASE_DIR, 'hailykit.zip');
const INCLUDE = ['package.json', 'README.md', 'LICENSE'];

function copyToolAssets() {
  const src  = join(ROOT, 'cli', 'tools');
  const dest = join(ROOT, 'dist', 'tools');
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (s) => statSync(s).isDirectory() || !s.endsWith('.ts'),
  });
  console.log('Copied tool assets: cli/tools/ → dist/tools/');
}

/** Run the locally-installed TypeScript compiler via the current Node binary. */
function buildDist() {
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    throw new Error('TypeScript not installed — run `npm install` first.');
  }
  console.log('Building dist/ ...');
  execFileSync(process.execPath, [tsc], { stdio: 'inherit', cwd: ROOT });
  copyToolAssets();  // postbuild doesn't fire when tsc is called directly
}

/** Stage dist/ + metadata into release/hailykit/. */
function stage() {
  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });
  cpSync(join(ROOT, 'dist'), join(STAGE_DIR, 'dist'), { recursive: true });
  // The skill catalog ships alongside the CLI so `hailykit install` can find it.
  if (existsSync(join(ROOT, 'kit'))) {
    cpSync(join(ROOT, 'kit'), join(STAGE_DIR, 'kit'), { recursive: true });
  }
  for (const file of INCLUDE) {
    if (existsSync(join(ROOT, file))) copyFileSync(join(ROOT, file), join(STAGE_DIR, file));
  }
}

/** Recursively collect every file under `dir` as {archivePath, absPath}. */
function collectFiles(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(abs));
    else out.push({ absPath: abs, archivePath: relative(RELEASE_DIR, abs).replace(/\\/g, '/') });
  }
  return out;
}

buildDist();
stage();

// Stamp the release version into the staged kit/metadata.json so that
// installed copies always report the correct version.  package.json is the
// single source of truth for the version number; kit/metadata.json in the
// repo is a working-copy file that may lag behind between bumps.
const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const stagedMetaPath = join(STAGE_DIR, 'kit', 'metadata.json');
if (existsSync(stagedMetaPath)) {
  const meta = JSON.parse(readFileSync(stagedMetaPath, 'utf8'));
  meta.version = pkgVersion;
  meta.buildDate = new Date().toISOString().slice(0, 10);
  writeFileSync(stagedMetaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`Stamped kit/metadata.json → version=${pkgVersion}`);
}

const files = collectFiles(STAGE_DIR);
createZip(files, OUT_ZIP);
console.log(`\nPackaged ${OUT_ZIP} (${files.length} files)`);
