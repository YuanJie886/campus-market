import { ApiError } from '../errors';

/**
 * 离线 Mock 专用：可信面交闭环的校验规则，与后端 OrderFlowService / InspectionService 逐条对应。
 * 只允许 Mock 适配层引用；REST 模式下这些判断全部发生在服务端。
 */

export const DECLARED_CONDITIONS = ['NORMAL', 'DEFECT', 'NOT_TESTED', 'NOT_APPLICABLE'] as const;
export const BUYER_RESULTS = ['MATCH', 'MISMATCH', 'NOT_CHECKABLE'] as const;
/** 3.8B：正式档期只能在卖家接受预约后的面交阶段建立 */
export const SCHEDULABLE = ['PENDING_MEETING'];
export const PRESENCE_ALLOWED = ['PENDING_MEETING', 'BUYER_CONFIRMED'];
export const TERMINAL = ['COMPLETED', 'CANCELLED', 'EXPIRED'];
export const MAX_CODE_ATTEMPTS = 5;

/** 与后端 OrderActionability.buyerConfirmBlockReason 逐条一致。 */
export function buyerConfirmBlockReason(orderStatus: string, inspectionStatus: string | null) {
  if (TERMINAL.includes(orderStatus)) return 'ORDER_TERMINAL' as const;
  if (orderStatus === 'DISPUTED') return 'INSPECTION_MISMATCH' as const;
  if (orderStatus === 'BUYER_CONFIRMED' || orderStatus === 'SELLER_CONFIRMED') return 'ALREADY_CONFIRMED' as const;
  if (orderStatus !== 'PENDING_MEETING') return 'ORDER_NOT_IN_MEETING' as const;
  return inspectionGate(inspectionStatus);
}

/** 与后端 OrderActionability.inspectionGate 一致：确认面交与核销共用。 */
export function inspectionGate(inspectionStatus: string | null) {
  if (inspectionStatus === 'PENDING') return 'INSPECTION_REQUIRED' as const;
  if (inspectionStatus === 'NEEDS_RESOLUTION') return 'INSPECTION_MISMATCH' as const;
  return null;
}

/** 与后端 OrderActionability.meetingStatus 一致。 */
export function meetingStatus(orderStatus: string, hasPendingProposal: boolean) {
  if (orderStatus === 'PENDING_SELLER_CONFIRM') return 'AWAITING_SELLER' as const;
  if (orderStatus === 'PENDING_MEETING') return hasPendingProposal ? 'RESCHEDULE_PENDING' as const : 'CONFIRMED' as const;
  return 'CLOSED' as const;
}


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

/** 离散时间段：整点或半点、秒为 0。与后端 OrderFlowService.slot 一致。 */
export function slot(raw: unknown, label: string): number {
  if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: `${label}格式无效` });
  const value = Date.parse(raw);
  if (Number.isNaN(value)) throw ApiError.mock({ code: 400, message: `${label}格式无效` });
  const date = new Date(value);
  if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0 || date.getUTCMinutes() % 30 !== 0) {
    throw ApiError.mock({ code: 400, message: `${label}必须是整点或半点` });
  }
  return value;
}
