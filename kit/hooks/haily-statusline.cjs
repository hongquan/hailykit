#!/usr/bin/env node
/**
 * haily-statusline.cjs — Claude Code statusLine command.
 *
 * Renders a one-line live session summary: model, elapsed time, lines
 * changed, agent/task progress, and quota. The statusline is the only
 * channel Claude Code reliably renders in both the CLI and the VSCode
 * extension — Stop-hook `systemMessage` output is swallowed by the UI
 * (anthropics/claude-code#50542), so the end-of-session summary lives
 * here instead, visible throughout the session.
 *
 * stdin: statusline JSON payload (model, cost, session_id, …)
 * stdout: single text line (first line only is displayed)
 *
 * Config key (isHookEnabled): 'statusline'
 * Exit codes: 0 always (fail-open — empty output hides the line)
 *
 * @module haily-statusline
 */

'use strict';

try {
  const fs = require('node:fs');

  const { isHookEnabled } = require('./haily-lib/config.cjs');
  const { readActivitySnapshot } = require('./haily-lib/statusline.cjs');
  const { readUsageCache, getCacheAgeMs } = require('./haily-lib/usage.cjs');
  const { formatModelDisplay } = require('./haily-lib/model.cjs');

  if (!isHookEnabled('statusline')) process.exit(0);

  const USAGE_FRESH_MS = 30 * 60 * 1000;

  function formatDuration(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  function main() {
    let data;
    try { data = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

    const parts = [];

    const modelName = data?.model?.display_name
      || formatModelDisplay(data?.model?.id || '');
    if (modelName) parts.push(`🤖 ${modelName}`);

    const snap = readActivitySnapshot(data?.session_id || '');

    // Duration: Claude Code's own wall-clock counter; fall back to the
    // session snapshot's start time when cost data is absent.
    const cost = data?.cost || {};
    let durationMs = Number(cost.total_duration_ms);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      const startMs = snap?.sessionStart ? Date.parse(snap.sessionStart) : NaN;
      durationMs = Number.isFinite(startMs) ? Date.now() - startMs : NaN;
    }
    if (Number.isFinite(durationMs) && durationMs > 0) {
      parts.push(`⏱ ${formatDuration(durationMs)}`);
    }

    const added = Number(cost.total_lines_added);
    const removed = Number(cost.total_lines_removed);
    if (added > 0 || removed > 0) {
      parts.push(`+${added || 0}/-${removed || 0}`);
    }

    const agents = snap?.agents || [];
    const todos = snap?.todos || [];
    if (agents.length > 0) {
      parts.push(`⚡ ${agents.filter((a) => a.completedAt).length}/${agents.length}`);
    }
    if (todos.length > 0) {
      parts.push(`☑ ${todos.filter((t) => t.status === 'completed').length}/${todos.length}`);
    }

    const usage = readUsageCache();
    if (usage && getCacheAgeMs(usage) <= USAGE_FRESH_MS) {
      if (usage.fiveHour != null) parts.push(`5h ${usage.fiveHour}%`);
      if (usage.week != null) parts.push(`wk ${usage.week}%`);
    }

    if (parts.length > 0) process.stdout.write(parts.join(' · ') + '\n');
    process.exit(0);
  }

  main();

} catch {
  // Fail-open: a broken statusline must never surface an error to the user.
  process.exit(0);
}
