#!/usr/bin/env node
/**
 * gitignore.cjs — Per-project `.gitignore` enforcement for HailyKit hooks.
 *
 * @module gitignore
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Matches '.logs' or '.logs/' as its own line, with optional leading slash.
const GITIGNORE_LOGS_RE = /^\s*\/?\.logs\/?\s*$/m;

// Enforced per-project (not just at install time — callers run across many
// cwds): read + search every call, write only if truly absent from
// .gitignore. Fail-open: a write failure must never block logging.
/**
 * Ensure `<cwd>/.gitignore` covers `.logs/`, appending the entry only when
 * missing so an already-compliant file is never rewritten.
 * @param {string} cwd
 * @returns {void}
 */
function ensureGitignoreEntry(cwd) {
  try {
    const gitignorePath = path.join(cwd, '.gitignore');
    let existing = '';
    try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* absent */ }
    if (GITIGNORE_LOGS_RE.test(existing)) return;
    const nl = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, `${nl}.logs/\n`);
  } catch { /* fail-open */ }
}

module.exports = {
  GITIGNORE_LOGS_RE,
  ensureGitignoreEntry,
};
