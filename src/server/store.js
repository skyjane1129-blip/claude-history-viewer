import { scanAllSessions } from '../lib/sessions.js';

// 内存里缓存一份最新的会话摘要列表,避免每个 API 请求都重新扫描整个 ~/.claude/projects。
// 由 watch.js 在监听到文件变化时调用 refresh() 保持数据新鲜。
let sessions = [];
let byId = new Map();
let loaded = false;

export async function refresh() {
  sessions = await scanAllSessions();
  byId = new Map(sessions.map((s) => [s.sessionId, s]));
  loaded = true;
  return sessions;
}

export async function getAll() {
  if (!loaded) await refresh();
  return sessions;
}

export async function getById(sessionId) {
  if (!loaded) await refresh();
  return byId.get(sessionId) || null;
}
