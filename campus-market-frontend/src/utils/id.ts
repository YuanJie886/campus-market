/**
 * 唯一 id 生成工具。
 * 优先使用 crypto.randomUUID，降级为时间戳 + 随机串。
 */

export function uid(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`;
}

/** 判断浏览器是否支持原生 randomUUID */
export function safeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return uid('uuid');
}
