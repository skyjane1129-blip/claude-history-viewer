import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 自定义标题单独存一份文件,不去改 Claude Code 自己管理的 .jsonl 会话文件,
// 这样改名操作不会影响真正的 Claude Code 客户端(它不认识、也不会读这个文件)。
function titlesFilePath() {
  return path.join(os.homedir(), '.claude-history-viewer', 'custom-titles.json');
}

function readTitlesFile() {
  try {
    return JSON.parse(fs.readFileSync(titlesFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeTitlesFile(map) {
  const filePath = titlesFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(map, null, 2), 'utf8');
}

export function loadCustomTitles() {
  return readTitlesFile();
}

// title 为空字符串时清除自定义标题,恢复成自动识别的标题。
export function setCustomTitle(sessionId, title) {
  const map = readTitlesFile();
  const trimmed = title.trim();
  if (trimmed) {
    map[sessionId] = trimmed;
  } else {
    delete map[sessionId];
  }
  writeTitlesFile(map);
  return map;
}
