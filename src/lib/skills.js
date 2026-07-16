import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function personalSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

function pluginsMarketplacesDir() {
  return path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { name: null, description: null };
  const yaml = m[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    description: descMatch ? descMatch[1].trim() : null,
  };
}

function tryReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isPathInside(child, parent) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const a = process.platform === 'win32' ? resolvedChild.toLowerCase() : resolvedChild;
  const b = process.platform === 'win32' ? resolvedParent.toLowerCase() : resolvedParent;
  const rel = path.relative(b, a);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// 你自己写的 skill(~/.claude/skills/<name>/SKILL.md)—— 可以在网页里直接编辑。
export function listPersonalSkills() {
  const root = personalSkillsDir();
  const entries = tryReadDir(root).filter((d) => d.isDirectory());
  const skills = [];
  for (const entry of entries) {
    const skillMdPath = path.join(root, entry.name, 'SKILL.md');
    let content;
    try {
      content = fs.readFileSync(skillMdPath, 'utf8');
    } catch {
      continue;
    }
    const { name, description } = parseFrontmatter(content);
    skills.push({
      id: entry.name,
      name: name || entry.name,
      description: description || '',
      filePath: skillMdPath,
      editable: true,
    });
  }
  return skills;
}

// 插件市场里自带的 skill —— 是别人维护的内容,只读展示,不允许在这里改。
export function listPluginSkills() {
  const root = pluginsMarketplacesDir();
  const skills = [];
  const marketplaces = tryReadDir(root).filter((d) => d.isDirectory());

  for (const marketplace of marketplaces) {
    for (const kind of ['plugins', 'external_plugins']) {
      const pluginsDir = path.join(root, marketplace.name, kind);
      const plugins = tryReadDir(pluginsDir).filter((d) => d.isDirectory());
      for (const plugin of plugins) {
        const skillsDir = path.join(pluginsDir, plugin.name, 'skills');
        const skillDirs = tryReadDir(skillsDir).filter((d) => d.isDirectory());
        for (const skillDir of skillDirs) {
          const skillMdPath = path.join(skillsDir, skillDir.name, 'SKILL.md');
          let content;
          try {
            content = fs.readFileSync(skillMdPath, 'utf8');
          } catch {
            continue;
          }
          const { name, description } = parseFrontmatter(content);
          skills.push({
            id: `${plugin.name}/${skillDir.name}`,
            name: name || skillDir.name,
            description: description || '',
            plugin: plugin.name,
            filePath: skillMdPath,
            editable: false,
          });
        }
      }
    }
  }
  return skills;
}

export function readSkillContent(filePath) {
  if (!isPathInside(filePath, personalSkillsDir()) && !isPathInside(filePath, pluginsMarketplacesDir())) {
    throw new Error('非法路径');
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function writeSkillContent(filePath, content) {
  if (!isPathInside(filePath, personalSkillsDir())) {
    throw new Error('只能编辑个人 skills 目录下的文件');
  }
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(`${filePath}.bak`, fs.readFileSync(filePath, 'utf8'), 'utf8');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
