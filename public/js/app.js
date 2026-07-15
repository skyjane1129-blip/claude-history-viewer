(function () {
  const state = {
    sessions: [],
    selectedProject: null, // null = 全部项目
    selectedSessionId: null,
    search: '',
  };

  const el = {
    projectList: document.getElementById('project-list'),
    convList: document.getElementById('conv-list'),
    detailPanel: document.getElementById('detail-panel'),
    searchInput: document.getElementById('search-input'),
    liveDot: document.getElementById('live-dot'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalContent: document.getElementById('modal-content'),
    toast: document.getElementById('toast'),
  };

  // ---------- 工具函数 ----------

  function formatRelativeTime(iso) {
    if (!iso) return '未知时间';
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '未知时间';
    const diffMin = Math.floor((Date.now() - then) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay}天前`;
    return formatAbsoluteDate(then);
  }

  function formatAbsoluteDate(msOrIso) {
    const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
    if (Number.isNaN(d.getTime())) return '未知时间';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatAbsoluteDateTime(msOrIso) {
    const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
    if (Number.isNaN(d.getTime())) return '未知时间';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.toast.hidden = true;
    }, 2500);
  }

  function openModal(html) {
    el.modalContent.innerHTML = html;
    el.modalOverlay.hidden = false;
  }

  function closeModal() {
    el.modalOverlay.hidden = true;
    el.modalContent.innerHTML = '';
  }

  el.modalOverlay.addEventListener('click', (e) => {
    if (e.target === el.modalOverlay) closeModal();
  });

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `请求失败 (${res.status})`);
    }
    return res.json();
  }

  // ---------- 数据加载 ----------

  async function fetchSessions() {
    state.sessions = await api('/api/sessions');
    renderSidebar();
    renderConvList();
  }

  function upsertSession(session) {
    const idx = state.sessions.findIndex((s) => s.sessionId === session.sessionId);
    if (idx >= 0) state.sessions[idx] = session;
    else state.sessions.unshift(session);
  }

  // ---------- 渲染:左侧项目栏 ----------

  function groupByProject() {
    const map = new Map();
    for (const s of state.sessions) {
      if (!map.has(s.projectLabel)) map.set(s.projectLabel, { label: s.projectLabel, count: 0, last: 0 });
      const g = map.get(s.projectLabel);
      g.count += 1;
      const t = s.lastTimestamp ? Date.parse(s.lastTimestamp) : 0;
      if (t > g.last) g.last = t;
    }
    return [...map.values()].sort((a, b) => b.last - a.last);
  }

  function renderSidebar() {
    const groups = groupByProject();
    const totalItem = `
      <div class="project-item ${state.selectedProject === null ? 'selected' : ''}" data-project="">
        <span class="name">全部项目</span>
        <span class="count">${state.sessions.length}</span>
      </div>`;
    const items = groups
      .map(
        (g) => `
      <div class="project-item ${state.selectedProject === g.label ? 'selected' : ''}" data-project="${escapeAttr(g.label)}">
        <span class="name">${escapeHtml(g.label)}</span>
        <span class="count">${g.count}</span>
      </div>`
      )
      .join('');
    el.projectList.innerHTML = totalItem + items;

    el.projectList.querySelectorAll('.project-item').forEach((node) => {
      node.addEventListener('click', () => {
        state.selectedProject = node.dataset.project || null;
        renderSidebar();
        renderConvList();
      });
    });
  }

  // ---------- 渲染:中间对话列表 ----------

  function filteredSessions() {
    const q = state.search.trim().toLowerCase();
    return state.sessions
      .filter((s) => state.selectedProject === null || s.projectLabel === state.selectedProject)
      .filter((s) => !q || s.title.toLowerCase().includes(q) || s.projectLabel.toLowerCase().includes(q))
      .sort((a, b) => (Date.parse(b.lastTimestamp || 0) || 0) - (Date.parse(a.lastTimestamp || 0) || 0));
  }

  function renderConvList() {
    const list = filteredSessions();
    if (list.length === 0) {
      el.convList.innerHTML = `<div class="empty-hint">没有匹配的会话</div>`;
      return;
    }
    el.convList.innerHTML = list
      .map(
        (s) => `
      <div class="conv-item ${s.sessionId === state.selectedSessionId ? 'selected' : ''}" data-id="${s.sessionId}">
        <div class="title">${escapeHtml(s.title)}</div>
        <div class="meta">
          <span>${state.selectedProject === null ? escapeHtml(s.projectLabel) + ' · ' : ''}${s.turnCount}轮</span>
          <span>${formatRelativeTime(s.lastTimestamp)}</span>
        </div>
      </div>`
      )
      .join('');

    el.convList.querySelectorAll('.conv-item').forEach((node) => {
      node.addEventListener('click', () => openSession(node.dataset.id));
    });
  }

  // ---------- 渲染:右侧详情 ----------

  async function openSession(sessionId) {
    state.selectedSessionId = sessionId;
    renderConvList();

    const session = state.sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;

    el.detailPanel.innerHTML = `<div class="empty-state"><p>加载中...</p></div>`;

    let turns;
    try {
      turns = await api(`/api/sessions/${sessionId}/turns`);
    } catch (err) {
      el.detailPanel.innerHTML = `<div class="empty-state"><p>加载失败: ${escapeHtml(err.message)}</p></div>`;
      return;
    }

    renderDetail(session, turns);
  }

  function renderDetail(session, turns) {
    el.detailPanel.innerHTML = `
      <div class="detail-header">
        <div class="title-block">
          <h1 id="detail-title" title="点击改名">${escapeHtml(session.title)}</h1>
          <div class="subtitle">${escapeHtml(session.projectLabel)} · ${formatAbsoluteDateTime(session.firstTimestamp)} ~ ${formatAbsoluteDateTime(session.lastTimestamp)}</div>
        </div>
        <div class="detail-actions">
          <button class="btn" id="btn-claude-md">CLAUDE.md</button>
          <button class="btn" id="btn-rename">改名</button>
          <button class="btn danger" id="btn-delete">删除</button>
        </div>
      </div>
      <div class="messages" id="messages"></div>
    `;

    const messagesEl = document.getElementById('messages');
    for (const turn of turns) messagesEl.appendChild(renderMessageNode(turn));
    messagesEl.scrollTop = messagesEl.scrollHeight;

    document.getElementById('btn-rename').addEventListener('click', () => startRename(session));
    document.getElementById('detail-title').addEventListener('click', () => startRename(session));
    document.getElementById('btn-delete').addEventListener('click', () => confirmDelete(session));
    document.getElementById('btn-claude-md').addEventListener('click', () => openClaudeMd(session));
  }

  function renderMessageNode(turn) {
    const row = document.createElement('div');
    row.className = `msg-row ${turn.role}`;

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = turn.role === 'user' ? '你' : 'Claude';
    row.appendChild(label);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = turn.text ? window.renderMarkdown(turn.text) : '<em>(空)</em>';
    row.appendChild(bubble);

    if (turn.tools && turn.tools.length > 0) {
      const chip = document.createElement('div');
      chip.className = 'tool-chip';
      chip.textContent = `↳ 调用工具: ${turn.tools.join(', ')}`;
      row.appendChild(chip);
    }

    return row;
  }

  // ---------- 改名 ----------

  function startRename(session) {
    const titleEl = document.getElementById('detail-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = session.title;
    input.style.font = 'inherit';
    input.style.fontWeight = '600';
    input.style.width = '100%';
    input.style.padding = '2px 4px';
    input.style.borderRadius = '6px';
    input.style.border = '1px solid var(--border)';
    input.style.background = 'var(--bg)';
    input.style.color = 'var(--text)';

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      try {
        const updated = await api(`/api/sessions/${session.sessionId}/title`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle }),
        });
        upsertSession(updated);
        showToast(newTitle ? `已改名: ${newTitle}` : `已恢复默认标题: ${updated.title}`);
        renderSidebar();
        renderConvList();
        if (state.selectedSessionId === session.sessionId) openSession(session.sessionId);
      } catch (err) {
        showToast(`改名失败: ${err.message}`);
      }
    };
    const cancel = () => {
      if (done) return;
      done = true;
      if (state.selectedSessionId === session.sessionId) openSession(session.sessionId);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', commit);
  }

  // ---------- 删除 ----------

  async function confirmDelete(session) {
    openModal(`
      <h2>确定删除会话吗?</h2>
      <p>《${escapeHtml(session.title)}》此操作不可恢复。</p>
      <p id="live-job-warning" class="warn"></p>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">取消</button>
        <button class="btn danger" id="modal-confirm">确认删除</button>
      </div>
    `);

    api(`/api/sessions/${session.sessionId}/live-job`).then(({ liveJob }) => {
      if (liveJob) {
        const w = document.getElementById('live-job-warning');
        if (w) {
          w.textContent = `⚠ 这个会话对应的 Claude 进程还在运行 (pid ${liveJob.pid})。现在删除后,只要它再写一条新消息,文件就会被自动重新创建,等于没删掉 —— 建议先结束那个终端/任务。`;
        }
      }
    });

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-confirm').addEventListener('click', async () => {
      try {
        await api(`/api/sessions/${session.sessionId}`, { method: 'DELETE' });
        state.sessions = state.sessions.filter((s) => s.sessionId !== session.sessionId);
        if (state.selectedSessionId === session.sessionId) {
          state.selectedSessionId = null;
          el.detailPanel.innerHTML = `<div class="empty-state"><p>从左侧选择一个对话</p></div>`;
        }
        renderSidebar();
        renderConvList();
        showToast(`已删除: ${session.title}`);
        closeModal();
      } catch (err) {
        showToast(`删除失败: ${err.message}`);
        closeModal();
      }
    });
  }

  // ---------- CLAUDE.md 查看 ----------

  async function openClaudeMd(session) {
    openModal(`<h2>CLAUDE.md · ${escapeHtml(session.projectLabel)}</h2><p>加载中...</p>`);
    let data;
    try {
      data = await api(`/api/sessions/${session.sessionId}/claude-md`);
    } catch (err) {
      openModal(`<h2>CLAUDE.md</h2><p>加载失败: ${escapeHtml(err.message)}</p>`);
      return;
    }

    const renderFile = (title, file) => {
      if (!file) return `<div class="md-file"><strong>${title}</strong><p class="path">(未找到该文件)</p></div>`;
      return `<div class="md-file"><strong>${title}</strong><p class="path">${escapeHtml(file.filePath)}</p>${window.renderMarkdown(file.content)}</div>`;
    };

    const projectSection =
      data.projectFiles.length === 0
        ? renderFile(`项目 CLAUDE.md · ${escapeHtml(data.projectLabel)}`, null)
        : data.projectFiles
            .map((f, i) =>
              renderFile(
                data.projectFiles.length > 1 ? `项目 CLAUDE.md #${i + 1} · ${escapeHtml(data.projectLabel)}` : `项目 CLAUDE.md · ${escapeHtml(data.projectLabel)}`,
                f
              )
            )
            .join('');

    openModal(`
      <h2>CLAUDE.md</h2>
      ${renderFile('全局 CLAUDE.md (~/.claude/CLAUDE.md)', data.global)}
      ${projectSection}
      <div class="modal-actions">
        <button class="btn" id="modal-close">关闭</button>
      </div>
    `);
    document.getElementById('modal-close').addEventListener('click', closeModal);
  }

  // ---------- 转义辅助 ----------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // ---------- 搜索 ----------

  el.searchInput.addEventListener('input', () => {
    state.search = el.searchInput.value;
    renderConvList();
  });

  // ---------- 实时监看 (SSE) ----------

  function connectEvents() {
    const source = new EventSource('/api/events');
    source.onopen = () => el.liveDot.classList.add('connected');
    source.onerror = () => el.liveDot.classList.remove('connected');
    source.onmessage = (e) => {
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }

      if (event.type === 'session-updated') {
        upsertSession(event.session);
        renderSidebar();
        renderConvList();
        if (state.selectedSessionId === event.session.sessionId) {
          const titleEl = document.getElementById('detail-title');
          if (titleEl) titleEl.textContent = event.session.title;
        }
      } else if (event.type === 'sessions-changed') {
        fetchSessions();
      } else if (event.type === 'new-turns') {
        if (event.sessionId === state.selectedSessionId) {
          const messagesEl = document.getElementById('messages');
          if (messagesEl) {
            for (const turn of event.turns) messagesEl.appendChild(renderMessageNode(turn));
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      }
    };
  }

  // ---------- 启动 ----------

  fetchSessions();
  connectEvents();
})();
