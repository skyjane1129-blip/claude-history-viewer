import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { extractAssistantTurn, extractHumanText, isGenuineUserTurn } from './textExtract.js';
import { loadCustomTitles } from './titles.js';

export function claudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

export function claudeSessionsDir() {
  return path.join(os.homedir(), '.claude', 'sessions');
}

// 查一下这个 sessionId 是不是还有活着的 Claude 进程挂着。
// ~/.claude/sessions/<pid>.json 是进程注册表,进程退出后不一定会自己清理,
// 所以还要用 process.kill(pid, 0) 探活一下,过滤掉进程已经死掉的残留文件。
export async function findLiveJobForSession(sessionId) {
  let files = [];
  try {
    files = await fs.promises.readdir(claudeSessionsDir());
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let rec;
    try {
      rec = JSON.parse(await fs.promises.readFile(path.join(claudeSessionsDir(), f), 'utf8'));
    } catch {
      continue;
    }
    if (rec.sessionId !== sessionId) continue;
    try {
      process.kill(rec.pid, 0);
    } catch {
      continue;
    }
    return rec;
  }
  return null;
}

async function scanOneFile(filePath, customTitles) {
  const stat = await fs.promises.stat(filePath);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let aiTitle = null;
  let cwd = null;
  let firstHumanText = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let turnCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.cwd && !cwd) cwd = rec.cwd;
    if (rec.timestamp) {
      if (!firstTimestamp) firstTimestamp = rec.timestamp;
      lastTimestamp = rec.timestamp;
    }
    if (rec.type === 'ai-title' && rec.aiTitle) aiTitle = rec.aiTitle;

    if (isGenuineUserTurn(rec)) {
      turnCount += 1;
      if (!firstHumanText) {
        firstHumanText = extractHumanText(rec.message.content);
      }
    }
  }

  const sessionId = path.basename(filePath, '.jsonl');
  // ai-title 有时会直接把 <command-message> 这类原始标签文本当成标题存进来,
  // 这种情况下标题不可读,退回用首条人类消息做标题更合适。
  const cleanAiTitle = aiTitle && !/<[a-zA-Z][\w-]*>/.test(aiTitle) ? aiTitle : null;
  const autoTitle = cleanAiTitle || (firstHumanText ? firstHumanText.slice(0, 60) : '(空会话)');
  const customTitle = customTitles && customTitles[sessionId];
  const projectLabel = cwd ? path.basename(cwd) : path.basename(path.dirname(filePath));

  return {
    sessionId,
    filePath,
    cwd,
    projectLabel,
    title: customTitle || autoTitle,
    autoTitle,
    isCustomTitle: !!customTitle,
    firstTimestamp,
    lastTimestamp,
    turnCount,
    sizeBytes: stat.size,
  };
}

export async function scanAllSessions() {
  const root = claudeProjectsDir();
  let projectDirs = [];
  try {
    projectDirs = (await fs.promises.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => path.join(root, d.name));
  } catch {
    return [];
  }

  const customTitles = loadCustomTitles();
  const sessions = [];
  for (const dir of projectDirs) {
    let files = [];
    try {
      files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        sessions.push(await scanOneFile(path.join(dir, f), customTitles));
      } catch {
        // 单个文件解析失败不影响其他会话的展示
      }
    }
  }

  sessions.sort((a, b) => {
    const ta = a.lastTimestamp ? Date.parse(a.lastTimestamp) : 0;
    const tb = b.lastTimestamp ? Date.parse(b.lastTimestamp) : 0;
    return tb - ta;
  });

  return sessions;
}

export async function loadSessionTurns(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const turns = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.isSidechain) continue;

    if (isGenuineUserTurn(rec)) {
      const text = extractHumanText(rec.message.content);
      turns.push({ role: 'user', text, timestamp: rec.timestamp });
    } else if (rec.type === 'assistant') {
      const { text, tools } = extractAssistantTurn(rec);
      if (text || tools.length > 0) {
        turns.push({ role: 'assistant', text, tools, timestamp: rec.timestamp });
      }
    }
  }

  return turns;
}

export async function deleteSession(filePath) {
  await fs.promises.unlink(filePath);
  // 同名子目录放的是这个会话的 subagent 转写、溢出的工具结果等附属数据,一并清掉。
  const sessionId = path.basename(filePath, '.jsonl');
  const sideDir = path.join(path.dirname(filePath), sessionId);
  await fs.promises.rm(sideDir, { recursive: true, force: true }).catch(() => {});
}
