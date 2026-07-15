import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { scanAllSessions, loadSessionTurns, deleteSession, findLiveJobForSession } from '../lib/sessions.js';
import { setCustomTitle } from '../lib/titles.js';
import { formatRelativeTime, formatAbsoluteDateTime } from '../lib/time.js';
import { truncateToWidth, displayWidth, wrapText } from '../lib/textWidth.js';
import { buildDisplayLines } from '../lib/renderTurns.js';
import { useMouseScroll } from '../lib/mouseScroll.js';
import { readGlobalClaudeMd, findProjectClaudeMdFiles } from '../lib/claudeMd.js';

const e = React.createElement;

const PROJECT_COL = 16;
const TIME_COL = 11;
const TURNS_COL = 6;

function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
  });
  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);
  return size;
}

function padToWidth(str, width) {
  const w = displayWidth(str);
  return w >= width ? str : str + ' '.repeat(width - w);
}

function ListRow({ session, selected, columns }) {
  const titleWidth = Math.max(10, columns - PROJECT_COL - TIME_COL - TURNS_COL - 4);
  const project = padToWidth(truncateToWidth(session.projectLabel, PROJECT_COL - 1), PROJECT_COL);
  const title = padToWidth(truncateToWidth(session.title, titleWidth - 1), titleWidth);
  const time = padToWidth(formatRelativeTime(session.lastTimestamp), TIME_COL);
  const turns = padToWidth(`${session.turnCount}轮`, TURNS_COL);

  return e(
    Text,
    { backgroundColor: selected ? 'blue' : undefined, color: selected ? 'white' : undefined },
    selected ? '› ' : '  ',
    e(Text, { color: selected ? undefined : 'yellow' }, project),
    title,
    e(Text, { color: selected ? undefined : 'gray' }, time),
    e(Text, { color: selected ? undefined : 'gray' }, turns)
  );
}

function ListView({ sessions, error, scanning, onOpen, onDeleted, onOpenMemory, onRenamed }) {
  const { columns, rows } = useTerminalSize();
  const { exit } = useApp();
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameText, setRenameText] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.projectLabel.toLowerCase().includes(q)
    );
  }, [sessions, search]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const visibleRows = Math.max(3, rows - 8);
  const windowStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleRows / 2),
      Math.max(0, filtered.length - visibleRows)
    )
  );
  const windowRows = filtered.slice(windowStart, windowStart + visibleRows);

  useInput(
    (input, key) => {
      if (confirmDelete) {
        if (input === 'y') {
          deleteSession(confirmDelete.filePath)
            .then(() => {
              setStatus(`已删除:${confirmDelete.title}`);
              setConfirmDelete(null);
              onDeleted(confirmDelete.filePath);
            })
            .catch((err) => {
              setStatus(`删除失败:${err && err.message ? err.message : err}`);
              setConfirmDelete(null);
            });
        } else if (input === 'n' || key.escape) {
          setConfirmDelete(null);
        }
        return;
      }

      if (renaming) {
        if (key.escape) {
          setRenaming(null);
        } else if (key.return) {
          const newTitle = renameText.trim();
          setCustomTitle(renaming.sessionId, newTitle);
          onRenamed(renaming.sessionId, newTitle || renaming.autoTitle);
          setStatus(newTitle ? `已改名:${newTitle}` : `已恢复默认标题:${renaming.autoTitle}`);
          setRenaming(null);
        }
        return;
      }

      if (searchMode) {
        if (key.escape || key.return) setSearchMode(false);
        return;
      }

      if (key.downArrow || input === 'j') {
        setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (key.upArrow || input === 'k') {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.return) {
        if (filtered[selectedIndex]) onOpen(filtered[selectedIndex]);
      } else if (input === '/') {
        setSearchMode(true);
        setStatus('');
      } else if (input === 'd') {
        const session = filtered[selectedIndex];
        if (session) {
          setConfirmDelete(session);
          findLiveJobForSession(session.sessionId).then((liveJob) => {
            setConfirmDelete((cur) => (cur && cur.filePath === session.filePath ? { ...cur, liveJob } : cur));
          });
        }
      } else if (input === 'e') {
        if (filtered[selectedIndex]) {
          setRenaming(filtered[selectedIndex]);
          setRenameText(filtered[selectedIndex].title);
        }
      } else if (input === 'm') {
        if (filtered[selectedIndex]) onOpenMemory(filtered[selectedIndex]);
      } else if (input === 'r') {
        setStatus('');
        onDeleted(null); // 触发外层重新扫描,不删除任何文件
      } else if (input === 'q') {
        exit();
      }
    },
    { isActive: true }
  );

  useMouseScroll(
    () => {
      if (confirmDelete || renaming || searchMode) return;
      setSelectedIndex((i) => Math.max(0, i - 1));
    },
    () => {
      if (confirmDelete || renaming || searchMode) return;
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
    }
  );

  const header = e(
    Box,
    { flexDirection: 'column' },
    e(Text, { bold: true, color: 'cyan' }, 'Claude 历史对话浏览器'),
    e(
      Text,
      { color: 'gray' },
      sessions === null
        ? '正在扫描 ~/.claude/projects ...'
        : `共 ${sessions.length} 个会话${search ? `，筛选出 ${filtered.length} 个` : ''}${scanning ? '（正在刷新...）' : ''}`
    )
  );

  const searchBar = e(
    Box,
    { borderStyle: searchMode ? 'round' : undefined, borderColor: 'blue' },
    e(Text, { color: 'blue' }, '🔍 '),
    searchMode
      ? e(TextInput, { value: search, onChange: setSearch })
      : e(Text, { color: search ? 'white' : 'gray' }, search || '按 / 搜索标题或项目名')
  );

  const list =
    sessions === null
      ? e(Text, { color: 'gray' }, '加载中...')
      : filtered.length === 0
        ? e(Text, { color: 'gray' }, '没有匹配的会话')
        : e(
            Box,
            { flexDirection: 'column' },
            ...windowRows.map((s, idx) =>
              e(ListRow, {
                key: s.filePath,
                session: s,
                selected: windowStart + idx === selectedIndex,
                columns,
              })
            )
          );

  const footer = confirmDelete
    ? e(
        Box,
        { borderStyle: 'round', borderColor: 'red', flexDirection: 'column' },
        confirmDelete.liveJob
          ? e(
              Text,
              { color: 'red' },
              `⚠ 这个会话对应的 Claude 进程还在运行(pid ${confirmDelete.liveJob.pid}${
                confirmDelete.liveJob.jobId ? `,job ${confirmDelete.liveJob.jobId}` : ''
              })。现在删除后,只要它再写一条新消息,文件就会被自动重新创建,等于没删掉——建议先结束那个终端/任务。`
            )
          : confirmDelete.liveJob === undefined
            ? e(Text, { color: 'gray' }, '正在检测该会话是否仍在运行...')
            : null,
        e(Text, { color: 'red' }, `确定删除会话《${confirmDelete.title}》吗？此操作不可恢复。`),
        e(Text, { color: 'gray' }, 'y 确认删除   n / Esc 取消')
      )
    : renaming
      ? e(
          Box,
          { borderStyle: 'round', borderColor: 'green', flexDirection: 'column' },
          e(
            Box,
            null,
            e(Text, { color: 'green' }, '新标题: '),
            e(TextInput, { value: renameText, onChange: setRenameText })
          ),
          e(Text, { color: 'gray' }, 'Enter 保存(留空则恢复默认标题)   Esc 取消')
        )
      : e(
          Text,
          { color: 'gray' },
          status || '↑↓/jk 选择   Enter 打开   / 搜索   d 删除   e 改名   m 查看CLAUDE.md   r 刷新   q 退出'
        );

  return e(
    Box,
    { flexDirection: 'column' },
    header,
    searchBar,
    error ? e(Text, { color: 'red' }, `扫描出错: ${error}`) : list,
    footer
  );
}

function MemoryView({ session, onBack }) {
  const { columns, rows } = useTerminalSize();
  const [data, setData] = useState(null);
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setScroll(0);
    // 读文件是同步 IO,包一层 Promise.resolve 丢到下一个 tick,避免阻塞首帧渲染。
    Promise.resolve().then(() => {
      const global = readGlobalClaudeMd();
      const projectFiles = findProjectClaudeMdFiles(session.cwd);
      if (!cancelled) setData({ global, projectFiles });
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const lines = useMemo(() => {
    if (!data) return [];
    const width = Math.max(20, columns - 2);
    const out = [];

    const pushSection = (title, fileInfo) => {
      out.push({ text: title, color: 'yellow', bold: true });
      if (!fileInfo) {
        out.push({ text: '  (未找到该文件)', color: 'gray', dim: true });
      } else {
        out.push({ text: `  路径: ${fileInfo.filePath}`, color: 'gray', dim: true });
        out.push({ text: '' });
        for (const bodyLine of fileInfo.content.split('\n')) {
          for (const w of wrapText(bodyLine, width)) out.push({ text: w });
        }
      }
      out.push({ text: '' });
    };

    pushSection('=== 全局 CLAUDE.md (~/.claude/CLAUDE.md) ===', data.global);

    if (data.projectFiles.length === 0) {
      out.push({ text: `=== 项目 CLAUDE.md · ${session.projectLabel} ===`, color: 'yellow', bold: true });
      out.push({ text: '  (未找到项目级 CLAUDE.md)', color: 'gray', dim: true });
      out.push({ text: '' });
    } else {
      data.projectFiles.forEach((f, idx) => {
        const label =
          data.projectFiles.length > 1
            ? `=== 项目 CLAUDE.md #${idx + 1} · ${session.projectLabel} ===`
            : `=== 项目 CLAUDE.md · ${session.projectLabel} ===`;
        pushSection(label, f);
      });
    }
    return out;
  }, [data, columns, session]);

  const visibleBodyRows = Math.max(3, rows - 6);
  const maxScroll = Math.max(0, lines.length - visibleBodyRows);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visible = lines.slice(clampedScroll, clampedScroll + visibleBodyRows);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q' || key.backspace || key.delete) {
        onBack();
      } else if (key.downArrow || input === 'j') {
        setScroll((s) => Math.min(maxScroll, s + 1));
      } else if (key.upArrow || input === 'k') {
        setScroll((s) => Math.max(0, s - 1));
      } else if (key.pageDown || (key.ctrl && input === 'd')) {
        setScroll((s) => Math.min(maxScroll, s + visibleBodyRows));
      } else if (key.pageUp || (key.ctrl && input === 'u')) {
        setScroll((s) => Math.max(0, s - visibleBodyRows));
      } else if (input === 'g') {
        setScroll(0);
      } else if (input === 'G') {
        setScroll(maxScroll);
      }
    },
    { isActive: true }
  );

  useMouseScroll(
    () => setScroll((s) => Math.max(0, s - 3)),
    () => setScroll((s) => Math.min(maxScroll, s + 3))
  );

  const header = e(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'yellow' },
    e(Text, { bold: true, color: 'yellow' }, `CLAUDE.md 查看器 · ${session.projectLabel}`)
  );

  const body =
    data === null
      ? e(Text, { color: 'gray' }, '加载中...')
      : e(
          Box,
          { flexDirection: 'column' },
          ...visible.map((l, idx) =>
            e(Text, { key: idx, color: l.color, bold: l.bold, dimColor: l.dim }, l.text || ' ')
          )
        );

  const footer = e(
    Text,
    { color: 'gray' },
    `第 ${lines.length === 0 ? 0 : clampedScroll + 1}-${Math.min(lines.length, clampedScroll + visibleBodyRows)} / ${lines.length} 行   ↑↓/jk 滚动   PgUp/PgDn 翻页   g/G 顶/底   Esc/q 返回`
  );

  return e(Box, { flexDirection: 'column' }, header, body, footer);
}

function DetailView({ session, onBack }) {
  const { columns, rows } = useTerminalSize();
  const [turns, setTurns] = useState(null);
  const [scroll, setScroll] = useState(0);
  const [showOutline, setShowOutline] = useState(false);
  const [outlineIndex, setOutlineIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTurns(null);
    setScroll(0);
    setShowOutline(false);
    loadSessionTurns(session.filePath).then((t) => {
      if (!cancelled) setTurns(t);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const { lines, outline } = useMemo(() => {
    if (!turns) return { lines: [], outline: [] };
    return buildDisplayLines(turns, Math.max(20, columns - 2));
  }, [turns, columns]);

  const visibleBodyRows = Math.max(3, rows - 6);
  const maxScroll = Math.max(0, lines.length - visibleBodyRows);
  const clampedScroll = Math.min(scroll, maxScroll);
  const visible = lines.slice(clampedScroll, clampedScroll + visibleBodyRows);

  useInput(
    (input, key) => {
      if (showOutline) {
        if (key.escape || input === 'q' || input === 'o') {
          setShowOutline(false);
        } else if (key.return) {
          const entry = outline[outlineIndex];
          if (entry) setScroll(entry.lineIndex);
          setShowOutline(false);
        } else if (key.downArrow || input === 'j') {
          setOutlineIndex((i) => Math.min(outline.length - 1, i + 1));
        } else if (key.upArrow || input === 'k') {
          setOutlineIndex((i) => Math.max(0, i - 1));
        }
        return;
      }

      if (key.escape || input === 'q' || key.backspace || key.delete) {
        onBack();
      } else if (key.downArrow || input === 'j') {
        setScroll((s) => Math.min(maxScroll, s + 1));
      } else if (key.upArrow || input === 'k') {
        setScroll((s) => Math.max(0, s - 1));
      } else if (key.pageDown || (key.ctrl && input === 'd')) {
        setScroll((s) => Math.min(maxScroll, s + visibleBodyRows));
      } else if (key.pageUp || (key.ctrl && input === 'u')) {
        setScroll((s) => Math.max(0, s - visibleBodyRows));
      } else if (input === 'g') {
        setScroll(0);
      } else if (input === 'G') {
        setScroll(maxScroll);
      } else if (input === 'o') {
        if (outline.length > 0) {
          let idx = 0;
          for (let i = 0; i < outline.length; i++) {
            if (outline[i].lineIndex <= clampedScroll) idx = i;
          }
          setOutlineIndex(idx);
          setShowOutline(true);
        }
      }
    },
    { isActive: true }
  );

  useMouseScroll(
    () => {
      if (showOutline) {
        setOutlineIndex((i) => Math.max(0, i - 1));
        return;
      }
      setScroll((s) => Math.max(0, s - 3));
    },
    () => {
      if (showOutline) {
        setOutlineIndex((i) => Math.min(outline.length - 1, i + 1));
        return;
      }
      setScroll((s) => Math.min(maxScroll, s + 3));
    }
  );

  const header = e(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan' },
    e(Text, { bold: true, color: 'cyan' }, session.title),
    e(
      Text,
      { color: 'gray' },
      `项目: ${session.projectLabel}   ${formatAbsoluteDateTime(session.firstTimestamp)} ~ ${formatAbsoluteDateTime(session.lastTimestamp)}`
    )
  );

  const outlineVisibleRows = Math.max(3, rows - 8);
  const outlineWindowStart = Math.max(
    0,
    Math.min(
      outlineIndex - Math.floor(outlineVisibleRows / 2),
      Math.max(0, outline.length - outlineVisibleRows)
    )
  );
  const outlineWindowRows = outline.slice(outlineWindowStart, outlineWindowStart + outlineVisibleRows);
  const outlineTitleWidth = Math.max(10, columns - 10);

  const outlineView = e(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'yellow' },
    e(Text, { bold: true, color: 'yellow' }, `目录 · 共 ${outline.length} 轮提问`),
    outline.length === 0
      ? e(Text, { color: 'gray' }, '这段对话里没有找到你的提问')
      : e(
          Box,
          { flexDirection: 'column' },
          ...outlineWindowRows.map((entry, i) => {
            const idx = outlineWindowStart + i;
            const selected = idx === outlineIndex;
            return e(
              Text,
              {
                key: idx,
                backgroundColor: selected ? 'blue' : undefined,
                color: selected ? 'white' : undefined,
              },
              `${selected ? '› ' : '  '}${idx + 1}. ${truncateToWidth(entry.preview, outlineTitleWidth)}`
            );
          })
        )
  );

  const body =
    turns === null
      ? e(Text, { color: 'gray' }, '加载中...')
      : showOutline
        ? outlineView
        : e(
            Box,
            { flexDirection: 'column' },
            ...visible.map((l, idx) =>
              e(
                Text,
                { key: idx, dimColor: l.dim, backgroundColor: l.bg },
                l.prefix
                  ? e(Text, { color: l.prefixColor, bold: !l.dim, backgroundColor: l.bg }, l.prefix)
                  : null,
                e(
                  Text,
                  { color: l.bodyColor, backgroundColor: l.bg },
                  l.body || (l.prefix ? '' : ' ')
                )
              )
            )
          );

  const footer = showOutline
    ? e(Text, { color: 'gray' }, '↑↓/jk 选择   Enter 跳转   Esc/o/q 关闭目录')
    : e(
        Text,
        { color: 'gray' },
        `第 ${lines.length === 0 ? 0 : clampedScroll + 1}-${Math.min(lines.length, clampedScroll + visibleBodyRows)} / ${lines.length} 行   ↑↓/jk 滚动   PgUp/PgDn 翻页   g/G 顶/底   o 目录   Esc/q 返回`
      );

  return e(Box, { flexDirection: 'column' }, header, body, footer);
}

export default function App() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scanning, setScanning] = useState(true);
  const [view, setView] = useState('list');
  const [activeSession, setActiveSession] = useState(null);
  const { exit } = useApp();

  useEffect(() => {
    let cancelled = false;
    setScanning(true);
    scanAllSessions()
      .then((list) => {
        if (!cancelled) {
          setSessions(list);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err && err.message ? err.message : err));
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
  });

  function handleOpen(session) {
    setActiveSession(session);
    setView('detail');
  }

  function handleOpenMemory(session) {
    setActiveSession(session);
    setView('memory');
  }

  function handleDeleted(deletedFilePath) {
    if (deletedFilePath) {
      setSessions((prev) => (prev ? prev.filter((s) => s.filePath !== deletedFilePath) : prev));
    } else {
      setRefreshKey((k) => k + 1);
    }
  }

  function handleRenamed(sessionId, newTitle) {
    setSessions((prev) =>
      prev
        ? prev.map((s) =>
            s.sessionId === sessionId
              ? { ...s, title: newTitle, isCustomTitle: newTitle !== s.autoTitle }
              : s
          )
        : prev
    );
  }

  if (view === 'detail' && activeSession) {
    return e(DetailView, {
      session: activeSession,
      onBack: () => setView('list'),
    });
  }

  if (view === 'memory' && activeSession) {
    return e(MemoryView, {
      session: activeSession,
      onBack: () => setView('list'),
    });
  }

  return e(ListView, {
    sessions,
    error,
    scanning,
    onOpen: handleOpen,
    onDeleted: handleDeleted,
    onOpenMemory: handleOpenMemory,
    onRenamed: handleRenamed,
  });
}
