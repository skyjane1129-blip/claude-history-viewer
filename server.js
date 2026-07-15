import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './src/server/store.js';
import * as watch from './src/server/watch.js';
import { loadSessionTurns, deleteSession, findLiveJobForSession } from './src/lib/sessions.js';
import { setCustomTitle } from './src/lib/titles.js';
import { readGlobalClaudeMd, findProjectClaudeMdFiles } from './src/lib/claudeMd.js';

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
