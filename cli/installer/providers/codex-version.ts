import { execFileSync } from 'node:child_process';

/**
 * Codex CLI version detection + a warn-only hooks-support check.
 *
 * Philosophy (decided 2026-06-21): the Codex provider always installs FULL,
 * unconditionally — it never gates, skips, or aborts on version. The only job
 * here is to probe `codex --version` and emit an informational WARNING when the
 * binary is missing or older than the recommended baseline. Upgrading Codex is
 * trivial; a reminder is enough. No per-version capability table.
 *
 * Zero-dep: hand-rolled version parse/compare (no `semver`), `node:` built-ins only.
 */

/** Recommended minimum Codex version for full hooks support (public hooks-docs baseline). */
export const RECOMMENDED_CODEX_VERSION = '0.130.0';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease tag (e.g. "alpha.3"); empty for a stable release. */
  prerelease: string;
}

/**
 * Parse a Codex version string into comparable parts.
 * Tolerates the forms Codex actually emits: `codex 0.130.0`, `v0.130.0`,
 * `0.124.0-alpha.3`, and a missing patch (`0.130` → patch 0).
 *
 * @param raw - Raw version text (may include a `codex ` / `v` prefix and a build suffix).
 * @returns Parsed parts, or null when no `major.minor` could be extracted.
 */
export function parseVersion(raw: string): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/(\d+)\.(\d+)(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] !== undefined ? Number(m[3]) : 0,
    prerelease: m[4] ?? '',
  };
}

/**
 * Compare two version strings. Returns -1 (a<b), 0 (a==b), or 1 (a>b).
 * A version WITH a prerelease tag sorts BELOW the same numbers without one
 * (`0.130.0-alpha` < `0.130.0`), matching semver precedence. Unparseable input
 * sorts lowest so callers treat "unknown" as "older".
 *
 * @param a - First version string.
 * @param b - Second version string.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  // Equal numbers: a prerelease is lower than a stable release.
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/**
 * Probe the installed Codex CLI version via `codex --version`.
 * Tries `codex.exe` then `codex` on Windows; `codex` on POSIX. Never throws —
 * returns the raw version line, or null when the binary is missing/unresponsive.
 */
export function detectCodexVersion(): string | null {
  const candidates = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex'];
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8' });
      const line = out.trim();
      if (line) return line;
    } catch { /* ENOENT or non-zero exit — try next candidate */ }
  }
  return null;
}

/**
 * Warn (never gate) when Codex is missing or older than the recommended baseline.
 * Install always proceeds full afterwards; this only nudges the user to upgrade.
 *
 * @param detect - Injectable probe (defaults to detectCodexVersion); eases testing.
 */
export function warnIfCodexHooksUnsupported(detect: () => string | null = detectCodexVersion): void {
  const version = detect();
  if (version === null) {
    console.warn(
      `    Hooks: could not detect a Codex CLI on PATH — installing hooks anyway. ` +
      `If they don't fire, install/upgrade Codex (≥ ${RECOMMENDED_CODEX_VERSION}).`,
    );
    return;
  }
  if (compareVersions(version, RECOMMENDED_CODEX_VERSION) < 0) {
    console.warn(
      `    Hooks: detected Codex ${version}, older than the recommended ${RECOMMENDED_CODEX_VERSION}. ` +
      `Hooks are installed but some may not fire — upgrade Codex for full support.`,
    );
  }
}
