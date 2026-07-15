import { displayWidth, wrapText } from './textWidth.js';

// 把一个会话的 turns(user/assistant 交替)展开成终端要显示的一行行文本,
// 并按终端宽度提前折好行 —— 这样上层滚动逻辑只需要按"行数"做加减,不用关心换行细节。
//
// 正文默认不上色,交给终端自己的前景色显示;只有"你: "前缀用颜色区分说话人。
// 用户提问那几行额外加灰色背景块,同时把正文改成亮白色,保证在灰底上依然清晰可读。
//
// 除了逐行文本,还顺带收集一份大纲(outline):每一轮"你提的问题"对应它在 lines
// 数组里的起始行号 + 一句预览文字,供详情页的目录跳转功能使用。
export function buildDisplayLines(turns, width) {
  const lines = [];
  const outline = [];
  for (const turn of turns) {
    const isUser = turn.role === 'user';
    const prefix = isUser ? '你: ' : 'Claude: ';
    const prefixColor = isUser ? 'blue' : '#ff69b4';
    const bg = isUser ? 'gray' : undefined;
    const bodyColor = isUser ? '#ffffff' : undefined;
    const indent = ' '.repeat(displayWidth(prefix));
    const bodyWidth = Math.max(10, width - displayWidth(prefix));
    const text = turn.text && turn.text.trim().length > 0 ? turn.text.trim() : '';
    const wrapped = text ? wrapText(text, bodyWidth) : [];

    if (isUser) {
      outline.push({
        lineIndex: lines.length,
        preview: text.replace(/\s+/g, ' ').trim() || '(空)',
      });
    }

    if (wrapped.length === 0) {
      lines.push({ prefix: prefix.trimEnd(), prefixColor, body: '', bg, bodyColor });
    } else {
      wrapped.forEach((w, i) => {
        lines.push(
          i === 0
            ? { prefix, prefixColor, body: w, bg, bodyColor }
            : { prefix: indent, body: w, bg, bodyColor }
        );
      });
    }

    if (turn.tools && turn.tools.length > 0) {
      lines.push({ prefix: indent, body: `↳ 调用工具: ${turn.tools.join(', ')}`, dim: true });
    }
    lines.push({ prefix: '', body: '' });
  }
  return { lines, outline };
}
