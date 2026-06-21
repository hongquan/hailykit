import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { BaseProvider, type ConvertedSkill } from './base.js';
import { toKimiMd, resolveSkillRefs, resolveAgentRefs, resolveModel, resolveModelRefs } from '../converter.js';

// Maps Claude Code event names to Kimi Code hook events.
const CLAUDE_TO_KIMI: Record<string, string> = {
  PreToolUse:       'PreToolUse',
  PostToolUse:      'PostToolUse',
  UserPromptSubmit: 'UserPromptSubmit',
  Stop:             'Stop',
};

/**
 * Kimi Code provider (https://kimi.com/code — Moonshot AI).
 * Skills  → ~/.kimi/skills/hc-<name>.md  (Agent Skills open standard)
 * Rules   → ~/.kimi/AGENTS.md
 * Agents  → ~/.kimi/agents/<name>.md  (model tier stripped; user configures at runtime)
 * Hooks   → ~/.kimi/config.toml  ([[hooks]] TOML entries; hooks are Beta as of research date)
 * Model   → user-configured at runtime; model: tier line is stripped
 *
 * Override global dir via $KIMI_SHARE_DIR env var.
 *
 * Spec: unknown, hooks Beta — researched 2026-06-08
 * Docs: https://moonshotai.github.io/kimi-cli/en/customization/skills.html
 *       https://www.kimi-cli.com/en/customization/hooks.html
 */
export class KimiProvider extends BaseProvider {
  get name(): string { return 'kimi'; }
  get label(): string { return 'Kimi Code'; }

  globalDir(): string {
    return process.env['KIMI_SHARE_DIR'] ?? path.join(os.homedir(), '.kimi');
  }

  protected _projectDirName(): string { return '.kimi'; }
  commandsSubDir(): string { return 'skills'; }
  hooksSupported(): boolean { return true; }

  convertSkill(content: string, internalName: string): ConvertedSkill {
    const { cmdName, description, body } = this._parseSkill(content, internalName);
    return { filename: `${cmdName}.md`, content: toKimiMd(cmdName, description, body) };
  }

  installRules(extractedClaudeDir: string, targetProviderDir: string): void {
    const rulesDir = path.join(extractedClaudeDir, 'rules');
    if (!fs.existsSync(rulesDir)) return;

    const parts: string[] = [];
    for (const f of fs.readdirSync(rulesDir).sort()) {
      if (!f.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(rulesDir, f), 'utf8').trim();
      parts.push(resolveSkillRefs(raw, (p, n) => this.skillRef(p, n)));
    }
    if (!parts.length) return;

    fs.mkdirSync(targetProviderDir, { recursive: true });
    fs.writeFileSync(path.join(targetProviderDir, 'AGENTS.md'), parts.join('\n\n---\n\n') + '\n', 'utf8');
  }

  installAgents(extractedClaudeDir: string, targetProviderDir: string): void {
    const agentsDir = path.join(extractedClaudeDir, 'agents');
    if (!fs.existsSync(agentsDir)) return;
    const outDir = path.join(targetProviderDir, 'agents');
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(agentsDir)) {
      if (!f.endsWith('.md')) continue;
      let content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
      content = resolveModel(content, this.name);
      content = resolveModelRefs(content, this.name);
      content = resolveSkillRefs(content, (p, n) => this.skillRef(p, n));
      content = resolveAgentRefs(content, (t, r) => this.agentRef(t, r));
      fs.writeFileSync(path.join(outDir, f), content, 'utf8');
    }
  }

  /**
   * Map Claude Code hooks from settings.json to Kimi Code TOML [[hooks]] entries,
   * appended to ~/.kimi/config.toml. Existing file content is preserved; a
   * hailykit-managed block replaces any previous hailykit injection.
   */
  installHooks(extractedClaudeDir: string, targetProviderDir: string): void {
    const settingsPath = path.join(extractedClaudeDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;

    let settings: unknown;
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
    catch { return; }

    if (typeof settings !== 'object' || settings === null) return;
    const allHooks = (settings as Record<string, unknown>).hooks;
    const hooksMap = (typeof allHooks === 'object' && allHooks !== null)
      ? allHooks as Record<string, unknown>
      : {};

    const srcHooksDir = path.join(extractedClaudeDir, 'hooks');
    const destHooksDir = path.join(targetProviderDir, 'hooks');
    if (fs.existsSync(srcHooksDir)) {
      this._copyHookDir(srcHooksDir, destHooksDir);
    }

    const tomlEntries: string[] = [];
    const destNorm = destHooksDir.replace(/\\/g, '/');

    for (const [claudeEvent, kimiEvent] of Object.entries(CLAUDE_TO_KIMI)) {
      const groups = hooksMap[claudeEvent];
      for (const group of (Array.isArray(groups) ? groups : [])) {
        const hookList = (typeof group === 'object' && group !== null)
          ? (group as Record<string, unknown>).hooks
          : undefined;
        for (const hook of (Array.isArray(hookList) ? hookList : [])) {
          if (typeof hook !== 'object' || hook === null) continue;
          const h = hook as Record<string, unknown>;
          if (h.type !== 'command' || typeof h.command !== 'string') continue;

          // Capture the hooks-dir-relative .cjs from either the plain
          // `node .claude/hooks/x.cjs` form OR the shipped runner form
          // `bash -c 'h=.claude/hooks/haily-node.sh; s=.claude/hooks/x.cjs; …'`.
          // The catalog uses the latter, so a `node …`-only pattern matched nothing.
          const m = h.command.match(/\.claude\/hooks\/([^\s"';]+\.cjs)/);
          if (!m) continue;

          const absScript = `${destNorm}/${m[1]}`;
          const timeout = typeof h.timeout === 'number' ? Math.round(h.timeout / 1000) : 10;
          tomlEntries.push(
            `[[hooks]]\nevent = "${kimiEvent}"\ncommand = "node \\"${absScript}\\""\ntimeout = ${timeout}`,
          );
        }
      }
    }

    if (!tomlEntries.length) return;

    const block = `# hailykit-managed-start\n${tomlEntries.join('\n\n')}\n# hailykit-managed-end`;
    const configPath = path.join(targetProviderDir, 'config.toml');
    fs.mkdirSync(targetProviderDir, { recursive: true });

    let existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const managed = /# hailykit-managed-start[\s\S]*?# hailykit-managed-end/;
    if (managed.test(existing)) {
      existing = existing.replace(managed, block);
    } else {
      existing = existing ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
    }
    fs.writeFileSync(configPath, existing, 'utf8');
  }

  protected skillRef(prefix: string, name: string): string {
    return `/skill:${prefix}-${name}`;
  }
}
