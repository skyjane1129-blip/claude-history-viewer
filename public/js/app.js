(function () {
  const state = {
    view: 'history', // 'history' | 'usage' | 'skills' | 'rules'
    sessions: [],
    selectedProject: null, // null = 全部项目
    selectedSessionId: null,
    search: '',
    searchResults: null, // { query, results } | null
    skills: null,
    selectedSkillPath: null,
  };

  const el = {
    projectList: document.getElementById('project-list'),
    navTabs: document.getElementById('nav-tabs'),
    mainArea: document.getElementById('main-area'),
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
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

  // ---------- 导航切换 ----------

  function switchView(view, projectLabel) {
    state.view = view;
    if (projectLabel !== undefined) state.selectedProject = projectLabel;

    el.navTabs.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    el.projectList.style.display = view === 'skills' ? 'none' : '';

    renderSidebar();
    renderMainArea();
  }

  function renderMainArea() {
    if (state.view === 'history') renderHistoryView();
    else if (state.view === 'usage') renderUsageView();
    else if (state.view === 'skills') renderSkillsView();
    else if (state.view === 'rules') renderRulesView();
  }

  el.navTabs.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ---------- 数据加载:会话列表 ----------

  async function fetchSessions() {
    state.sessions = await api('/api/sessions');
    renderSidebar();
    if (state.view === 'history') renderConvList();
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
        if (state.view === 'history') renderConvList();
        else if (state.view === 'rules') renderRulesView();
      });
    });
  }

  // ================================================================
  // 对话历史视图
  // ================================================================

  function renderHistoryView() {
    el.mainArea.innerHTML = `
      <section class="conv-panel">
        <div class="conv-panel-header">
          <input id="search-input" class="search-input" type="text" placeholder="搜索标题、项目名或对话内容..." />
        </div>
        <div class="conv-list" id="conv-list"></div>
      </section>
      <main class="detail-panel" id="detail-panel">
        <div class="empty-state"><p>从左侧选择一个对话</p></div>
      </main>
    `;

    const searchInput = document.getElementById('search-input');
    searchInput.value = state.search;
    searchInput.addEventListener('input', () => onSearchInput(searchInput.value));

    renderConvList();
    if (state.selectedSessionId && state.sessions.some((s) => s.sessionId === state.selectedSessionId)) {
      openSession(state.selectedSessionId);
    }
  }

  let searchDebounceTimer = null;
  let searchRequestId = 0;

  function onSearchInput(query) {
    state.search = query;
    renderConvList();

    clearTimeout(searchDebounceTimer);
    if (!query.trim()) {
      state.searchResults = null;
      return;
    }
    searchDebounceTimer = setTimeout(async () => {
      const myRequestId = ++searchRequestId;
      try {
        const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
        if (myRequestId !== searchRequestId || state.search !== query) return;
        state.searchResults = { query, results };
        renderConvList();
      } catch {
        // 搜索失败就静默忽略,继续用本地标题匹配的结果
      }
    }, 300);
  }

  function byLastTimestampDesc(a, b) {
    return (Date.parse(b.lastTimestamp || 0) || 0) - (Date.parse(a.lastTimestamp || 0) || 0);
  }

  function filteredSessions() {
    const q = state.search.trim().toLowerCase();
    const base = state.sessions.filter((s) => state.selectedProject === null || s.projectLabel === state.selectedProject);

    if (!q) {
      return base.sort(byLastTimestampDesc).map((s) => ({ session: s, snippet: null }));
    }

    if (state.searchResults && state.searchResults.query === state.search) {
      const matchMap = new Map(state.searchResults.results.map((r) => [r.sessionId, r]));
      return base
        .filter((s) => matchMap.has(s.sessionId))
        .sort(byLastTimestampDesc)
        .map((s) => ({ session: s, snippet: matchMap.get(s.sessionId).snippet }));
    }

    return base
      .filter((s) => s.title.toLowerCase().includes(q) || s.projectLabel.toLowerCase().includes(q))
      .sort(byLastTimestampDesc)
      .map((s) => ({ session: s, snippet: null }));
  }

  function highlightSnippet(snippet, query) {
    const escaped = escapeHtml(snippet);
    const q = query.trim();
    if (!q) return escaped;
    const idx = escaped.toLowerCase().indexOf(escapeHtml(q).toLowerCase());
    if (idx < 0) return escaped;
    return `${escaped.slice(0, idx)}<mark>${escaped.slice(idx, idx + q.length)}</mark>${escaped.slice(idx + q.length)}`;
  }

  function renderConvList() {
    const convList = document.getElementById('conv-list');
    if (!convList) return;

    const items = filteredSessions();
    if (items.length === 0) {
      convList.innerHTML = `<div class="empty-hint">没有匹配的会话</div>`;
      return;
    }
    convList.innerHTML = items
      .map(
        ({ session: s, snippet }) => `
      <div class="conv-item ${s.sessionId === state.selectedSessionId ? 'selected' : ''}" data-id="${s.sessionId}">
        <button class="conv-item-delete" data-id="${s.sessionId}" title="删除这个对话">✕</button>
        <div class="title">${escapeHtml(s.title)}</div>
        ${snippet ? `<div class="snippet">${highlightSnippet(snippet, state.search)}</div>` : ''}
        <div class="meta">
          <span>${state.selectedProject === null ? escapeHtml(s.projectLabel) + ' · ' : ''}${s.turnCount}轮</span>
          <span>${formatRelativeTime(s.lastTimestamp)}</span>
        </div>
      </div>`
      )
      .join('');

    convList.querySelectorAll('.conv-item').forEach((node) => {
      node.addEventListener('click', () => openSession(node.dataset.id));
    });
    convList.querySelectorAll('.conv-item-delete').forEach((node) => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const session = state.sessions.find((s) => s.sessionId === node.dataset.id);
        if (session) confirmDelete(session);
      });
    });
  }

  async function openSession(sessionId) {
    state.selectedSessionId = sessionId;
    renderConvList();

    const session = state.sessions.find((s) => s.sessionId === sessionId);
    const detailPanel = document.getElementById('detail-panel');
    if (!session || !detailPanel) return;

    detailPanel.innerHTML = `<div class="empty-state"><p>加载中...</p></div>`;

    let turns;
    try {
      turns = await api(`/api/sessions/${sessionId}/turns`);
    } catch (err) {
      if (state.selectedSessionId !== sessionId) return;
      const dp = document.getElementById('detail-panel');
      if (dp) dp.innerHTML = `<div class="empty-state"><p>加载失败: ${escapeHtml(err.message)}</p></div>`;
      return;
    }

    if (state.selectedSessionId !== sessionId || !document.getElementById('detail-panel')) return;
    renderDetail(session, turns);
  }

  function renderDetail(session, turns) {
    const detailPanel = document.getElementById('detail-panel');
    if (!detailPanel) return;

    detailPanel.innerHTML = `
      <div class="detail-header">
        <div class="title-block">
          <h1 id="detail-title" title="点击改名">${escapeHtml(session.title)}</h1>
          <div class="subtitle">${escapeHtml(session.projectLabel)} · ${formatAbsoluteDateTime(session.firstTimestamp)} ~ ${formatAbsoluteDateTime(session.lastTimestamp)}</div>
        </div>
        <div class="detail-actions">
          <button class="btn" id="btn-rules">Rules</button>
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
    document.getElementById('btn-rules').addEventListener('click', () => switchView('rules', session.projectLabel));
  }

  function renderMessageNode(turn) {
    const row = document.createElement('div');
    row.className = `msg-row ${turn.role}`;

    const content = document.createElement('div');
    content.className = 'msg-content';
    row.appendChild(content);

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = turn.role === 'user' ? '你' : 'Claude';
    content.appendChild(label);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = turn.text ? window.renderMarkdown(turn.text) : '<em>(空)</em>';
    content.appendChild(bubble);

    if (turn.tools && turn.tools.length > 0) {
      const chip = document.createElement('div');
      chip.className = 'tool-chip';
      chip.textContent = `↳ 调用工具: ${turn.tools.join(', ')}`;
      content.appendChild(chip);
    }

    return row;
  }

  // ---------- 改名 ----------

  function startRename(session) {
    const titleEl = document.getElementById('detail-title');
    if (!titleEl) return;
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
        if (state.view === 'history') {
          renderConvList();
          if (state.selectedSessionId === session.sessionId) openSession(session.sessionId);
        }
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
          const dp = document.getElementById('detail-panel');
          if (dp) dp.innerHTML = `<div class="empty-state"><p>从左侧选择一个对话</p></div>`;
        }
        renderSidebar();
        if (state.view === 'history') renderConvList();
        showToast(`已删除: ${session.title}`);
        closeModal();
      } catch (err) {
        showToast(`删除失败: ${err.message}`);
        closeModal();
      }
    });
  }

  // ================================================================
  // 用量仪表盘视图
  // ================================================================

  async function renderUsageView() {
    el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载中...</p></div>`;

    let data;
    try {
      data = await api('/api/usage');
    } catch (err) {
      el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载失败: ${escapeHtml(err.message)}</p></div>`;
      return;
    }
    if (state.view !== 'usage') return;

    const fmtNum = (n) => Math.round(n).toLocaleString('zh-CN');
    const fmtCost = (n) => `$${n.toFixed(2)}`;
    const totalTokens = data.totals.input + data.totals.output + data.totals.cacheWrite + data.totals.cacheRead;

    const maxDayCost = Math.max(1, ...data.byDay.map((d) => d.cost));
    const barChart = data.byDay
      .map(
        (d) => `
      <div class="bar-col" title="${escapeAttr(d.day)}: ${fmtCost(d.cost)}">
        <div class="bar" style="height:${Math.max(2, (d.cost / maxDayCost) * 100)}%"></div>
        <div class="bar-label">${escapeHtml(d.day.slice(5))}</div>
      </div>`
      )
      .join('');

    const rankRows = (list, keyName) => {
      const max = Math.max(1, ...list.map((r) => r.cost));
      return list
        .map(
          (r) => `
        <div class="rank-row">
          <div class="rank-name" title="${escapeAttr(r[keyName])}">${escapeHtml(r[keyName])}</div>
          <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${(r.cost / max) * 100}%"></div></div>
          <div class="rank-value">${fmtCost(r.cost)}</div>
        </div>`
        )
        .join('');
    };

    el.mainArea.innerHTML = `
      <div class="wide-panel">
        <h1>用量仪表盘</h1>
        <p class="page-subtitle">统计范围:本机 ~/.claude/projects 下的全部历史会话</p>

        <div class="stat-cards">
          <div class="stat-card"><div class="value">${fmtCost(data.totals.cost)}</div><div class="label">预估总费用</div></div>
          <div class="stat-card"><div class="value">${fmtNum(totalTokens)}</div><div class="label">总 token 数</div></div>
          <div class="stat-card"><div class="value">${fmtNum(data.totals.input + data.totals.output)}</div><div class="label">输入 + 输出 token</div></div>
          <div class="stat-card"><div class="value">${fmtNum(data.totals.messageCount)}</div><div class="label">AI 回复消息数</div></div>
        </div>

        <div class="section-title">每日预估费用</div>
        ${data.byDay.length ? `<div class="bar-chart">${barChart}</div>` : '<p class="manage-empty">暂无数据</p>'}

        <div class="section-title">按项目排行</div>
        <div class="rank-list">${data.byProject.length ? rankRows(data.byProject, 'projectLabel') : '<p class="manage-empty">暂无数据</p>'}</div>

        <div class="section-title">按模型排行</div>
        <div class="rank-list">${data.byModel.length ? rankRows(data.byModel, 'model') : '<p class="manage-empty">暂无数据</p>'}</div>

        <p class="disclaimer">* 费用为按公开定价估算,可能与实际账单存在出入(尤其是新模型或缓存计费规则变化时),仅供参考。</p>
      </div>
    `;
  }

  // ================================================================
  // Skills 管理视图
  // ================================================================

  async function renderSkillsView() {
    el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载中...</p></div>`;

    let data;
    try {
      data = await api('/api/skills');
    } catch (err) {
      el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载失败: ${escapeHtml(err.message)}</p></div>`;
      return;
    }
    if (state.view !== 'skills') return;
    state.skills = data;

    el.mainArea.innerHTML = `
      <div class="wide-panel">
        <h1>Skills 管理</h1>
        <p class="page-subtitle">个人 skill 可以直接编辑;插件自带的 skill 是只读参考,不允许在这里改</p>
        <div class="manage-layout">
          <div class="manage-list" id="skills-list"></div>
          <div class="manage-detail" id="skills-detail">
            <p class="manage-empty">从左侧选择一个 skill</p>
          </div>
        </div>
      </div>
    `;

    const skillItemHtml = (s) => `
      <div class="manage-list-item ${state.selectedSkillPath === s.filePath ? 'selected' : ''}" data-path="${escapeAttr(s.filePath)}">
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="desc">${escapeHtml(s.description)}</div>
        ${!s.editable ? `<span class="readonly-badge">只读 · ${escapeHtml(s.plugin || '')}</span>` : ''}
      </div>`;

    const listEl = document.getElementById('skills-list');
    listEl.innerHTML = `
      <div class="manage-group-title">我的 Skills(${data.personal.length})</div>
      ${data.personal.map(skillItemHtml).join('') || '<p class="manage-empty">还没有个人 skill</p>'}
      <div class="manage-group-title">插件 Skills(${data.plugins.length})</div>
      ${data.plugins.map(skillItemHtml).join('')}
    `;

    const allSkills = [...data.personal, ...data.plugins];
    listEl.querySelectorAll('.manage-list-item').forEach((node) => {
      node.addEventListener('click', () => openSkillDetail(node.dataset.path, allSkills));
    });
  }

  async function openSkillDetail(filePath, allSkills) {
    state.selectedSkillPath = filePath;
    document.querySelectorAll('#skills-list .manage-list-item').forEach((n) => {
      n.classList.toggle('selected', n.dataset.path === filePath);
    });

    const skill = allSkills.find((s) => s.filePath === filePath);
    const detailEl = document.getElementById('skills-detail');
    if (!skill || !detailEl) return;

    detailEl.innerHTML = `<p class="manage-empty">加载中...</p>`;

    let content;
    try {
      const r = await api(`/api/skills/content?path=${encodeURIComponent(filePath)}`);
      content = r.content;
    } catch (err) {
      if (state.selectedSkillPath !== filePath) return;
      const de = document.getElementById('skills-detail');
      if (de) de.innerHTML = `<p class="manage-empty">加载失败: ${escapeHtml(err.message)}</p>`;
      return;
    }
    if (state.selectedSkillPath !== filePath) return;

    const de = document.getElementById('skills-detail');
    if (!de) return;
    de.innerHTML = `
      <div class="manage-detail-header">
        <h2>${escapeHtml(skill.name)}</h2>
        ${skill.editable ? `<button class="btn primary" id="skill-save">保存</button>` : `<span class="readonly-badge">只读</span>`}
      </div>
      <textarea class="manage-editor" id="skill-editor" ${skill.editable ? '' : 'readonly'}>${escapeHtml(content)}</textarea>
    `;

    if (skill.editable) {
      document.getElementById('skill-save').addEventListener('click', async () => {
        const newContent = document.getElementById('skill-editor').value;
        try {
          await api('/api/skills/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: newContent }),
          });
          showToast('已保存');
        } catch (err) {
          showToast(`保存失败: ${err.message}`);
        }
      });
    }
  }

  // ================================================================
  // Rules 管理视图
  // ================================================================

  async function renderRulesView() {
    el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载中...</p></div>`;

    const projectParam = state.selectedProject ? `?project=${encodeURIComponent(state.selectedProject)}` : '';
    let data;
    try {
      data = await api(`/api/rules${projectParam}`);
    } catch (err) {
      el.mainArea.innerHTML = `<div class="wide-panel"><p class="manage-empty">加载失败: ${escapeHtml(err.message)}</p></div>`;
      return;
    }
    if (state.view !== 'rules') return;

    const files = [];
    if (data.global) files.push({ ...data.global, title: '全局 CLAUDE.md', scope: '全局' });
    data.projectFiles.forEach((f, i) =>
      files.push({ ...f, title: data.projectFiles.length > 1 ? `项目 CLAUDE.md #${i + 1}` : '项目 CLAUDE.md', scope: '项目' })
    );
    data.rulesFiles.forEach((f) =>
      files.push({ ...f, title: f.filePath.split(/[\\/]/).pop(), scope: f.scope })
    );

    const subtitle = state.selectedProject
      ? `当前项目:${escapeHtml(state.selectedProject)}`
      : '未选择项目,只显示全局 CLAUDE.md —— 在左侧选一个项目可以看到项目级规则';

    el.mainArea.innerHTML = `
      <div class="wide-panel">
        <h1>Rules 管理</h1>
        <p class="page-subtitle">${subtitle}</p>
        <div id="rules-files"></div>
      </div>
    `;

    const container = document.getElementById('rules-files');
    if (files.length === 0) {
      container.innerHTML = `<p class="manage-empty">没有找到任何规则文件</p>`;
      return;
    }

    container.innerHTML = files
      .map(
        (f) => `
      <div class="file-card">
        <div class="file-card-header">
          <span class="file-card-title">${escapeHtml(f.title)}</span>
          <span class="file-card-scope">${escapeHtml(f.scope)}</span>
        </div>
        <div class="file-card-path">${escapeHtml(f.filePath)}</div>
        <textarea class="manage-editor" data-path="${escapeAttr(f.filePath)}">${escapeHtml(f.content)}</textarea>
        <div class="modal-actions">
          <button class="btn primary rules-save">保存</button>
        </div>
      </div>`
      )
      .join('');

    container.querySelectorAll('.file-card').forEach((card) => {
      const textarea = card.querySelector('.manage-editor');
      const btn = card.querySelector('.rules-save');
      btn.addEventListener('click', async () => {
        try {
          await api('/api/rules', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: textarea.dataset.path, content: textarea.value }),
          });
          showToast('已保存');
        } catch (err) {
          showToast(`保存失败: ${err.message}`);
        }
      });
    });
  }

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
        if (state.view === 'history') {
          renderConvList();
          if (state.selectedSessionId === event.session.sessionId) {
            const titleEl = document.getElementById('detail-title');
            if (titleEl) titleEl.textContent = event.session.title;
          }
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

  renderHistoryView();
  fetchSessions();
  connectEvents();
})();
