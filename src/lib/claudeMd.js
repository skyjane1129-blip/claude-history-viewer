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
