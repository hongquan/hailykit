import { numberOption, stringOption } from '../arg-parser';
import { cmdStats, DEFAULT_SALARY } from './stats';
import { cmdGitInsights } from './git-insights';

/**
 * Registry of native analysis commands (stats, and the Tier 1–3 tools added by
 * later phases). `bin.ts` derives its value-flag set, help listing, and dispatch
 * by reducing over this array — so a new command adds ONE entry here plus its
 * own command module, and never edits a shared `VALUE_FLAGS` line (avoids the
 * merge-conflict surface the plan's red-team flagged).
 */

export interface CommandContext {
  /** Positionals after the command name. */
  positionals: string[];
  /** Parsed flags (value-flags hold strings; bare flags are `true`). */
  options: Record<string, string | boolean>;
}

export interface CommandSpec {
  name: string;
  /** One-line summary for the top-level help listing. */
  summary: string;
  /** Full help text for `hailykit <name> --help`. */
  help: string;
  /** Long flags that consume the next token as their value. */
  valueFlags: string[];
  run: (ctx: CommandContext) => Promise<number> | number;
}

const STATS_HELP = `
hailykit stats [path] — Show code statistics for a directory

Arguments:
  path                 Directory to scan (default: current directory)

Options:
  --json               Emit compact JSON schema (machine-readable)
  --lang <list>        Comma-separated language filter (e.g. ts,js)
  --top <n>            Number of complexity hotspots to show (default: 10)
  --exclude <pattern>  Additional path substring to exclude
  --since <days>       Git churn window in days (default: 180)
  --salary <n>         Avg annual salary for COCOMO estimate (default: 56286)
  --no-git             Skip git-history insights (churn, risk, bus factor)
`.trim();

const statsCommand: CommandSpec = {
  name: 'stats',
  summary: 'Show code statistics for a directory',
  help: STATS_HELP,
  valueFlags: ['lang', 'top', 'exclude', 'since', 'salary'],
  run: ({ positionals, options }) => cmdStats({
    path: positionals[0] || '.',
    json: options.json === true,
    langs: stringOption(options, 'lang', '').split(',').filter(Boolean),
    top: numberOption(options, 'top') ?? 10,
    exclude: stringOption(options, 'exclude', '').split(',').filter(Boolean),
    git: options['no-git'] !== true,
    since: numberOption(options, 'since') ?? 180,
    salary: numberOption(options, 'salary') ?? DEFAULT_SALARY,
  }),
};

const GIT_INSIGHTS_HELP = `
hailykit git-insights [path] — Churn, bus factor, ownership, velocity, change-impact

Arguments:
  path                 Repo (or subdir) to analyze (default: current directory)

Options:
  --json               Emit the JSON envelope (machine-readable)
  --since <days>       Churn window in days (default: 180)
  --top <n>            Number of risk hotspots to show (default: 10)
  --ref <base>         Add change-impact for <base>..HEAD (flags high-risk files)

Notes:
  Always exits 0; outside a git repo, data.git is null with a reason.
`.trim();

const gitInsightsCommand: CommandSpec = {
  name: 'git-insights',
  summary: 'Churn, bus factor, velocity, and change-impact (JSON)',
  help: GIT_INSIGHTS_HELP,
  valueFlags: ['since', 'top', 'ref'],
  run: ({ positionals, options }) => cmdGitInsights({
    path: positionals[0] || '.',
    json: options.json === true,
    since: numberOption(options, 'since') ?? 180,
    top: numberOption(options, 'top') ?? 10,
    ref: stringOption(options, 'ref', '') || undefined,
  }),
};

export const COMMANDS: CommandSpec[] = [
  statsCommand,
  gitInsightsCommand,
];

/** Look up a registered command by name. */
export function findCommand(name: string | undefined): CommandSpec | undefined {
  return COMMANDS.find(c => c.name === name);
}

/** All value-flags declared across registered commands. */
export function registryValueFlags(): string[] {
  return COMMANDS.flatMap(c => c.valueFlags);
}
