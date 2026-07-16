import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tryRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function globalClaudeMdPath() {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md');
}

export function readGlobalClaudeMd() {
  const filePath = globalClaudeMdPath();
  const content = tryRead(filePath);
  return content === null ? null : { filePath, content };
}

// Claude Code 加载项目记忆时是从当前工作目录开始一层层往上找 CLAUDE.md,
// 这里照着同样的规则收集,一直找到用户主目录为止(防止扫到系统盘根目录)。
export function findProjectClaudeMdFiles(cwd) {
  if (!cwd) return [];
  const home = os.homedir();
  const results = [];
  let dir = cwd;
  for (let i = 0; i < 20; i++) {
    const direct = path.join(dir, 'CLAUDE.md');
    const nested = path.join(dir, '.claude', 'CLAUDE.md');

    const directContent = tryRead(direct);
    if (directContent !== null) results.push({ filePath: direct, content: directContent });

    const nestedContent = tryRead(nested);
    if (nestedContent !== null) results.push({ filePath: nested, content: nestedContent });

    if (dir === home) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
}

function listMdFilesIn(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const filePath = path.join(dir, e.name);
      return { filePath, content: tryRead(filePath) };
    })
    .filter((f) => f.content !== null);
}

// .claude/rules/*.md —— 全局(~/.claude/rules)+ 从 cwd 往上找到的各级项目 rules 目录。
export function findRulesFiles(cwd) {
  const home = os.homedir();
  const results = listMdFilesIn(path.join(home, '.claude', 'rules')).map((f) => ({ ...f, scope: '全局' }));

  if (cwd) {
    let dir = cwd;
    for (let i = 0; i < 20; i++) {
      results.push(...listMdFilesIn(path.join(dir, '.claude', 'rules')).map((f) => ({ ...f, scope: '项目' })));
      if (dir === home) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return results;
}

function isClaudeMdPath(filePath) {
  return path.basename(filePath) === 'CLAUDE.md';
}

function isRulesFilePath(filePath) {
  return path.basename(path.dirname(filePath)) === 'rules' && filePath.endsWith('.md');
}

// 写入前把旧内容备份成 <文件名>.bak(会被覆盖式更新,只保留最近一次的旧版本),
// 防止网页里编辑手滑,改坏了 Claude Code 实际会读取的规则文件。
export function writeMdFile(filePath, content) {
  if (!isClaudeMdPath(filePath) && !isRulesFilePath(filePath)) {
    throw new Error('只能编辑 CLAUDE.md 或 rules 目录下的 .md 文件');
  }
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(`${filePath}.bak`, fs.readFileSync(filePath, 'utf8'), 'utf8');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}
