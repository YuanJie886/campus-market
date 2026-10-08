/**
 * 可信面交（模块 3）的展示层映射与时间段工具。
 *
 * <p>这里只做「机器码 → 中文」与「离散时间段 → ISO」两件事：
 * 业务判断一律使用服务端返回的 canonical 值，中文永远不参与分支。
 * 未知机器码安全降级为通用文案，而不是抛错或原样显示。
 */
import type {
  BuyerResult, DeclaredCondition, InspectionStatus, PresenceStatus, ProposalStatus,
} from '../api/contracts';
import type { CanonicalOrderStatus } from '../types';

/** 验货凭证的固定说明：过程记录，不是鉴定或担保。 */
export const INSPECTION_DISCLAIMER = '该记录仅用于记录双方当面检查过程，不代表平台鉴定或担保。';
/** 到达状态的固定说明：人工点选，不是定位。 */
export const PRESENCE_NOTE = '这是双方手动点选的人工状态，不是定位结果；平台不读取你的位置。';

export const DECLARED_CONDITION_OPTIONS: DeclaredCondition[] = ['NORMAL', 'DEFECT', 'NOT_TESTED', 'NOT_APPLICABLE'];
export const BUYER_RESULT_OPTIONS: BuyerResult[] = ['MATCH', 'MISMATCH', 'NOT_CHECKABLE'];

const CONDITION_LABEL: Record<DeclaredCondition, string> = {
  NORMAL: '正常',
  DEFECT: '存在问题',
  NOT_TESTED: '未测试',
  NOT_APPLICABLE: '不适用',
};
export function conditionLabel(code: string | null | undefined): string {
  return (code && CONDITION_LABEL[code as DeclaredCondition]) || '未声明';
}

const RESULT_LABEL: Record<BuyerResult, string> = {
  MATCH: '与声明一致',
  MISMATCH: '与声明不一致',
  NOT_CHECKABLE: '现场无法检查',
};
export function resultLabel(code: string | null | undefined): string {
  return (code && RESULT_LABEL[code as BuyerResult]) || '未填写';
}

const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  LEGACY_NONE: '无结构化验货记录',
  NOT_PROVIDED: '该商品发布时未提供结构化验货声明',
  PENDING: '待买家现场验货',
  SUBMITTED: '买家已提交验货结果',
  NEEDS_RESOLUTION: '验货不一致',
};
export function inspectionStatusLabel(code: string | null | undefined): string {
  return (code && INSPECTION_STATUS_LABEL[code as InspectionStatus]) || '验货状态未知';
}

const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  PENDING: '待对方回应',
  ACCEPTED: '双方已确认',
  REJECTED: '已被拒绝',
  WITHDRAWN: '已撤回',
  SUPERSEDED: '已被新档期替换',
};
export function proposalStatusLabel(code: string | null | undefined): string {
  return (code && PROPOSAL_STATUS_LABEL[code as ProposalStatus]) || '状态未知';
}

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  NOT_STARTED: '尚未出发',
  DEPARTED: '已出发',
  ARRIVED: '已到达',
};
export function presenceLabel(code: string | null | undefined): string {
  return (code && PRESENCE_LABEL[code as PresenceStatus]) || '状态未知';
}

const ORDER_STATUS_LABEL: Record<CanonicalOrderStatus, string> = {
  PENDING_SELLER_CONFIRM: '待卖家确认',
  PENDING_MEETING: '待面交',
  BUYER_CONFIRMED: '买家已确认，待卖家核验',
  SELLER_CONFIRMED: '卖家已确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXPIRED: '已超时',
  DISPUTED: '验货不一致',
};
export function orderStatusLabel(code: string | null | undefined): string {
  return (code && ORDER_STATUS_LABEL[code as CanonicalOrderStatus]) || '状态未知';
}

const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: '发起预约',
  SELLER_ACCEPTED: '卖家接受预约',
  MEETING_PROPOSED: '提议新的面交档期',
  MEETING_ACCEPTED: '面交档期已确认',
  MEETING_REJECTED: '拒绝了面交档期',
  MEETING_WITHDRAWN: '撤回了面交档期',
  PRESENCE_DEPARTED: '标记「我已出发」',
  PRESENCE_ARRIVED: '标记「我已到达」',
  INSPECTION_SUBMITTED: '提交验货结果',
  INSPECTION_MISMATCH: '验货发现不一致项',
  ORDER_DISPUTED: '订单标记为验货不一致',
  BUYER_CONFIRMED: '买家确认面交',
  SELLER_VERIFIED: '卖家核验确认码',
  ORDER_COMPLETED: '交易完成',
  ORDER_CANCELLED: '订单已取消',
  ORDER_EXPIRED: '订单已超时',
};
export function eventLabel(code: string): string {
  return EVENT_LABEL[code] ?? '其他进展';
}

export function actorLabel(actor: string, viewerRole: 'BUYER' | 'SELLER'): string {
  if (actor === 'SYSTEM') return '系统';
  if (actor === viewerRole) return '我';
  if (actor === 'BUYER' || actor === 'SELLER') return actor === 'BUYER' ? '买家' : '卖家';
  return '未知';
}

const BLOCKED_REASON_LABEL: Record<string, string> = {
  INSPECTION_REQUIRED: '请先在「面交与验货」中逐项验货并提交，才能确认面交。',
  INSPECTION_MISMATCH: '验货不一致：不能确认面交，也不能核销确认码。可以取消交易、查看验货记录，或等待订单到期。',
  ORDER_NOT_IN_MEETING: '卖家接受预约后才能确认面交。',
  ORDER_TERMINAL: '订单已结束。',
  ALREADY_CONFIRMED: '已确认面交，等待卖家核验确认码。',
};

/** 验货不一致时的固定说明（3.8C）：平台不仲裁、不判责、不赔付。 */
export const MISMATCH_NOTE = '平台只记录双方当面验货的过程，不代替专业鉴定，也不提供资金担保。';

const MEETING_STATUS_LABEL: Record<string, string> = {
  AWAITING_SELLER: '等待卖家接受预约',
  CONFIRMED: '档期已确认',
  RESCHEDULE_PENDING: '改约待对方回应',
  CLOSED: '不再约时间',
};
export function meetingStatusLabel(code: string | null | undefined): string {
  return (code && MEETING_STATUS_LABEL[code]) || '状态未知';
}
export function blockedReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return BLOCKED_REASON_LABEL[code] ?? '当前还不能确认面交。';
}

/* ------------------------------ 离散时间段 ------------------------------ */

export const PROPOSAL_DAYS = 7;
/** 可选开始时间：08:00～21:30，每 30 分钟一档 */
export const START_SLOTS: string[] = Array.from({ length: 28 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
/** 可选时长（分钟），与服务端「最长 2 小时」一致 */
export const DURATION_OPTIONS = [30, 60, 90, 120] as const;

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface ProposalDay { key: string; label: string }

/** 从今天起的 7 个本地日期。key 为 YYYY-MM-DD。 */
export function upcomingDays(now = new Date(), days = PROPOSAL_DAYS): ProposalDay[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const prefix = i === 0 ? '今天 ' : i === 1 ? '明天 ' : '';
    return { key, label: `${prefix}${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY[d.getDay()]}` };
  });
}

/** 本地日期 + 开始时间 + 时长 → [开始, 结束] 的 ISO 字符串。 */
export function slotToIso(dayKey: string, start: string, durationMinutes: number): { startsAtIso: string; endsAtIso: string } {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [hh, mm] = start.split(':').map(Number);
  const startsAt = new Date(y, m - 1, d, hh, mm, 0, 0);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  return { startsAtIso: startsAt.toISOString(), endsAtIso: endsAt.toISOString() };
}

/** 面交时段的简短展示：9月25日 周四 14:00–15:00 */
export function formatSlot(startsAtIso: string, endsAtIso?: string | null): string {
  const start = new Date(startsAtIso);
  if (Number.isNaN(start.getTime())) return '时间未知';
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = `${start.getMonth() + 1}月${start.getDate()}日 ${WEEKDAY[start.getDay()]}`;
  const end = endsAtIso ? new Date(endsAtIso) : null;
  return end && !Number.isNaN(end.getTime()) ? `${day} ${hm(start)}–${hm(end)}` : `${day} ${hm(start)}`;
}
