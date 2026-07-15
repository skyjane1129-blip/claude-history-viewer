import fs from 'node:fs';
import path from 'node:path';
import { claudeProjectsDir } from '../lib/sessions.js';
import { extractHumanText, isGenuineUserTurn, extractAssistantTurn } from '../lib/textExtract.js';
import * as store from './store.js';

// 监听 ~/.claude/projects 目录变化,实现"实时监看正在进行的对话":
// 有新行写入某个 .jsonl 文件时,只增量读取新增的字节、解析成 turns,
// 通过 SSE 推给所有已连接的浏览器标签页,而不是让前端反复轮询整份文件。

const clients = new Set();
const offsets = new Map(); // filePath -> 已读取到的字节偏移量
const leftovers = new Map(); // filePath -> 上次读取剩下的不完整行
const debounceTimers = new Map(); // filePath -> 防抖定时器

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function sessionIdFromFilePath(filePath) {
  return path.basename(filePath, '.jsonl');
}

async function readNewLines(filePath) {
  const stat = await fs.promises.stat(filePath);
  let offset = offsets.get(filePath);

  if (offset === undefined || stat.size < offset) {
    // 新出现的文件,或者文件被截断重写了 —— 只记录起点,不重放历史内容
    // (完整历史交给 /api/sessions/:id/turns 一次性加载,SSE 只负责"此后新增"的内容)。
    offsets.set(filePath, stat.size);
    leftovers.delete(filePath);
    return [];
  }
  if (stat.size === offset) return [];

  const stream = fs.createReadStream(filePath, { start: offset, encoding: 'utf8' });
  let chunk = '';
  for await (const piece of stream) chunk += piece;

  const prevLeftover = leftovers.get(filePath) || '';
  const combined = prevLeftover + chunk;
  const lines = combined.split('\n');
  const trailing = lines.pop();
  leftovers.set(filePath, trailing);

  const consumedBytes = Buffer.byteLength(combined, 'utf8') - Buffer.byteLength(trailing, 'utf8');
  offsets.set(filePath, offset + consumedBytes);

  return lines.filter((l) => l.trim().length > 0);
}

function parseLinesToTurns(rawLines) {
  const turns = [];
  for (const line of rawLines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.isSidechain) continue;
    if (isGenuineUserTurn(rec)) {
      turns.push({ role: 'user', text: extractHumanText(rec.message.content), timestamp: rec.timestamp });
    } else if (rec.type === 'assistant') {
      const { text, tools } = extractAssistantTurn(rec);
      if (text || tools.length > 0) turns.push({ role: 'assistant', text, tools, timestamp: rec.timestamp });
    }
  }
  return turns;
}

async function handleFileChange(filePath) {
  let rawLines;
  try {
    rawLines = await readNewLines(filePath);
  } catch {
    // 文件可能刚被删除,忽略这次事件
    return;
  }

  await store.refresh();
  const sessionId = sessionIdFromFilePath(filePath);
  const summary = await store.getById(sessionId);
  broadcast(summary ? { type: 'session-updated', session: summary } : { type: 'sessions-changed' });

  if (rawLines.length > 0) {
    const turns = parseLinesToTurns(rawLines);
    if (turns.length > 0) broadcast({ type: 'new-turns', sessionId, turns });
  }
}

function scheduleHandle(filePath) {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    filePath,
    setTimeout(() => {
      debounceTimers.delete(filePath);
      handleFileChange(filePath).catch(() => {});
    }, 250)
  );
}

let watcherStarted = false;

export async function startWatching() {
  if (watcherStarted) return;
  watcherStarted = true;

  const root = claudeProjectsDir();
  const sessions = await store.getAll();
  for (const s of sessions) {
    try {
      const stat = await fs.promises.stat(s.filePath);
      offsets.set(s.filePath, stat.size);
    } catch {
      // 忽略读取失败的文件
    }
  }

  try {
    fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      scheduleHandle(path.join(root, filename));
    });
  } catch (err) {
    console.error('文件监听启动失败,实时更新功能将不可用:', err.message);
  }
}
