/** 文本 / 时间 / 价格格式化工具 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 价格展示：整数不带小数，非整数保留两位 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '¥0';
  if (Number.isInteger(value)) return `¥${value}`;
  return `¥${value.toFixed(2)}`;
}

/** 纯数字价格（用于排序展示） */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

/** 日期：YYYY-MM-DD */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 日期时间：YYYY-MM-DD HH:mm */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${formatDate(ts)} ${hh}:${mm}`;
}

/** 聊天时间：今天显示 HH:mm，昨天显示「昨天 HH:mm」，更早显示日期 */
export function formatChatTime(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const sameDay =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const yesterday = new Date(now.getTime() - DAY);
  const isYesterday =
    yesterday.getFullYear() === d.getFullYear() &&
    yesterday.getMonth() === d.getMonth() &&
    yesterday.getDate() === d.getDate();
  if (isYesterday) return `昨天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return formatDate(ts);
}

/** 联系方式脱敏 */
export function maskContact(contact: string): string {
  if (!contact) return '未填写';
  if (contact.length <= 4) return contact;
  return `${contact.slice(0, 3)}****${contact.slice(-2)}`;
}

/** 截断文本 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** 校验手机号 */
export function isValidPhone(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(value.trim());
}

/** 校验学号（6-20 位数字或字母） */
export function isValidStudentId(value: string): boolean {
  return /^[A-Za-z0-9]{6,20}$/.test(value.trim());
}
