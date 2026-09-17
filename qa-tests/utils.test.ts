/**
 * QA 单元测试：纯逻辑工具函数（format / storage / id / constants）
 * 直接 import 真实源码，通过 esbuild 打包后由 node 运行。
 */

/* ---------- 极简测试框架 ---------- */
let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/* ---------- 浏览器环境 shim（storage.ts 依赖 window.localStorage） ---------- */
class FakeStorage {
  private map = new Map<string, string>();
  failOnSet = false;
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.failOnSet) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const fake = new FakeStorage();
// @ts-expect-error 注入测试用 window
globalThis.window = { localStorage: fake };

/* ---------- 被测模块 ---------- */
import {
  formatPrice,
  formatNumber,
  formatDate,
  formatDateTime,
  formatChatTime,
  formatRelativeTime,
  maskContact,
  truncate,
  isValidPhone,
  isValidStudentId,
} from '../src/utils/format';
import {
  STORAGE_PREFIX,
  storageKey,
  loadState,
  saveState,
  removeState,
  clearAllState,
  STORAGE_KEYS,
} from '../src/utils/storage';
import { uid, safeUuid } from '../src/utils/id';
import { CATEGORY_EMOJI, CATEGORY_GRADIENT, IMAGE_PRESETS, ORDER_STATUS_COLOR, CONDITION_COLOR } from '../src/utils/constants';
import { CATEGORIES, CONDITIONS, CAMPUSES, SORT_OPTIONS, DEFAULT_FILTER } from '../src/types';

/* ================= format.ts ================= */
section('formatPrice');
eq('整数不带小数', formatPrice(100), '¥100');
eq('非整数保留两位', formatPrice(99.5), '¥99.50');
eq('0 元', formatPrice(0), '¥0');
eq('负数（表单会拦截，此处记录行为）', formatPrice(-5), '¥-5');
eq('NaN 兜底', formatPrice(Number.NaN), '¥0');
eq('Infinity 兜底', formatPrice(Number.POSITIVE_INFINITY), '¥0');
eq('两位以上小数四舍五入', formatPrice(1234567.891), '¥1234567.89');
eq('浮点 0.1+0.2', formatPrice(0.30000000000000004), '¥0.30');

section('formatNumber');
eq('千分位', formatNumber(1234567), '1,234,567');
eq('零', formatNumber(0), '0');

section('formatDate / formatDateTime');
const ts1 = new Date(2024, 2, 5, 10, 30, 0).getTime(); // 2024-03-05 10:30
eq('formatDate 补零', formatDate(ts1), '2024-03-05');
eq('formatDateTime', formatDateTime(ts1), '2024-03-05 10:30');
const ts2 = new Date(2024, 11, 31, 9, 5, 0).getTime(); // 2024-12-31 09:05
eq('formatDate 双位月日', formatDate(ts2), '2024-12-31');
eq('formatDateTime 补零', formatDateTime(ts2), '2024-12-31 09:05');

section('formatChatTime');
const now = new Date();
const sameDayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 7).getTime();
eq('今天 → HH:mm', formatChatTime(sameDayTs), '08:07');
const yest = new Date(now.getTime() - 24 * 3600 * 1000);
const yestTs = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 20, 15).getTime();
eq('昨天 → 昨天 HH:mm', formatChatTime(yestTs), '昨天 20:15');
const oldTs = new Date(2020, 0, 2, 6, 5).getTime();
eq('更早 → M月D日 HH:mm', formatChatTime(oldTs), '1月2日 06:05');

section('formatRelativeTime');
const t = Date.now();
eq('刚刚', formatRelativeTime(t - 10 * 1000), '刚刚');
eq('N 分钟前', formatRelativeTime(t - 5 * 60 * 1000), '5 分钟前');
eq('N 小时前', formatRelativeTime(t - 3 * 3600 * 1000), '3 小时前');
eq('N 天前', formatRelativeTime(t - 2 * 24 * 3600 * 1000), '2 天前');
ok('超过 30 天回退为日期', /^\d{4}-\d{2}-\d{2}$/.test(formatRelativeTime(t - 40 * 24 * 3600 * 1000)));

section('maskContact');
eq('空 → 未填写', maskContact(''), '未填写');
eq('短串原样', maskContact('abc'), 'abc');
eq('长度 4 原样', maskContact('abcd'), 'abcd');
eq('长串脱敏', maskContact('13800001111'), '138****11');

section('truncate');
eq('超长截断加省略号', truncate('hello world', 5), 'hello…');
eq('不超长原样', truncate('hi', 5), 'hi');
eq('恰好等长原样', truncate('hello', 5), 'hello');

section('isValidPhone');
ok('合法手机号', isValidPhone('13800001111'));
ok('合法手机号带空格', isValidPhone('  13800001111 '));
ok('12 开头非法', !isValidPhone('12800001111'));
ok('位数不足', !isValidPhone('1380000'));
ok('含字母非法', !isValidPhone('1380000abcd'));

section('isValidStudentId');
ok('7 位学号', isValidStudentId('2021001'));
ok('字母数字混合', isValidStudentId('ABC123'));
ok('5 位过短', !isValidStudentId('abc12'));
ok('21 位过长', !isValidStudentId('a'.repeat(21)));
ok('含特殊字符非法', !isValidStudentId('2021-001'));

/* ================= storage.ts ================= */
section('storage');
eq('前缀', STORAGE_PREFIX, 'campus_market_');
eq('storageKey', storageKey('market_v1'), 'campus_market_market_v1');
eq('业务 key', STORAGE_KEYS, { auth: 'auth_v1', market: 'market_v1' });

saveState('t_roundtrip', { a: 1, b: '中文' });
eq('saveState/loadState 往返', loadState('t_roundtrip', null), { a: 1, b: '中文' });
eq('loadState 缺失返回兜底', loadState('not_exist', 'FB'), 'FB');

fake.setItem(`${STORAGE_PREFIX}corrupt`, '{bad json');
eq('损坏 JSON 自愈为兜底', loadState('corrupt', 'FB'), 'FB');

removeState('t_roundtrip');
eq('removeState 后返回兜底', loadState('t_roundtrip', 'FB'), 'FB');

// clearAllState 仅清理带前缀的 key
fake.clear();
fake.setItem('other_key', 'keep-me');
saveState('a', 1);
saveState('b', 2);
clearAllState();
eq('clearAllState 保留非前缀 key', fake.getItem('other_key'), 'keep-me');
eq('clearAllState 清理带前缀 key', fake.getItem(storageKey('a')), null);

// 写入异常（隐私模式 / 配额）不应抛出
fake.failOnSet = true;
let threw = false;
try {
  saveState('x', 1);
} catch {
  threw = true;
}
fake.failOnSet = false;
ok('setItem 抛错时 saveState 不抛出', !threw);

/* ================= id.ts ================= */
section('id');
ok('uid 带前缀', uid('p').startsWith('p_'));
const set = new Set<string>();
for (let i = 0; i < 2000; i += 1) set.add(uid('p'));
eq('2000 次 uid 无碰撞', set.size, 2000);
ok('safeUuid 返回非空字符串', typeof safeUuid() === 'string' && safeUuid().length > 0);

/* ================= constants / types ================= */
section('constants');
eq('6 个分类 emoji', Object.keys(CATEGORY_EMOJI).sort(), [...CATEGORIES].sort());
eq('6 个分类渐变', Object.keys(CATEGORY_GRADIENT).sort(), [...CATEGORIES].sort());
eq('预置图片 12 张', IMAGE_PRESETS.length, 12);
ok('预置图片均为 https', IMAGE_PRESETS.every((u) => u.startsWith('https://')));
eq('4 种成色', CONDITIONS.length, 4);
eq('4 个校区', CAMPUSES.length, 4);
eq('4 种排序', SORT_OPTIONS.length, 4);
eq('订单状态色齐全', Object.keys(ORDER_STATUS_COLOR).sort(), ['已完成', '已取消', '待确认', '交易中'].sort());
ok('成色色值齐全', CONDITIONS.every((c) => Boolean(CONDITION_COLOR[c])));
eq('默认筛选', DEFAULT_FILTER, {
  keyword: '',
  category: '全部',
  campus: '全部',
  condition: '全部',
  minPrice: '',
  maxPrice: '',
  sort: 'latest',
});

/* ---------- 汇总 ---------- */
console.log(`\n========== 结果 ==========`);
console.log(`通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`);
if (failed > 0) {
  console.log('失败用例：');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
