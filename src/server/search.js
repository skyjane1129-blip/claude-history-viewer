import { loadSessionTurns } from '../lib/sessions.js';
import * as store from './store.js';

function buildSnippet(text, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(text.length, matchIndex + matchLength + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).replace(/\s+/g, ' ') + suffix;
}

// 标题/项目名先命中就直接算匹配;都没命中的话再把整份对话内容读出来找关键词。
// 数据规模是个人本地历史(几十到几百个会话),逐份读取在这个量级下足够快,
// 不值得为此另外维护一份搜索索引。
export async function searchSessions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const sessions = await store.getAll();
  const results = [];

  for (const session of sessions) {
    if (session.title.toLowerCase().includes(q) || session.projectLabel.toLowerCase().includes(q)) {
      results.push({ sessionId: session.sessionId, matchType: 'title', snippet: null });
      continue;
    }

    let turns;
    try {
      turns = await loadSessionTurns(session.filePath);
    } catch {
      continue;
    }

    for (const turn of turns) {
      if (!turn.text) continue;
      const idx = turn.text.toLowerCase().indexOf(q);
      if (idx >= 0) {
        results.push({
          sessionId: session.sessionId,
          matchType: 'content',
          snippet: buildSnippet(turn.text, idx, q.length),
        });
        break;
      }
    }
  }

  return results;
}
