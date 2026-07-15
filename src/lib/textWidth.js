// 终端里中文/全角字符占 2 列宽,英文/数字占 1 列宽,
// 直接用字符串 length 来做换行/截断会在中文场景下算错宽度,所以单独实现按显示宽度计算。

function charWidth(ch) {
  const code = ch.codePointAt(0);
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return isWide ? 2 : 1;
}

export function displayWidth(str) {
  let w = 0;
  for (const ch of str) w += charWidth(ch);
  return w;
}

export function truncateToWidth(str, maxWidth) {
  if (displayWidth(str) <= maxWidth) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = charWidth(ch);
    if (w + cw > maxWidth - 1) return out + '…';
    out += ch;
    w += cw;
  }
  return out;
}

// 按显示宽度折行,一个字符一个字符地累加,超宽就换行；
// 不做英文单词边界折行(简单粗暴但对中英混排更稳)。
function wrapSingleLine(line, maxWidth) {
  if (displayWidth(line) <= maxWidth) return [line];
  const out = [];
  let cur = '';
  let curWidth = 0;
  for (const ch of line) {
    const w = charWidth(ch);
    if (curWidth + w > maxWidth) {
      out.push(cur);
      cur = ch;
      curWidth = w;
    } else {
      cur += ch;
      curWidth += w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function wrapText(text, maxWidth) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) out.push(...wrapSingleLine(line, Math.max(1, maxWidth)));
  return out;
}
