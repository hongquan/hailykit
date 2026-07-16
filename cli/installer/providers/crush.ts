import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { BaseProvider, type ConvertedSkill } from './base.js';
import { toCrushMd, resolveSkillRefs, resolveAgentRefs, resolveModel, resolveModelRefs, parseFrontmatter, isProviderAllowed } from '../converter.js';

/**
 * Crush provider (https://github.com/charmbracelet/crush).
 * Skills → ~/.config/crush/skills/hc-<name>/SKILL.md  (Agent Skills open standard)
 *          %LOCALAPPDATA%\crush\skills\hc-<name>\SKILL.md  (Windows)
 * Rules  → ~/.config/crush/CRUSH.md  (always-applied context file)
 * Agents → ~/.config/crush/agents/<name>.md
 * Hooks  → not installed (Crush hooks are PreToolUse-only via crush.json; format differs from
 *           Claude Code hooks.json — requires a separate converter, not yet implemented)
 * Model  → user-configured at runtime; model: tier line is stripped
 *
 * Spec: 0.76.0 (2026-06-05) — v0.x, breaking changes between minor versions are plausible
 * Hook surface: PreToolUse only (production); PostToolUse is an open request, not shipped
 * Hook format: crush.json `{ "hooks": [{ "matcher": "<regex>", "command": "<shell>" }] }`
 * Docs: https://github.com/charmbracelet/crush/releases
 *       https://charmbracelet-crush.mintlify.app
 */
export class CrushProvider extends BaseProvider {
  get name(): string { return 'crush'; }
  get label(): string { return 'Crush'; }

  globalDir(): string {
    if (process.platform === 'win32') {
      const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
      return path.join(localAppData, 'crush');
    }
    const xdgConfig = process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config');
    return path.join(xdgConfig, 'crush');
  }

  protected _projectDirName(): string { return '.crush'; }
  commandsSubDir(): string { return 'skills'; }
  hooksSupported(): boolean { return false; }

  convertSkill(content: string, internalName: string): ConvertedSkill {
    const { cmdName, description, userInvocable, body } = this._parseSkill(content, internalName);
    return { filename: `${cmdName}/SKILL.md`, content: toCrushMd(cmdName, description, userInvocable, body) };
  }

  installSkills(extractedClaudeDir: string, targetProviderDir: string): number {
    const count = super.installSkills(extractedClaudeDir, targetProviderDir);
    if (count === 0) return 0;

    const skillsDir = path.join(extractedClaudeDir, 'skills');
    const outDir = path.join(targetProviderDir, this.commandsSubDir());
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, 'utf8');
      const parsed = parseFrontmatter(content);
      if (!isProviderAllowed(parsed, this.name)) continue;

      const { cmdName } = this._parseSkill(content, entry.name);

      const srcRefDir = path.join(skillsDir, entry.name, 'references');
      if (fs.existsSync(srcRefDir)) {
        const destRefDir = path.join(outDir, cmdName, 'references');
        fs.mkdirSync(destRefDir, { recursive: true });
        this._copyRefDir(srcRefDir, destRefDir);
      }

      const srcScriptsDir = path.join(skillsDir, entry.name, 'scripts');
      if (fs.existsSync(srcScriptsDir)) {
        const destScriptsDir = path.join(outDir, cmdName, 'scripts');
        fs.mkdirSync(destScriptsDir, { recursive: true });
        this._copySkillSubDir(srcScriptsDir, destScriptsDir);
      }
    }
    return count;
  }

  /** Recursively copy markdown reference files into the installed skill directory. */
  private _copyRefDir(src: string, dest: string): void {
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, ent.name);
      const destPath = path.join(dest, ent.name);
      if (ent.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this._copyRefDir(srcPath, destPath);
      } else if (ent.name.endsWith('.md')) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /** Recursively copy all files in a skill sub-directory (references/, scripts/, etc.). */
  private _copySkillSubDir(src: string, dest: string): void {
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, ent.name);
      const destPath = path.join(dest, ent.name);
      if (ent.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this._copySkillSubDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
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
    fs.writeFileSync(path.join(targetProviderDir, 'CRUSH.md'), parts.join('\n\n---\n\n') + '\n', 'utf8');
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

  protected skillRef(prefix: string, name: string): string {
    return `/${prefix}-${name}`;
  }
}
