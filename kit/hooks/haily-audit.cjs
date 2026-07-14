#!/usr/bin/env node
/**
 * haily-audit.cjs — Tool-call activity log: best-effort, NOT tamper-evident,
 * no fsync, gitignored. Reconstructs agent/dev actions after an incident on a
 * best-effort basis only — plaintext, world-readable, rotated archives are
 * just as editable as the live file.
 *
 * Fires on PostToolUse (*) and SessionEnd; also subsumes the haily-usage quota
 * refresh duty on the PostToolUse hot path (single Node spawn per tool call) —
 * haily-usage.cjs stays wired on SessionStart/UserPromptSubmit only.
 *
 * Honest limitation: PostToolUse carries no actor `agent_type` (only
 * SubagentStart does) — `agentType` below is env-derived and spoofable by the
 * audited party. Reconstruct which subagent acted by correlating this file's
 * timestamps against haily-tracer/haily-subagent spawn records in hook-log.jsonl.
 *
 * Config key (isHookEnabled): 'audit-trail' — default true (local file, no
 * network egress, so opt-in parity with haily-usage is unnecessary).
 * Exit codes: 0 always (fail-open, never blocks a tool call).
 * @module haily-audit
 */
'use strict';

try {
  const fs = require('node:fs');
  const path = require('node:path');
  const { isHookEnabled } = require('./haily-lib/config.cjs');
  const { createHookTimer, logHookCrash } = require('./haily-lib/logger.cjs');
  const { classifyPath } = require('./haily-lib/sensitive.cjs');
  const { getCacheAgeMs, readUsageCache, refreshUsageCache } = require('./haily-lib/usage.cjs');
  const { ensureGitignoreEntry } = require('./haily-lib/gitignore.cjs');
  const ROTATE_BYTES = 5 * 1024 * 1024; // size-only trigger — a line-count trigger would force a full-file read per append
  const KEEP_ARCHIVES = 5;
  const MAX_TARGET_LEN = 500;
  const LOCK_STALE_MS = 3000;
  const LOCK_RETRY_MS = 5;
  const LOCK_TIMEOUT_MS = 200;
  const INTERVAL_TOOL_MS = 5 * 60 * 1000; // mirrors haily-usage.cjs's tool-event throttle
  function logDir() { return path.join(process.cwd(), '.logs'); }
  function logPath() { return path.join(logDir(), 'audit.jsonl'); }
  function lockPath() { return logPath() + '.lock'; }
  // Inline lock — logger.cjs's lock helpers are module-private, so a small duplicate lives here.
  function acquireLock() {
    const lp = lockPath();
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        fs.writeFileSync(lp, String(process.pid), { flag: 'wx' });
        return lp;
      } catch {
        try {
          const age = Date.now() - fs.statSync(lp).mtimeMs;
          if (age > LOCK_STALE_MS) fs.unlinkSync(lp);
        } catch { /* ignore */ }
        const end = Date.now() + LOCK_RETRY_MS;
        while (Date.now() < end) { /* spin */ }
      }
    }
    return null; // timed out — caller drops the line (lossy-under-contention; see writeActivityLine)
  }
  function releaseLock(lp) {
    if (!lp) return;
    try { fs.unlinkSync(lp); } catch { /* ignore */ }
  }
  // Each rule masks the secret VALUE, except opaque token prefixes (rule 5) where the whole
  // token IS the secret. Specific shapes run before the generic hex/base64 catch-alls.
  const REDACT_RULES = [
    [/:\/\/([^:/\s@]+):([^@/\s]+)@/g, '://$1:***@'],                     // connection-string creds
    [/(-u|--user)([ =])(\S+)/gi, '$1$2***'],                              // curl basic-auth
    [/(authorization\s*:\s*)([^\s"']+(?:\s+[^\s"']+)?)/gi, '$1***'],      // Authorization header value
    [/(x-api-key|api-key|apikey)(\s*:\s*)([^\s"']+)/gi, '$1$2***'],       // API-key headers
    [/\b(ghp_|gho_|AKIA|xox[abpr]-|sk-|AIza)[A-Za-z0-9_-]+/g, '***'],     // known token prefixes
    [/\b([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*)=(\S+)/g, '$1=***'], // env assignments (uppercase by convention)
    [/(--password|--token|--secret|-p)([ =])(\S+)/gi, '$1$2***'],       // CLI flags: '=' or space form (incl. -p)
    [/([?&])(api[_-]?key|token|password|secret)=([^&\s"']+)/gi, '$1$2=***'], // query-string creds (?/&, not ':' or uppercase '=')
    [/\b[0-9a-fA-F]{32,}\b/g, '***'],                                     // long hex runs
    [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '***'],                             // base64-looking runs
  ];
  /** Redact secret-shaped substrings from a Bash command before it is logged. */
  function redactCommand(cmd) {
    let out = String(cmd);
    for (const [pattern, replacement] of REDACT_RULES) out = out.replace(pattern, replacement);
    return out.length > MAX_TARGET_LEN ? out.slice(0, MAX_TARGET_LEN) + '...(truncated)' : out;
  }
  // Never logs the full tool_input blob — only this single narrow field — so secrets in unrelated input fields can't leak through.
  const PATH_FIELD_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit']);
  function maskIfSensitive(p) {
    try {
      const tier = classifyPath(p);
      return tier ? `<sensitive:${tier}>` : p;
    } catch { return p; }
  }
  function extractTarget(toolName, input = {}) {
    if (PATH_FIELD_TOOLS.has(toolName) && input.file_path) return maskIfSensitive(input.file_path);
    if (toolName === 'NotebookEdit' && input.notebook_path) return maskIfSensitive(input.notebook_path);
    if (toolName === 'Bash' && typeof input.command === 'string') return redactCommand(input.command);
    if ((toolName === 'Task' || toolName === 'Agent') && input.subagent_type) return String(input.subagent_type);
    if ((toolName === 'Grep' || toolName === 'Glob') && input.pattern) return String(input.pattern);
    return null;
  }
  function archiveIndexFor(dir, datePrefix) {
    let max = 0;
    try {
      const re = new RegExp(`^audit-${datePrefix}-(\\d{3})\\.jsonl$`);
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    } catch { /* dir unreadable — start at 1 */ }
    return max + 1;
  }
  // Zero-padded "YYMMDD-NNN" keys sort correctly as plain strings — an unpadded index would delete the NEWEST archive once a day passes 10 rotations.
  function pruneArchives(dir) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => /^audit-\d{6}-\d{3}\.jsonl$/.test(f)).sort();
    } catch { return; }
    for (let i = 0; i < files.length - KEEP_ARCHIVES; i++) {
      try { fs.unlinkSync(path.join(dir, files[i])); } catch { /* fail-open */ }
    }
  }
  // Size-only rotation — never truncate-in-place. Renames the live file to a
  // zero-padded archive and starts a fresh one; O(1) size check per append.
  function rotateIfNeeded(p) {
    let size;
    try { size = fs.statSync(p).size; } catch { return; } // no file yet — nothing to rotate
    if (size < ROTATE_BYTES) return;
    const dir = path.dirname(p);
    const datePrefix = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const idx = String(archiveIndexFor(dir, datePrefix)).padStart(3, '0');
    const archivePath = path.join(dir, `audit-${datePrefix}-${idx}.jsonl`);
    try {
      fs.renameSync(p, archivePath); // Windows may throw EPERM/EBUSY if held open — fail-open, skip rotation this call
      try { fs.chmodSync(archivePath, 0o600); } catch { /* no-op on Windows, still attempted */ }
    } catch { return; }
    pruneArchives(dir);
  }
  // Lossy-under-contention: a lock timeout skips the line rather than blocking
  // the tool call — a "dropped" marker would itself need the same lock.
  function writeActivityLine(entry) {
    ensureGitignoreEntry(process.cwd());
    try { fs.mkdirSync(logDir(), { recursive: true }); } catch { /* ignore */ }
    const lp = acquireLock();
    if (!lp) return;
    try {
      rotateIfNeeded(logPath());
      // Whole line is JSON.stringify'd (not concatenated) so control chars in a
      // redacted command/path (\n, ") are escaped — one call = one parse-able line.
      fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n', 'utf8');
      try { fs.chmodSync(logPath(), 0o600); } catch { /* no-op on Windows, still attempted */ }
    } finally {
      releaseLock(lp);
    }
  }
  async function main() {
    const timer = createHookTimer('haily-audit');
    let data = {};
    try {
      const raw = fs.readFileSync(0, 'utf8');
      if (raw.trim()) data = JSON.parse(raw);
    } catch { /* fail-open: use empty data */ }
    const sessionId = String(data.session_id || process.env.HL_SESSION_ID || '').slice(0, 8);
    const hookEvent = data.hook_event_name || '';
    if (hookEvent === 'SessionEnd') {
      if (isHookEnabled('audit-trail')) {
        writeActivityLine({ ts: new Date().toISOString(), sessionId, event: 'session-end' });
      }
      timer.end({ status: 'ok', exit: 0, event: hookEvent });
      process.exit(0);
    }
    const toolName = data.tool_name || '';
    // Best-effort actor label — never trust this for security decisions; it is env-derived and spoofable by the audited party (see header note).
    const agentType = process.env.HL_AGENT_TYPE || 'main';
    if (isHookEnabled('audit-trail')) {
      const target = extractTarget(toolName, data.tool_input || {});
      writeActivityLine({ ts: new Date().toISOString(), sessionId, agentType, tool: toolName, target });
    }
    // Single-spawn subsumption: this hook is now the only PostToolUse spawn, so
    // the quota refresh haily-usage.cjs used to run here happens inline instead
    // of via a second Node process. The 'haily-usage' flag still gates it.
    if (isHookEnabled('haily-usage') && getCacheAgeMs(readUsageCache()) >= INTERVAL_TOOL_MS) {
      try { await refreshUsageCache({ fetchTimeoutMs: 5000, userAgent: 'hailykit/haily-audit' }); } catch { /* fail-open */ }
    }
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    timer.end({ status: 'ok', exit: 0, event: hookEvent || 'PostToolUse', tool: toolName });
    process.exit(0);
  }
  main().catch((e) => {
    logHookCrash('haily-audit', e);
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    process.exit(0);
  });
} catch (e) {
  try { require('./haily-lib/logger.cjs').logHookCrash('haily-audit', e); } catch { /* ignore */ }
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exit(0);
}
