import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './src/server/store.js';
import * as watch from './src/server/watch.js';
import { searchSessions } from './src/server/search.js';
import { loadSessionTurns, deleteSession, findLiveJobForSession } from './src/lib/sessions.js';
import { setCustomTitle } from './src/lib/titles.js';
import { readGlobalClaudeMd, findProjectClaudeMdFiles, findRulesFiles, writeMdFile } from './src/lib/claudeMd.js';
import { computeUsageSummary } from './src/lib/usage.js';
import { listPersonalSkills, listPluginSkills, readSkillContent, writeSkillContent } from './src/lib/skills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', async (req, res) => {
  res.json(await store.getAll());
});

app.get('/api/sessions/:id/turns', async (req, res) => {
  const session = await store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json(await loadSessionTurns(session.filePath));
});

app.get('/api/sessions/:id/claude-md', async (req, res) => {
  const session = await store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json({
    global: readGlobalClaudeMd(),
    projectFiles: findProjectClaudeMdFiles(session.cwd),
    projectLabel: session.projectLabel,
  });
});

app.get('/api/sessions/:id/live-job', async (req, res) => {
  res.json({ liveJob: (await findLiveJobForSession(req.params.id)) || null });
});

app.put('/api/sessions/:id/title', async (req, res) => {
  const session = await store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  const title = typeof req.body.title === 'string' ? req.body.title : '';
  setCustomTitle(req.params.id, title);
  const sessions = await store.refresh();
  res.json(sessions.find((s) => s.sessionId === req.params.id));
});

app.delete('/api/sessions/:id', async (req, res) => {
  const session = await store.getById(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  await deleteSession(session.filePath);
  await store.refresh();
  res.json({ ok: true });
});

// ---------- 用量仪表盘 ----------

app.get('/api/usage', async (req, res) => {
  res.json(await computeUsageSummary());
});

// ---------- Skills 管理 ----------

app.get('/api/skills', (req, res) => {
  res.json({ personal: listPersonalSkills(), plugins: listPluginSkills() });
});

app.get('/api/skills/content', (req, res) => {
  try {
    res.json({ content: readSkillContent(req.query.path) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/skills/content', (req, res) => {
  try {
    writeSkillContent(req.body.path, typeof req.body.content === 'string' ? req.body.content : '');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Rules 管理 (CLAUDE.md + .claude/rules) ----------

async function cwdForProject(projectLabel) {
  const sessions = await store.getAll();
  const found = sessions.find((s) => s.projectLabel === projectLabel && s.cwd);
  return found ? found.cwd : null;
}

app.get('/api/rules', async (req, res) => {
  const projectLabel = typeof req.query.project === 'string' ? req.query.project : null;
  const cwd = projectLabel ? await cwdForProject(projectLabel) : null;
  res.json({
    global: readGlobalClaudeMd(),
    projectFiles: cwd ? findProjectClaudeMdFiles(cwd) : [],
    rulesFiles: findRulesFiles(cwd),
    cwd,
  });
});

app.put('/api/rules', (req, res) => {
  try {
    writeMdFile(req.body.filePath, typeof req.body.content === 'string' ? req.body.content : '');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 全文搜索 ----------

app.get('/api/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(await searchSessions(q));
});

// 实时监看:浏览器通过 SSE 长连接接收"新消息到达/会话摘要更新"事件。
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  watch.addClient(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // 连接已断开,交给下面的 close 事件清理
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    watch.removeClient(res);
  });
});

const PORT = process.env.PORT || 4173;

store
  .refresh()
  .then(() => watch.startWatching())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Claude 历史对话浏览器已启动: http://localhost:${PORT}`);
    });
  });
