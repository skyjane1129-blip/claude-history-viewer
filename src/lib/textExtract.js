// Claude Code 的 .jsonl 会话记录里,"user" 类型的记录既可能是真人打的字,
// 也可能是工具调用结果被回填进对话(message.content 里是 tool_result 块)。
// 这里的函数负责把两者区分开,并把系统注入的 <xxx>...</xxx> 包裹文本(如 <system-reminder>)
// 从"人说的话"里过滤掉,尽量还原真实输入的内容。

// 有些消息块不是"单个标签整体包裹",而是好几个 <tag>...</tag> 首尾相接拼在一起
// (比如 <local-command-caveat>...</local-command-caveat>\n<command-name>...</command-name>)。
// 反复从头剥掉一个完整标签块,如果最终能剥干净,说明整段都是系统注入文本,没有真人输入。
function isSyntheticWrapper(text) {
  if (typeof text !== 'string') return false;
  let rest = text.trim();
  if (!rest) return false;
  const tagBlock = /^<([a-zA-Z][\w-]*)>[\s\S]*?<\/\1>\s*/;
  let strippedAny = false;
  while (true) {
    const m = rest.match(tagBlock);
    if (!m) break;
    rest = rest.slice(m[0].length);
    strippedAny = true;
  }
  return strippedAny && rest.length === 0;
}

function isToolResultOnly(content) {
  return Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');
}

function extractCommandLabel(text) {
  const m = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  return m ? m[1].trim() : null;
}

function cleanPlainText(text) {
  if (!isSyntheticWrapper(text)) return text;
  const label = extractCommandLabel(text);
  return label ? `/${label.replace(/^\//, '')}` : '(斜杠命令)';
}

export function extractHumanText(content) {
  if (typeof content === 'string') return cleanPlainText(content);
  if (!Array.isArray(content)) return '';
  const textBlocks = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (textBlocks.length === 0) return '';
  const real = textBlocks.filter((b) => !isSyntheticWrapper(b.text));
  if (real.length > 0) {
    return real
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  // 整轮都是系统包裹文本(比如只运行了一个斜杠命令,没有额外输入),
  // 尝试把 <command-name> 里的命令名抽出来,比原始标签汤更可读。
  for (const b of textBlocks) {
    const label = extractCommandLabel(b.text);
    if (label) return `/${label.replace(/^\//, '')}`;
  }
  return '(斜杠命令)';
}

export function isGenuineUserTurn(record) {
  if (record.type !== 'user' || record.isSidechain) return false;
  const content = record.message && record.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    if (isToolResultOnly(content)) return false;
    return extractHumanText(content).length > 0;
  }
  return false;
}

export function extractAssistantTurn(record) {
  const content = record.message && record.message.content;
  if (typeof content === 'string') return { text: content, tools: [] };
  if (!Array.isArray(content)) return { text: '', tools: [] };
  const text = content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const tools = content.filter((b) => b && b.type === 'tool_use' && b.name).map((b) => b.name);
  return { text, tools };
}
