#!/usr/bin/env bun
/**
 * Install HailyKit from the local repo source (no GitHub release).
 *
 * Usage:
 *   bun scripts/install-from-source.mjs [provider] [--project] [--no-venv]
 *
 * Builds dist/ via `bun run build`, then runs the same install path as
 * `hailykit install` but using the local kit/ directory directly.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from '../dist/installer/extractor.js';
import { mergeClaudeDir } from '../dist/installer/merger.js';
import { loadModelMapOverrides } from '../dist/installer/converter.js';
import { setupVenv } from '../dist/installer/venv.js';
import { resolveProviders } from '../dist/installer/providers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const KIT_DIR = path.join(REPO_ROOT, 'kit');

function runBuild() {
  console.log('Building with bun...');
  execFileSync('bun', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

function parseArgs(argv) {
  const providerName = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'crush';
  const rest = providerName === argv[0] ? argv.slice(1) : argv;
  return {
    providerName,
    project: rest.includes('--project'),
    noVenv: rest.includes('--no-venv'),
  };
}

async function main() {
  const { providerName, project, noVenv } = parseArgs(process.argv.slice(2));
  const providers = resolveProviders(providerName);

  console.log(`Installing HailyKit from source → ${project ? 'project' : 'global'} [${providers.map(p => p.label).join(', ')}]`);

  runBuild();

  // resolveRoot accepts any directory containing a cli/ folder as the repo root;
  // local source already matches the extracted release layout.
  const root = resolveRoot(REPO_ROOT);
  loadModelMapOverrides(path.join(root, 'kit'));

  for (const provider of providers) {
    const targetDir = project ? provider.projectDir() : provider.globalDir();
    console.log(`\n  [${provider.label}] → ${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });

    if (provider.name === 'claude') {
      mergeClaudeDir(root, targetDir, { isUpgrade: false });

      if (project) {
        const srcMd = path.join(root, 'CLAUDE.md');
        const destMd = path.join(process.cwd(), 'CLAUDE.md');
        if (fs.existsSync(srcMd) && !fs.existsSync(destMd)) {
          fs.copyFileSync(srcMd, destMd);
          console.log('    Created CLAUDE.md');
        }
      }

      if (!noVenv) setupVenv(targetDir);
    } else {
      const count = provider.installSkills(KIT_DIR, targetDir);
      const skillFmt = provider.name === 'gemini' ? 'hl-*.toml commands'
        : provider.name === 'codex' ? 'SKILL.md files'
        : 'hl-*.md commands';
      console.log(`    Installed ${count} skills as ${skillFmt}`);

      provider.installRules(KIT_DIR, targetDir);
      console.log('    Installed rules');

      if (provider.installAgents) {
        provider.installAgents(KIT_DIR, targetDir);
        console.log('    Installed agents');
      }

      if (provider.hooksSupported()) {
        provider.installHooks(KIT_DIR, targetDir);
        console.log('    Installed hooks');
      }

      const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
      provider.writeVersion(targetDir, pkg.version);
    }

    console.log(`    ✓ ${provider.label} ready`);
  }

  console.log('\n✓ HailyKit installed from source');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
