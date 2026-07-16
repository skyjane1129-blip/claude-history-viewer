import fs from 'node:fs';
import readline from 'node:readline';
import { scanAllSessions } from './sessions.js';

// 价格表:每百万 token 的美元价格,按模型名里的关键词匹配(不区分大小写)。
// 这些数字是公开定价的估算值,不保证和你账单上的实际扣费完全一致
// (尤其是新模型/新的缓存计费规则),仅供大致参考,想更精确可以自行改这里。
const PRICING_TABLE = [
  { match: /opus/i, input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  { match: /sonnet/i, input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { match: /haiku/i, input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
];
const DEFAULT_PRICE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

function priceFor(model) {
  if (!model) return DEFAULT_PRICE;
  const found = PRICING_TABLE.find((p) => p.match.test(model));
  return found || DEFAULT_PRICE;
}

function estimateCost(model, usage) {
  const price = priceFor(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (input * price.input + output * price.output + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead) /
    1_000_000
  );
}

function dayKey(isoTimestamp) {
  return isoTimestamp ? isoTimestamp.slice(0, 10) : '未知日期';
}

async function scanFileUsage(filePath) {
  const records = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== 'assistant' || !rec.message || !rec.message.usage) continue;
    records.push({
      timestamp: rec.timestamp,
      model: rec.message.model || '未知模型',
      usage: rec.message.usage,
    });
  }
  return records;
}

// 汇总所有会话里的 token 用量,按天/项目/模型聚合,并附带预估费用。
export async function computeUsageSummary() {
  const sessions = await scanAllSessions();

  const byDay = new Map();
  const byProject = new Map();
  const byModel = new Map();
  let totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, messageCount: 0 };

  const bump = (map, key, tokens, cost) => {
    if (!map.has(key)) map.set(key, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, messageCount: 0 });
    const g = map.get(key);
    g.input += tokens.input_tokens || 0;
    g.output += tokens.output_tokens || 0;
    g.cacheWrite += tokens.cache_creation_input_tokens || 0;
    g.cacheRead += tokens.cache_read_input_tokens || 0;
    g.cost += cost;
    g.messageCount += 1;
  };

  for (const session of sessions) {
    let records;
    try {
      records = await scanFileUsage(session.filePath);
    } catch {
      continue;
    }
    for (const rec of records) {
      const cost = estimateCost(rec.model, rec.usage);
      bump(byDay, dayKey(rec.timestamp), rec.usage, cost);
      bump(byProject, session.projectLabel, rec.usage, cost);
      bump(byModel, rec.model, rec.usage, cost);

      totals.input += rec.usage.input_tokens || 0;
      totals.output += rec.usage.output_tokens || 0;
      totals.cacheWrite += rec.usage.cache_creation_input_tokens || 0;
      totals.cacheRead += rec.usage.cache_read_input_tokens || 0;
      totals.cost += cost;
      totals.messageCount += 1;
    }
  }

  const toSortedArray = (map, keyName) =>
    [...map.entries()]
      .map(([key, v]) => ({ [keyName]: key, ...v }))
      .sort((a, b) => (a[keyName] < b[keyName] ? -1 : 1));

  const toRankedArray = (map, keyName) =>
    [...map.entries()].map(([key, v]) => ({ [keyName]: key, ...v })).sort((a, b) => b.cost - a.cost);

  return {
    totals,
    byDay: toSortedArray(byDay, 'day'),
    byProject: toRankedArray(byProject, 'projectLabel'),
    byModel: toRankedArray(byModel, 'model'),
    isEstimate: true,
  };
}
