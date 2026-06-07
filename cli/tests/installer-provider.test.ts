import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GeminiProvider } from '../installer/providers/gemini';
import { CodexProvider } from '../installer/providers/codex';
import { CrushProvider } from '../installer/providers/crush';
import { KimiProvider } from '../installer/providers/kimi';
import { OpenCodeProvider } from '../installer/providers/opencode';
import { toCrushMd, toKimiMd } from '../installer/converter';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'haily-prov-'));
}

test('GeminiProvider.installSkills converts SKILL.md to an hl-*.toml command', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  const skillDir = path.join(claude, 'skills', 'hl-plan');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: hl:plan\ndescription: Plan stuff\n---\n\nDo planning.',
  );

  const target = path.join(root, 'out');
  const count = new GeminiProvider().installSkills(claude, target);
  assert.equal(count, 1);

  const toml = fs.readFileSync(path.join(target, 'commands', 'hl-plan.toml'), 'utf8');
  assert.match(toml, /description = "Plan stuff"/);
  assert.match(toml, /Do planning\./);
});

test('GeminiProvider.installSkills installs TOML command AND native SKILL.md', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  const skillDir = path.join(claude, 'skills', 'hl-plan');
  fs.mkdirSync(skillDir, { recursive: true });
  const md = '---\nname: hl:plan\ndescription: Plan stuff\n---\n\nDo planning.';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), md);

  const target = path.join(root, 'out');
  const count = new GeminiProvider().installSkills(claude, target);

  assert.equal(count, 1);
  assert.ok(fs.existsSync(path.join(target, 'commands', 'hl-plan.toml')));
  const native = fs.readFileSync(path.join(target, 'skills', 'hl-plan', 'SKILL.md'), 'utf8');
  assert.equal(native, md);
});

// ---------------------------------------------------------------------------
// CodexProvider
// ---------------------------------------------------------------------------

test('CodexProvider.agentRef: single agent → NL invocation', () => {
  const p = new CodexProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).agentRef('agent', ['haily-researcher']),
    'Use the haily-researcher agent for this step.',
  );
});

test('CodexProvider.agentRef: parallel agents → NL sequence', () => {
  const p = new CodexProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).agentRef('agents', ['haily-researcher', 'haily-tester']),
    'Use the haily-researcher agent, then the haily-tester agent for this step.',
  );
});

test('CodexProvider.agentRef: agent-result → NL bridge', () => {
  const p = new CodexProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).agentRef('agent-result', ['haily-researcher']),
    'Using the haily-researcher agent output above:',
  );
});

test('CodexProvider.skillRef still returns $prefix-name', () => {
  const p = new CodexProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).skillRef('hc', 'cook'),
    '$hc-cook',
  );
});

test('CodexProvider.installAgents generates TOML from agent MD files', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(kit, 'agents', 'haily-researcher.md'),
    '---\nname: haily-researcher\ndescription: Research things\nmodel: medium\n---\n\nDo research.',
  );

  const target = path.join(root, 'out');
  fs.mkdirSync(target, { recursive: true });
  new CodexProvider().installAgents!(kit, target);

  const toml = fs.readFileSync(path.join(target, 'agents', 'haily-researcher.toml'), 'utf8');
  assert.match(toml, /name = "haily-researcher"/);
  assert.match(toml, /description = "Research things"/);
  assert.match(toml, /developer_instructions/);
  assert.match(toml, /Do research\./);
});

// ---------------------------------------------------------------------------
// GeminiProvider — installRules + installAgents
// ---------------------------------------------------------------------------

test('GeminiProvider.installRules copies rule files and writes GEMINI.md managed block', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'rules', 'haily-coding.md'), 'Coding rules');
  fs.writeFileSync(path.join(claude, 'rules', 'hailykit.md'), 'Brand rules');

  const target = path.join(root, 'out');
  new GeminiProvider().installRules(claude, target);

  assert.ok(fs.existsSync(path.join(target, 'haily-coding.md')));
  assert.ok(fs.existsSync(path.join(target, 'hailykit.md')));
  const gemini = fs.readFileSync(path.join(target, 'GEMINI.md'), 'utf8');
  assert.match(gemini, /<!-- hailykit-managed-start -->/);
  assert.match(gemini, /@haily-coding\.md/);
  assert.match(gemini, /@hailykit\.md/);
  assert.match(gemini, /<!-- hailykit-managed-end -->/);
});

test('GeminiProvider.installRules upserts GEMINI.md preserving content outside the block', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'rules', 'haily-coding.md'), 'Coding rules');

  const target = path.join(root, 'out');
  fs.mkdirSync(target, { recursive: true });
  const pre = 'User notes top\n<!-- hailykit-managed-start -->\n@stale.md\n<!-- hailykit-managed-end -->\nUser notes bottom\n';
  fs.writeFileSync(path.join(target, 'GEMINI.md'), pre);

  new GeminiProvider().installRules(claude, target);

  const gemini = fs.readFileSync(path.join(target, 'GEMINI.md'), 'utf8');
  assert.match(gemini, /User notes top/);
  assert.match(gemini, /User notes bottom/);
  assert.match(gemini, /@haily-coding\.md/);
  assert.doesNotMatch(gemini, /@stale\.md/);
  assert.equal(gemini.match(/hailykit-managed-start/g)?.length, 1);
});

test('GeminiProvider.installAgents copies agent .md files to agents/', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'agents', 'haily-researcher.md'), 'Research agent');

  const target = path.join(root, 'out');
  new GeminiProvider().installAgents!(claude, target);

  const copied = fs.readFileSync(path.join(target, 'agents', 'haily-researcher.md'), 'utf8');
  assert.equal(copied, 'Research agent');
});

test('GeminiProvider.installAgents no-ops when agents dir is absent', () => {
  const root = tmp();
  const claude = path.join(root, 'claude');
  fs.mkdirSync(claude, { recursive: true });
  const target = path.join(root, 'out');
  assert.doesNotThrow(() => new GeminiProvider().installAgents!(claude, target));
  assert.equal(fs.existsSync(path.join(target, 'agents')), false);
});

// ---------------------------------------------------------------------------
// CrushProvider
// ---------------------------------------------------------------------------

test('toCrushMd produces Agent Skills frontmatter with user-invocable: true', () => {
  const md = toCrushMd('hc-plan', 'Plan things', 'Do planning.');
  assert.match(md, /^---\n/);
  assert.match(md, /name: hc-plan/);
  assert.match(md, /description: "Plan things"/);
  assert.match(md, /user-invocable: true/);
  assert.match(md, /Do planning\./);
});

test('CrushProvider.installSkills converts SKILL.md to Agent Skills format', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  const skillDir = path.join(kit, 'skills', 'hc-plan');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: hc-plan\ndescription: Plan stuff\n---\n\nDo planning.',
  );

  const target = path.join(root, 'out');
  const count = new CrushProvider().installSkills(kit, target);
  assert.equal(count, 1);

  const md = fs.readFileSync(path.join(target, 'skills', 'hc-plan.md'), 'utf8');
  assert.match(md, /name: hc-plan/);
  assert.match(md, /user-invocable: true/);
  assert.match(md, /Do planning\./);
});

test('CrushProvider.installRules writes CRUSH.md context file', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'rules', 'coding.md'), 'Coding rules');
  fs.writeFileSync(path.join(kit, 'rules', 'workflow.md'), 'Workflow rules');

  const target = path.join(root, 'out');
  new CrushProvider().installRules(kit, target);

  const crush = fs.readFileSync(path.join(target, 'CRUSH.md'), 'utf8');
  assert.match(crush, /Coding rules/);
  assert.match(crush, /Workflow rules/);
});

test('CrushProvider.installAgents strips model tier and copies to agents/', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(kit, 'agents', 'haily-researcher.md'),
    '---\nname: haily-researcher\nmodel: medium\n---\n\nDo research.',
  );

  const target = path.join(root, 'out');
  new CrushProvider().installAgents!(kit, target);

  const content = fs.readFileSync(path.join(target, 'agents', 'haily-researcher.md'), 'utf8');
  assert.ok(!content.includes('model:'), 'model: line must be stripped for crush');
  assert.match(content, /Do research\./);
});

test('CrushProvider.skillRef uses /prefix-name slash syntax', () => {
  const p = new CrushProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).skillRef('hc', 'cook'),
    '/hc-cook',
  );
});

// ---------------------------------------------------------------------------
// OpenCodeProvider — globalDir path fixes
// ---------------------------------------------------------------------------

test('OpenCodeProvider.globalDir returns XDG config path on Linux', () => {
  if (process.platform !== 'linux') return;
  const dir = new OpenCodeProvider().globalDir();
  assert.ok(dir.includes('opencode'), `expected opencode in path: ${dir}`);
  assert.ok(!dir.includes('Library'), 'should not use macOS Library path on Linux');
});

test('OpenCodeProvider strips model tier for agents', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(kit, 'agents', 'haily-planner.md'),
    '---\nname: haily-planner\nmodel: thinking\n---\n\nPlan stuff.',
  );

  const target = path.join(root, 'out');
  new OpenCodeProvider().installAgents!(kit, target);

  const content = fs.readFileSync(path.join(target, 'agents', 'haily-planner.md'), 'utf8');
  assert.ok(!content.includes('model:'), 'model: tier must be stripped for opencode');
  assert.match(content, /Plan stuff\./);
});

// ---------------------------------------------------------------------------
// KimiProvider
// ---------------------------------------------------------------------------

test('toKimiMd produces Agent Skills frontmatter without user-invocable', () => {
  const md = toKimiMd('hc-plan', 'Plan things', 'Do planning.');
  assert.match(md, /name: hc-plan/);
  assert.match(md, /description: "Plan things"/);
  assert.ok(!md.includes('user-invocable'), 'Kimi does not need user-invocable field');
  assert.match(md, /Do planning\./);
});

test('KimiProvider.installSkills converts SKILL.md to Agent Skills format', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  const skillDir = path.join(kit, 'skills', 'hc-plan');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: hc-plan\ndescription: Plan stuff\n---\n\nDo planning.',
  );

  const target = path.join(root, 'out');
  const count = new KimiProvider().installSkills(kit, target);
  assert.equal(count, 1);

  const md = fs.readFileSync(path.join(target, 'skills', 'hc-plan.md'), 'utf8');
  assert.match(md, /name: hc-plan/);
  assert.match(md, /Do planning\./);
});

test('KimiProvider.installRules writes AGENTS.md context file', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'rules', 'coding.md'), 'Coding rules');

  const target = path.join(root, 'out');
  new KimiProvider().installRules(kit, target);

  const agents = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Coding rules/);
});

test('KimiProvider.installAgents strips model tier and copies to agents/', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(kit, 'agents', 'haily-researcher.md'),
    '---\nname: haily-researcher\nmodel: fast\n---\n\nDo research.',
  );

  const target = path.join(root, 'out');
  new KimiProvider().installAgents!(kit, target);

  const content = fs.readFileSync(path.join(target, 'agents', 'haily-researcher.md'), 'utf8');
  assert.ok(!content.includes('model:'), 'model: line must be stripped for kimi');
  assert.match(content, /Do research\./);
});

test('KimiProvider.installHooks writes TOML [[hooks]] block to config.toml', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'hooks', 'test.cjs'), '// hook');

  const settings = {
    hooks: {
      PostToolUse: [{
        hooks: [{
          type: 'command',
          command: 'node .claude/hooks/test.cjs',
          timeout: 15000,
        }],
      }],
    },
  };
  fs.writeFileSync(path.join(kit, 'settings.json'), JSON.stringify(settings));

  const target = path.join(root, 'out');
  new KimiProvider().installHooks(kit, target);

  const toml = fs.readFileSync(path.join(target, 'config.toml'), 'utf8');
  assert.match(toml, /\[\[hooks\]\]/);
  assert.match(toml, /event = "PostToolUse"/);
  assert.match(toml, /timeout = 15/);
  assert.match(toml, /# hailykit-managed-start/);
  assert.match(toml, /# hailykit-managed-end/);
});

test('KimiProvider.installHooks upserts managed block in existing config.toml', () => {
  const root = tmp();
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'hooks', 'test.cjs'), '// hook');

  const settings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node .claude/hooks/test.cjs', timeout: 5000 }] }],
    },
  };
  fs.writeFileSync(path.join(kit, 'settings.json'), JSON.stringify(settings));

  const target = path.join(root, 'out');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'config.toml'), '[model]\nname = "kimi"\n# hailykit-managed-start\nold\n# hailykit-managed-end\n');

  new KimiProvider().installHooks(kit, target);

  const toml = fs.readFileSync(path.join(target, 'config.toml'), 'utf8');
  assert.match(toml, /\[model\]/);
  assert.match(toml, /event = "Stop"/);
  assert.ok(!toml.includes('\nold\n'), 'stale block must be replaced');
  assert.equal((toml.match(/hailykit-managed-start/g) ?? []).length, 1, 'only one managed block');
});

test('KimiProvider.skillRef uses /skill:prefix-name format', () => {
  const p = new KimiProvider();
  assert.equal(
    (p as unknown as Record<string, Function>).skillRef('hc', 'cook'),
    '/skill:hc-cook',
  );
});
