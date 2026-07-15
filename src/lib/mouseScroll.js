import { useEffect, useRef } from 'react';

// 终端鼠标上报协议(SGR 扩展模式, mode 1000 + 1006):滚轮事件会以
// ESC [ < 64 ; col ; row M   (向上滚)
// ESC [ < 65 ; col ; row M   (向下滚)
// 这样的转义序列从 stdin 发过来,普通的 useInput 键盘监听不会解析它,
// 所以要单独在 stdin 的原始数据流里用正则把这段序列摘出来。
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;
const MOUSE_SEQ = /\x1b\[<(\d+);\d+;\d+[Mm]/g;
const ENABLE = '\x1b[?1000h\x1b[?1006h';
const DISABLE = '\x1b[?1000l\x1b[?1006l';

// 多个视图(列表页/详情页)可能先后挂载,用引用计数确保只在"最外层"
// 开启一次上报、最后一个视图卸载时才关闭,避免重复写控制码。
let refCount = 0;

function enable() {
  if (refCount === 0) process.stdout.write(ENABLE);
  refCount += 1;
}

function disable() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) process.stdout.write(DISABLE);
}

// 进程退出时兜底关闭鼠标上报,否则程序意外退出后终端会卡在"鼠标模式"里,
// 用户在 shell 里正常点击/框选文字会失效,得手动关一次很难排查。
let exitHookInstalled = false;
function ensureExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    if (refCount > 0) process.stdout.write(DISABLE);
  });
}

export function useMouseScroll(onScrollUp, onScrollDown) {
  const upRef = useRef(onScrollUp);
  const downRef = useRef(onScrollDown);
  upRef.current = onScrollUp;
  downRef.current = onScrollDown;

  useEffect(() => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return undefined;

    ensureExitHook();
    enable();

    const onData = (chunk) => {
      const str = chunk.toString('utf8');
      MOUSE_SEQ.lastIndex = 0;
      let match;
      while ((match = MOUSE_SEQ.exec(str))) {
        const code = Number(match[1]);
        if (code === WHEEL_UP) upRef.current();
        else if (code === WHEEL_DOWN) downRef.current();
      }
    };
    stdin.on('data', onData);

    return () => {
      stdin.off('data', onData);
      disable();
    };
  }, []);
}
