import type { CocomoEstimate } from './cocomo';
import type { GitInsights } from './git-stats';
import type { ActivityInsights } from './activity';
import { sparkline } from './activity';

/** Terminal rendering for `hailykit stats` — table mode only (JSON lives in stats.ts). */

export interface LangSummary {
  files: number; ncloc: number; comments: number; blanks: number; complexity: number;
}

export interface Hotspot { file: string; ncloc: number; complexity: number; token_est: number; }

export interface ScanExtras {
  tests: { testFiles: number; sourceFiles: number; testNcloc: number; sourceNcloc: number };
  debt: { todo: number; fixme: number; hack: number; top: Array<{ file: string; total: number }> };
  oversized: Array<{ file: string; ncloc: number }>;
}

export interface ReportData {
  rootLabel: string;
  fileCount: number;
  langMap: Map<string, LangSummary>;
  totals: LangSummary & { files: number };
  hotspots: Hotspot[];
  est: CocomoEstimate;
  extras: ScanExtras;
  git: GitInsights | null;
  activity: ActivityInsights | null;
}

export const COMPLEXITY_WARN = 15;
export const COMPLEXITY_ERROR = 25;
export const FILE_LOC_WARN = 200;

export function printReport(d: ReportData): void {
  const SEP = '━'.repeat(60);
  console.log(`\nhailykit stats — ${d.rootLabel}  (${d.fileCount} files)`);
  console.log(SEP);
  console.log(col('Language', 16) + col('Files', 7) + col('nLOC', 8) + col('Comments', 13) + col('Complexity', 12));

  for (const [name, s] of [...d.langMap.entries()].sort((a, b) => b[1].ncloc - a[1].ncloc)) {
    console.log(
      col(name, 16) +
      col(String(s.files), 7) +
      col(String(s.ncloc), 8) +
      col(s.comments > 0 ? `${s.comments} (${density(s)}%)` : '----', 13) +
      col(s.complexity > 0 ? String(s.complexity) : '-', 12),
    );
  }

  console.log(SEP);
  console.log(
    col('Total', 16) + col(String(d.fileCount), 7) + col(String(d.totals.ncloc), 8) +
    col(`${d.totals.comments} (${density(d.totals)}%)`, 13) + col(String(d.totals.complexity), 12),
  );

  if (d.est.effortMonths > 0) {
    console.log(
      `Estimate (COCOMO organic): ${d.est.effortMonths.toFixed(1)} person-months · ` +
      `${d.est.scheduleMonths.toFixed(1)} months · ${d.est.people.toFixed(1)} devs · ` +
      `~$${Math.round(d.est.cost).toLocaleString('en-US')} (@ $${d.est.salary.toLocaleString('en-US')}/yr, directional)`,
    );
  }
  printScanExtras(d.extras);

  const significant = d.hotspots.filter(h => h.complexity >= COMPLEXITY_WARN);
  if (significant.length > 0) {
    console.log(`\nTop hotspots (complexity ≥${COMPLEXITY_WARN}):`);
    for (const h of significant) {
      const icon = h.complexity >= COMPLEXITY_ERROR ? '✗' : '⚠';
      console.log(`  ${icon}  ${String(h.complexity).padStart(3)}  ${trunc(h.file).padEnd(62)}  (${h.ncloc} loc)`);
    }
  }

  if (d.git) printGitInsights(d.git, d.activity);
  console.log('');
}

function printScanExtras(x: ScanExtras): void {
  const { tests, debt, oversized } = x;
  const totalFiles = tests.testFiles + tests.sourceFiles;
  if (tests.testFiles > 0 && totalFiles > 0) {
    const pct = Math.round((tests.testFiles / totalFiles) * 100);
    const ratio = tests.sourceNcloc > 0 ? (tests.testNcloc / tests.sourceNcloc).toFixed(2) : '—';
    console.log(`Tests:     ${tests.testFiles} test files / ${tests.sourceFiles} source (${pct}%) · test/src nLOC ${ratio}`);
  }
  if (debt.todo + debt.fixme + debt.hack > 0) {
    const top = debt.top[0];
    console.log(`Debt:      ${debt.todo} TODO · ${debt.fixme} FIXME · ${debt.hack} HACK — top: ${trunc(top.file)} (${top.total})`);
  }
  if (oversized.length > 0) {
    console.log(`Oversized: ${oversized.length} files >${FILE_LOC_WARN} loc — largest: ${trunc(oversized[0].file)} (${oversized[0].ncloc} loc)`);
  }
}

function printGitInsights(git: GitInsights, activity: ActivityInsights | null): void {
  console.log(`\nGit insights (churn window: ${git.windowDays}d):`);

  if (git.riskHotspots.length > 0) {
    console.log('  Risk hotspots (churn × complexity):');
    for (const h of git.riskHotspots) {
      const icon = h.complexity >= COMPLEXITY_ERROR ? '✗' : '⚠';
      console.log(`    ${icon}  ${String(h.risk).padStart(5)}  ${trunc(h.file).padEnd(58)}  (${h.churn} commits × cx ${h.complexity})`);
    }
  }

  if (git.busFactor > 0) {
    const ownerStr = git.owners.map(o => `${o.author} ${o.share}%`).join(', ');
    console.log(`  Bus factor: ${git.busFactor}  (top owners: ${ownerStr})`);
  }

  if (git.staleTotal > 0) {
    const oldest = git.stale[0];
    console.log(`  Stale (>${git.staleDays}d): ${git.staleTotal} files — oldest: ${trunc(oldest.file)} (${oldest.last})`);
  }

  if (activity) {
    console.log(`  Activity (12w): ${sparkline(activity.weekly)}  avg ${activity.avgPerWeek} commits/wk`);
    console.log(`  Contributors: ${activity.activeAuthors90} active (90d) / ${activity.totalAuthors} all-time`);
    if (activity.lastRelease) {
      console.log(`  Releases: ~${activity.releasesPerMonth}/month — last: ${activity.lastRelease.tag} (${activity.lastRelease.date})`);
    }
  }
}

function density(s: { ncloc: number; comments: number }): number {
  const total = s.ncloc + s.comments;
  return total > 0 ? Math.round((s.comments / total) * 100) : 0;
}

function trunc(file: string): string {
  return file.length > 60 ? '…' + file.slice(-59) : file;
}

function col(s: string, width: number): string {
  return s.length > width ? s.slice(0, width - 1) + '…' : s.padEnd(width);
}
