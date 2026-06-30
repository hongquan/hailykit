import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { BaseProvider, type ConvertedSkill } from './base.js';
import { toClineMd, resolveSkillRefs, resolveAgentRefs, resolveModel, resolveModelRefs } from '../converter.js';

// Cline hook events mirror Claude Code event names exactly — both use the
// same settings.json schema. These are the events Cline fires as of 2026-06.
// SessionStart and Stop have no confirmed Cline equivalents.
const CLAUDE_TO_CLINE: Record<string, string> = {
  PreToolUse:       'PreToolUse',
  PostToolUse:      'PostToolUse',
  UserPromptSubmit: 'UserPromptSubmit',
};

interface ClineHookEntry {
  type: 'command';
  command: string;
  timeout?: number;
}

interface ClineHookGroup {
  matcher?: string;
  hooks: ClineHookEntry[];
}

/**
 * Cline provider (https://cline.bot — VS Code extension + CLI).
 * Skills  → ~/.cline/skills/<name>/SKILL.md  (Agent Skills open standard, native SKILL.md)
 * Rules   → ~/.cline/rules/hailykit-rules.md  (always-applied system prompt injection)
 * Agents  → ~/.cline/agents/<name>.md  (model tier stripped; user configures at runtime)
 * Hooks   → ~/.cline/settings.json  (same JSON schema as Claude Code settings.json)
 * Model   → user-configured at runtime; model: tier line is stripped
 *
 * Global dirs:
 *   Linux/macOS: ~/.cline/
 *   Windows:     %USERPROFILE%\.cline\  (same path via os.homedir())
 *
 * Cline hook events (confirmed as of 2026-06):
 *   PreToolUse, PostToolUse, UserPromptSubmit
 * NOTE: Cline hooks are currently macOS/Linux only; Windows hook support is
 * not confirmed. Hook scripts are still copied so they are ready when support lands.
 *
 * Spec: open-source VS Code extension — no fixed semver; researched 2026-06-30
 * Docs: https://docs.cline.bot/customization/skills
 *       https://docs.cline.bot/customization/hooks
 *       https://docs.cline.bot/customization/cline-rules
 */
export class ClineProvider extends BaseProvider {
  get name(): string { return 'cline'; }
  get label(): string { return 'Cline'; }

  globalDir(): string { return path.join(os.homedir(), '.cline'); }
  protected _projectDirName(): string { return '.cline'; }
  // Skills are installed as native SKILL.md directories, not flat command files.
  // commandsSubDir() is used only for the flat-file installSkills() path in BaseProvider,
  // which we override completely — but keep a sensible value for uninstall().
  commandsSubDir(): string { return 'skills'; }
  hooksSupported(): boolean { return true; }

  /**
   * Cline supports native SKILL.md format — identical to hailykit's source format.
   * Each skill is a <cmdName>/SKILL.md directory inside ~/.cline/skills/.
   * No format conversion is needed; we resolve model refs and refs only.
   */
  convertSkill(content: string, internalName: string): ConvertedSkill {
    const { cmdName, description, body } = this._parseSkill(content, internalName);
    return {
      filename: `${cmdName}/SKILL.md`,
      content: toClineMd(cmdName, description, body),
    };
  }

  /**
   * Install rules as hailykit-rules.md inside ~/.cline/rules/.
   * Cline reads markdown files from the rules/ directory and injects them
   * into every system prompt (always-on context, like Claude Code's CLAUDE.md rules).
   */
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

    const outDir = path.join(targetProviderDir, 'rules');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'hailykit-rules.md'), parts.join('\n\n---\n\n') + '\n', 'utf8');
  }

  /**
   * Copy agent markdown files to agents/, resolving model tiers, {skill:} and
   * {agent:} refs to Cline-specific syntax before writing.
   */
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
   * Map Claude Code hooks from settings.json to Cline's settings.json hook format.
   * Cline uses an identical JSON schema to Claude Code — same event names, same
   * { matcher, hooks: [{ type, command, timeout }] } structure — so mapping is 1:1.
   * The output is written as a hailykit-managed block in ~/.cline/settings.json.
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

    const outHooks: Record<string, ClineHookGroup[]> = {};
    const destNorm = destHooksDir.replace(/\\/g, '/');

    for (const [claudeEvent, clineEvent] of Object.entries(CLAUDE_TO_CLINE)) {
      const groups = hooksMap[claudeEvent];
      for (const group of (Array.isArray(groups) ? groups : [])) {
        if (typeof group !== 'object' || group === null) continue;
        const g = group as Record<string, unknown>;
        const hookList = g.hooks;
        const matcher = typeof g.matcher === 'string' ? g.matcher : undefined;

        const entries: ClineHookEntry[] = [];
        for (const hook of (Array.isArray(hookList) ? hookList : [])) {
          if (typeof hook !== 'object' || hook === null) continue;
          const h = hook as Record<string, unknown>;
          if (h.type !== 'command' || typeof h.command !== 'string') continue;

          // Capture the hooks-dir-relative .cjs from either the plain
          // `node .claude/hooks/x.cjs` form OR the shipped runner form
          // `bash -c 'h=.claude/hooks/haily-node.sh; s=.claude/hooks/x.cjs; …'`.
          const m = h.command.match(/\.claude\/hooks\/([^\s"';]+\.cjs)/);
          if (!m) continue;

          const absScript = `${destNorm}/${m[1]}`;
          entries.push({
            type: 'command',
            command: `node "${absScript}"`,
            ...(typeof h.timeout === 'number' ? { timeout: h.timeout } : {}),
          });
        }

        if (!entries.length) continue;
        if (!outHooks[clineEvent]) outHooks[clineEvent] = [];
        outHooks[clineEvent].push({ ...(matcher ? { matcher } : {}), hooks: entries });
      }
    }

    if (!Object.keys(outHooks).length) return;

    fs.mkdirSync(targetProviderDir, { recursive: true });
    const clineSettingsPath = path.join(targetProviderDir, 'settings.json');

    // Read existing settings or start fresh.
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(clineSettingsPath)) {
      try { existing = JSON.parse(fs.readFileSync(clineSettingsPath, 'utf8')) as Record<string, unknown>; }
      catch { /* start fresh */ }
    }

    // Merge HailyKit hooks into the existing hooks object, replacing any
    // previously managed events so upgrades are idempotent.
    const existingHooks = (typeof existing.hooks === 'object' && existing.hooks !== null)
      ? existing.hooks as Record<string, unknown>
      : {};

    // Remove old hailykit-managed entries for the events we manage.
    for (const event of Object.keys(CLAUDE_TO_CLINE)) {
      const clineEv = CLAUDE_TO_CLINE[event];
      if (Array.isArray(existingHooks[clineEv])) {
        existingHooks[clineEv] = (existingHooks[clineEv] as ClineHookGroup[]).filter(
          (g: ClineHookGroup) => !g.hooks?.some((h) => h.command?.includes(destNorm)),
        );
      }
    }

    // Append new entries.
    for (const [event, groups] of Object.entries(outHooks)) {
      if (!Array.isArray(existingHooks[event])) existingHooks[event] = [];
      (existingHooks[event] as ClineHookGroup[]).push(...groups);
    }

    existing.hooks = existingHooks;
    fs.writeFileSync(clineSettingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  }

  /** Cline skill invocation: /skill:hc-<name> (consistent with Kimi pattern). */
  protected skillRef(prefix: string, name: string): string {
    return `/skill:${prefix}-${name}`;
  }
}
