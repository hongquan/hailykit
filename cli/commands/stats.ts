import fs from 'node:fs';
import path from 'node:path';
import { scan } from './stats/scanner';
import type { FileStats } from './stats/scanner';
import { cocomo, DEFAULT_SALARY } from './stats/cocomo';
import { collectGitData, deriveGitInsights, isGitRepo } from './stats/git-stats';
import type { GitInsights } from './stats/git-stats';
import { collectReleases, deriveActivity } from './stats/activity';
import type { ActivityInsights } from './stats/activity';
import { printReport, COMPLEXITY_WARN, COMPLEXITY_ERROR, FILE_LOC_WARN } from './stats/report';
import type { LangSummary, ScanExtras } from './stats/report';

export interface StatsOptions {
  path: string;
  json: boolean;
  langs: string[];
  top: number;
  exclude: string[];
  /** Include git-history insights (churn, risk, ownership). Default true; `--no-git` disables. */
  git: boolean;
  /** Churn window in days (`--since`). */
  since: number;
  /** Average annual salary for the COCOMO estimate (`--salary`). */
  salary: number;
}

const TOKEN_RATIO = 18;
const STALE_DAYS = 365;
const RISK_TOP = 5;

export async function cmdStats(opts: StatsOptions): Promise<number> {
  const root = path.resolve(opts.path);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`✗ Not a directory: ${opts.path}`);
    return 1;
  }

  const result = scan(root, { langs: opts.langs, exclude: opts.exclude });
  if (result.files.length === 0) {
    console.log('No files found.');
    return 0;
  }

  const langMap = aggregate(result.files);
  const totals = sumTotals(langMap);
  const hotspots = buildHotspots(result.files, opts.top);
  const extras = buildExtras(result.files);
  const est = cocomo(totals.ncloc, opts.salary);

  let git: GitInsights | null = null;
  let activity: ActivityInsights | null = null;
  if (opts.git && isGitRepo(root)) {
    const collect = collectGitData(root, opts.since);
    if (collect && collect.perFile.size > 0) {
      git = deriveGitInsights(collect.perFile, result.files, {
        windowDays: opts.since, staleDays: STALE_DAYS, top: RISK_TOP,
      });
      activity = deriveActivity(collect, collectReleases(root));
    }
  }

  if (opts.json) {
    printJson(opts, result.files.length, langMap, totals, hotspots, extras, est, git, activity);
    return 0;
  }

  printReport({
    rootLabel: opts.path, fileCount: result.files.length,
    langMap, totals, hotspots, est, extras, git, activity,
  });
  return 0;
}

function printJson(
  opts: StatsOptions, fileCount: number,
  langMap: Map<string, LangSummary>, totals: LangSummary & { files: number },
  hotspots: ReturnType<typeof buildHotspots>, extras: ScanExtras,
  est: ReturnType<typeof cocomo>, git: GitInsights | null, activity: ActivityInsights | null,
): void {
  const langObj: Record<string, { files: number; ncloc: number; comments: number }> = {};
  for (const [name, s] of [...langMap.entries()].sort((a, b) => b[1].ncloc - a[1].ncloc)) {
    langObj[name] = { files: s.files, ncloc: s.ncloc, comments: s.comments };
  }
  const { tests, debt, oversized } = extras;
  console.log(JSON.stringify({
    v: 2,
    root: opts.path,
    summary: {
      files: fileCount,
      ncloc: totals.ncloc, comments: totals.comments, blanks: totals.blanks,
      complexity: totals.complexity,
      languages: langObj,
      token_est: totals.ncloc * TOKEN_RATIO,
    },
    tests: {
      test_files: tests.testFiles, source_files: tests.sourceFiles,
      test_ncloc: tests.testNcloc,
      test_ncloc_ratio: tests.sourceNcloc > 0 ? Math.round((tests.testNcloc / tests.sourceNcloc) * 100) / 100 : 0,
    },
    debt_markers: { todo: debt.todo, fixme: debt.fixme, hack: debt.hack, top: debt.top },
    oversized: { threshold: FILE_LOC_WARN, count: oversized.length, top: oversized.slice(0, 3) },
    cocomo: {
      effort_months: round1(est.effortMonths),
      schedule_months: round1(est.scheduleMonths),
      people: round1(est.people),
      cost_usd: Math.round(est.cost),
      salary_usd: est.salary,
    },
    git: git && {
      window_days: git.windowDays,
      bus_factor: git.busFactor,
      owners: git.owners,
      risk_hotspots: git.riskHotspots,
      stale_days: git.staleDays,
      stale_total: git.staleTotal,
      stale: git.stale,
      activity: activity && {
        weekly_commits: activity.weekly,
        avg_per_week: activity.avgPerWeek,
        active_authors_90d: activity.activeAuthors90,
        total_authors: activity.totalAuthors,
        last_release: activity.lastRelease,
        releases_per_month: activity.releasesPerMonth,
      },
    },
    hotspots,
    thresholds: { complexity_warn: COMPLEXITY_WARN, complexity_error: COMPLEXITY_ERROR, file_loc_warn: FILE_LOC_WARN },
  }, null, 2));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function aggregate(files: FileStats[]): Map<string, LangSummary> {
  const m = new Map<string, LangSummary>();
  for (const f of files) {
    let s = m.get(f.language);
    if (!s) { s = { files: 0, ncloc: 0, comments: 0, blanks: 0, complexity: 0 }; m.set(f.language, s); }
    s.files++; s.ncloc += f.ncloc; s.comments += f.comments;
    s.blanks += f.blanks; s.complexity += f.complexity;
  }
  return m;
}

function sumTotals(m: Map<string, LangSummary>): LangSummary & { files: number } {
  let files = 0, ncloc = 0, comments = 0, blanks = 0, complexity = 0;
  for (const s of m.values()) {
    files += s.files; ncloc += s.ncloc; comments += s.comments;
    blanks += s.blanks; complexity += s.complexity;
  }
  return { files, ncloc, comments, blanks, complexity };
}

function buildHotspots(files: FileStats[], top: number) {
  return [...files]
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, top)
    .map(f => ({ file: f.file, ncloc: f.ncloc, complexity: f.complexity, token_est: f.ncloc * TOKEN_RATIO }));
}

function buildExtras(files: FileStats[]): ScanExtras {
  let testFiles = 0, sourceFiles = 0, testNcloc = 0, sourceNcloc = 0;
  let todo = 0, fixme = 0, hack = 0;
  const markerFiles: Array<{ file: string; total: number }> = [];

  for (const f of files) {
    if (f.isTest) { testFiles++; testNcloc += f.ncloc; }
    else { sourceFiles++; sourceNcloc += f.ncloc; }
    todo += f.todo; fixme += f.fixme; hack += f.hack;
    const total = f.todo + f.fixme + f.hack;
    if (total > 0) markerFiles.push({ file: f.file, total });
  }
  markerFiles.sort((a, b) => b.total - a.total).splice(3);

  const oversized = files
    .filter(f => f.ncloc > FILE_LOC_WARN)
    .sort((a, b) => b.ncloc - a.ncloc)
    .map(f => ({ file: f.file, ncloc: f.ncloc }));

  return {
    tests: { testFiles, sourceFiles, testNcloc, sourceNcloc },
    debt: { todo, fixme, hack, top: markerFiles },
    oversized,
  };
}

export { DEFAULT_SALARY };
