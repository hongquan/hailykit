import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cocomo, DEFAULT_SALARY } from '../commands/stats/cocomo';
import { collectGitData, deriveGitInsights, isGitRepo } from '../commands/stats/git-stats';
import { collectReleases, deriveActivity, sparkline } from '../commands/stats/activity';
import { scan } from '../commands/stats/scanner';
import type { FileStats } from '../commands/stats/scanner';

// ── COCOMO ──────────────────────────────────────────────────────────────────

test('cocomo: zero ncloc yields zero estimate', () => {
  const est = cocomo(0);
  assert.equal(est.effortMonths, 0);
  assert.equal(est.scheduleMonths, 0);
  assert.equal(est.people, 0);
  assert.equal(est.cost, 0);
});

test('cocomo: 10 KLOC matches the organic-mode formula', () => {
  const est = cocomo(10_000);
  // 2.4 × 10^1.05 ≈ 26.93 PM; 2.5 × 26.93^0.38 ≈ 8.74 months
  assert.ok(Math.abs(est.effortMonths - 26.93) < 0.1, `effort ${est.effortMonths}`);
  assert.ok(Math.abs(est.scheduleMonths - 8.74) < 0.1, `schedule ${est.scheduleMonths}`);
  assert.ok(Math.abs(est.people - est.effortMonths / est.scheduleMonths) < 1e-9);
  assert.equal(est.salary, DEFAULT_SALARY);
});

test('cocomo: cost scales linearly with salary', () => {
  const a = cocomo(5000, 50_000);
  const b = cocomo(5000, 100_000);
  assert.ok(Math.abs(b.cost - a.cost * 2) < 1e-6);
});

// ── scanner: markers + test classification ─────────────────────────────────

test('scanner: counts debt markers and classifies test files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-stats-scan-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.ts'),
      '// TODO: refactor\nconst a = 1; // FIXME later\n/* HACK around bug */\nconst todoList = [];\n');
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'tests', 'app.test.ts'), 'const t = 1;\n');

    const { files } = scan(dir);
    const app = files.find(f => f.file === 'app.ts');
    const spec = files.find(f => f.file === 'tests/app.test.ts');
    assert.ok(app && spec, 'expected both files scanned');
    assert.equal(app.todo, 1);
    assert.equal(app.fixme, 1);
    assert.equal(app.hack, 1);   // \bHACK\b matches; "todoList" must not count
    assert.equal(app.isTest, false);
    assert.equal(spec.isTest, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── activity: velocity, contributors, sparkline ─────────────────────────────

function recentIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

test('activity: weekly buckets, active authors, release cadence', () => {
  const collect = {
    perFile: new Map(),
    authorLast: new Map([['Alice', recentIso(3)], ['Bob', recentIso(200)]]),
    recentDaily: new Map([[recentIso(1), 2], [recentIso(8), 3], [recentIso(83), 1]]),
  };
  const releases = [
    { tag: 'v2.0.0', date: recentIso(5) },
    { tag: 'v1.9.0', date: recentIso(40) },
    { tag: 'v1.0.0', date: recentIso(400) }, // outside the 1-year cadence window
  ];
  const a = deriveActivity(collect, releases);

  assert.equal(a.weekly.length, 12);
  assert.equal(a.weekly[11], 2);  // 1 day ago → newest bucket
  assert.equal(a.weekly[10], 3);  // 8 days ago → previous week
  assert.equal(a.weekly[0], 1);   // 83 days ago → oldest bucket
  assert.equal(a.avgPerWeek, 0.5); // 6 commits / 12 weeks
  assert.equal(a.activeAuthors90, 1);
  assert.equal(a.totalAuthors, 2);
  assert.deepEqual(a.lastRelease, { tag: 'v2.0.0', date: recentIso(5) });
  assert.equal(a.releasesPerMonth, 0.2); // 2 releases in last year / 12
});

test('sparkline: scales to max and handles all-zero weeks', () => {
  assert.equal(sparkline([0, 0, 0]), '▁▁▁');
  const line = sparkline([0, 4, 8]);
  assert.equal(line.length, 3);
  assert.equal(line[2], '█');
  assert.equal(line[0], '▁');
});

// ── git-stats ───────────────────────────────────────────────────────────────

function hasGit(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function git(cwd: string, args: string[], dateIso?: string): void {
  const env = dateIso
    ? { ...process.env, GIT_AUTHOR_DATE: `${dateIso}T12:00:00`, GIT_COMMITTER_DATE: `${dateIso}T12:00:00` }
    : process.env;
  execFileSync('git', args, { cwd, stdio: 'ignore', env });
}

function commitAs(cwd: string, author: string, msg: string, dateIso: string): void {
  git(cwd, ['-c', `user.name=${author}`, '-c', `user.email=${author}@test.local`, 'commit', '-m', msg], dateIso);
}

function fileStats(file: string, ncloc: number, complexity: number): FileStats {
  return {
    file, language: 'TypeScript', lines: ncloc, ncloc, comments: 0, blanks: 0,
    complexity, bytes: ncloc * 30, todo: 0, fixme: 0, hack: 0, isTest: false,
  };
}

test('git-stats: churn, age, ownership, bus factor, releases from a real repo', { skip: !hasGit() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-stats-git-'));
  try {
    git(dir, ['init', '-q']);

    // old.ts: single ancient commit by Alice → stale, no churn
    fs.writeFileSync(path.join(dir, 'old.ts'), 'export const a = 1;\n');
    git(dir, ['add', '.']);
    commitAs(dir, 'Alice', 'old file', '2020-01-02');

    // hot.ts: 3 recent commits (2 Alice, 1 Bob) → churn 3, owned by Alice
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dir, 'hot.ts'), `export const b = ${i};\n`);
      git(dir, ['add', '.']);
      commitAs(dir, i === 1 ? 'Bob' : 'Alice', `hot change ${i}`, recentIso(10 - i));
    }
    git(dir, ['tag', 'v1.0.0']);

    assert.equal(isGitRepo(dir), true);
    const collect = collectGitData(dir, 180);
    assert.ok(collect, 'collectGitData returned null');

    const hot = collect.perFile.get('hot.ts');
    const old = collect.perFile.get('old.ts');
    assert.ok(hot && old, 'expected both files in git data');
    assert.equal(hot.churn, 3);
    assert.equal(old.churn, 0);
    assert.equal(old.last, '2020-01-02');
    assert.equal(hot.authors.get('Alice'), 2);
    assert.equal(hot.authors.get('Bob'), 1);

    // Activity collected in the same pass
    assert.equal(collect.authorLast.size, 2);
    assert.equal(collect.authorLast.get('Alice'), recentIso(8)); // newest Alice commit (i=2)
    const releases = collectReleases(dir);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].tag, 'v1.0.0');

    const files = [fileStats('hot.ts', 100, 20), fileStats('old.ts', 400, 2)];
    const insights = deriveGitInsights(collect.perFile, files, { windowDays: 180, staleDays: 365, top: 5 });

    assert.equal(insights.riskHotspots.length, 1); // old.ts has churn 0 → no risk entry
    assert.deepEqual(insights.riskHotspots[0], { file: 'hot.ts', risk: 60, churn: 3, complexity: 20 });

    // Alice owns both files (500 nLOC = 100%) → bus factor 1
    assert.equal(insights.busFactor, 1);
    assert.equal(insights.owners[0].author, 'Alice');
    assert.equal(insights.owners[0].share, 100);

    assert.equal(insights.staleTotal, 1);
    assert.deepEqual(insights.stale[0], { file: 'old.ts', last: '2020-01-02' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('git-stats: isGitRepo false outside a repo', { skip: !hasGit() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-stats-plain-'));
  try {
    assert.equal(isGitRepo(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deriveGitInsights: empty git data yields empty insights', () => {
  const insights = deriveGitInsights(new Map(), [fileStats('a.ts', 10, 5)], { windowDays: 180, staleDays: 365, top: 5 });
  assert.equal(insights.busFactor, 0);
  assert.equal(insights.riskHotspots.length, 0);
  assert.equal(insights.staleTotal, 0);
  assert.equal(insights.owners.length, 0);
});
