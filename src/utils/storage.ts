/**
 * localStorage 读写工具。
 * 所有 key 统一加前缀 `campus_market_`，避免污染同域其他数据。
 */

export const STORAGE_PREFIX = 'campus_market_';

/** 带前缀的完整 key */
export function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

/** 读取并反序列化；失败时返回兜底值 */
export function loadState<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw === null || raw === undefined) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[storage] 读取 ${key} 失败，使用默认值`, error);
    return fallback;
  }
}

/** 序列化并写入；失败时静默忽略（如隐私模式） */
export function saveState<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch (error) {
    console.warn(`[storage] 写入 ${key} 失败`, error);
  }
}

/** 删除某个 key */
export function removeState(key: string): void {
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch (error) {
    console.warn(`[storage] 删除 ${key} 失败`, error);
  }
}

/** 清空所有带前缀的 key（用于重置演示数据） */
export function clearAllState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        keys.push(k);
      }
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch (error) {
    console.warn('[storage] 清空失败', error);
  }
}

/* ---------------------------- 具体业务 key ---------------------------- */

export const STORAGE_KEYS = {
  auth: 'auth_v1',
  market: 'market_v1',
} as const;
