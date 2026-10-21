import { ApiError } from '../errors';

/**
 * 离线 Mock 专用：卖家声明与请求体的校验规则，与后端 InspectionService / JsonFieldPolicy 逐条对应。
 * 只允许 Mock 适配层引用；REST 模式下这些判断全部发生在服务端。
 * （订单验货、档期与到达的规则随站内交易一起停用，已移除。）
 */

export const DECLARED_CONDITIONS = ['NORMAL', 'DEFECT', 'NOT_TESTED', 'NOT_APPLICABLE'] as const;

export function rejectUnknownKeys(body: object, allowed: readonly string[], label = '请求'): void {
  for (const key of Object.keys(body ?? {})) {
    if (!allowed.includes(key)) throw ApiError.mock({ code: 400, message: `${label}包含不支持的字段：${key}` });
  }
}

export function note(raw: unknown, max: number): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: '备注格式无效' });
  const value = raw.trim();
  if (value.length > max) throw ApiError.mock({ code: 400, message: `备注最多 ${max} 个字` });
  if (/[<>]/.test(value)) throw ApiError.mock({ code: 400, message: '备注不能包含尖括号' });
  return value;
}
