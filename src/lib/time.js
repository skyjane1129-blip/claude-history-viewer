export function formatRelativeTime(isoString) {
  if (!isoString) return '未知时间';
  const then = Date.parse(isoString);
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

export function formatAbsoluteDate(msOrIso) {
  const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatAbsoluteDateTime(msOrIso) {
  const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
