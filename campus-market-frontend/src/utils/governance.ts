import type {
  CancellationPhase, CancellationReason, ModerationActionCode, ModerationCaseStatus, ModerationDecisionReason, ModerationReportReason,
  ModerationTargetType, NoShowEligibility, NoShowReason, NoShowStatus, RestrictionScope,
} from '../api/contracts';

/**
 * 模块 7 的展示文案。所有判断都用服务端给出的机器码，中文只做展示。
 * 平台不托管资金、不做赔付、不鉴定真伪；这些说法在界面里从不出现。
 */
export const CANCEL_REASON_LABEL: Record<CancellationReason, string> = {
  CHANGED_MIND: '不想要了 / 不想卖了',
  SCHEDULE_CONFLICT: '时间冲突',
  ITEM_UNAVAILABLE: '物品已不可交易',
  CONDITION_MISMATCH: '物品情况与描述不符',
  COUNTERPART_UNRESPONSIVE: '对方联系不上',
  OTHER: '其他（请写一句说明）',
};

export const CANCEL_PHASE_LABEL: Record<CancellationPhase, string> = {
  BEFORE_SELLER_CONFIRM: '卖家确认前',
  AFTER_SELLER_CONFIRM: '卖家确认后',
  AFTER_MEETING_AGREED: '双方确认改约后',
  AFTER_ARRIVAL_REPORTED: '有人声明已到达后',
  INSPECTION_MISMATCH: '验货不一致',
};

export const NO_SHOW_REASON_LABEL: Record<NoShowReason, string> = {
  DID_NOT_ARRIVE: '对方没有到场',
  ARRIVED_TOO_LATE: '对方迟到太久',
  UNREACHABLE_AT_MEETING: '约定时间联系不上对方',
  OTHER: '其他（请写一句说明）',
};

export const NO_SHOW_STATUS_LABEL: Record<NoShowStatus, string> = {
  PENDING: '等待对方回应（不会产生任何处罚）',
  ACKNOWLEDGED: '对方已承认',
  DISPUTED: '对方有异议，等待平台工作人员复核',
  CONFIRMED: '平台工作人员已确认',
  REJECTED: '已驳回（不计入）',
  EXPIRED: '已失效（改约或已经见面）',
};

export const NO_SHOW_ELIGIBILITY_TEXT: Record<NoShowEligibility['code'], string> = {
  OK: '档期已经结束超过 15 分钟，可以报告对方爽约。',
  NO_AGREED_MEETING: '还没有双方确认过的档期，不能报告爽约。',
  NO_EXPLICIT_SLOT: '原始预约没有明确的结束时间，平台不会据此推测爽约；如需报告，请先通过改约确认一个完整的新档期。',
  TOO_EARLY: '档期结束 15 分钟之后才能报告爽约。',
  WINDOW_CLOSED: '已超过报告期限（档期结束后 7 天内）。',
  MET: '双方已经见面（已验货或已确认），不能报告爽约。',
  CANCELLED_BEFORE_MEETING: '订单在档期之前已经取消，不能报告爽约。',
  ALREADY_REPORTED: '你已经就这个档期报告过。',
};

export const REPORT_REASON_LABEL: Record<ModerationReportReason, string> = {
  PROHIBITED_ITEM: '违禁或不允许交易的物品',
  MISLEADING: '描述明显不实',
  FRAUD_SUSPECTED: '疑似诈骗',
  HARASSMENT: '骚扰或辱骂',
  SPAM: '垃圾广告或刷屏',
  IMPERSONATION: '冒充他人或组织',
  NO_SHOW_REVIEW: '请求复核爽约',
  OTHER: '其他（请写一句说明）',
};

export const TARGET_LABEL: Record<ModerationTargetType, string> = {
  PRODUCT: '商品', USER: '用户', CIRCLE: '圈子', COMMENT: '留言', MESSAGE: '私信', ORDER: '订单', NO_SHOW: '爽约复核',
};

export const MY_REPORT_STATUS_LABEL = { RECEIVED: '已收到', UNDER_REVIEW: '处理中', CLOSED: '已结束' } as const;
export const MY_REPORT_OUTCOME_LABEL = { ACTION_TAKEN: '平台已处理', NO_ACTION: '未采取措施' } as const;

export const SCOPE_LABEL: Record<RestrictionScope, string> = {
  BOOKING: '预约新订单',
  PUBLISHING: '发布商品',
  CIRCLE_CREATION: '创建圈子',
};

/** 限制期间仍然可以做的事：限制只针对一个入口，不影响已经成立的订单 */
export const SCOPE_STILL_ALLOWED: Record<RestrictionScope, string> = {
  BOOKING: '仍然可以浏览、沟通，并完成已经成立的订单（验货、确认、取消都不受影响）。',
  PUBLISHING: '仍然可以保存草稿、下架已发布的商品，其他功能不受影响。',
  CIRCLE_CREATION: '仍然可以管理已有圈子、退出圈子，其他功能不受影响。',
};

export const CASE_STATUS_LABEL: Record<ModerationCaseStatus, string> = {
  OPEN: '待处理', UNDER_REVIEW: '处理中', RESOLVED: '已处理', DISMISSED: '未采取措施', APPEALED: '申诉中',
};

export const ACTION_LABEL: Record<ModerationActionCode | 'ACCEPT_APPEAL' | 'REJECT_APPEAL' | 'REVOKE_RESTRICTION', string> = {
  HIDE_PRODUCT: '隐藏商品',
  RESTORE_PRODUCT: '恢复商品',
  ARCHIVE_CIRCLE: '强制归档圈子',
  RESTRICT_BOOKING: '限制预约新订单',
  RESTRICT_PUBLISHING: '限制发布商品',
  RESTRICT_CIRCLE_CREATION: '限制创建圈子',
  CONFIRM_NO_SHOW: '确认爽约',
  REJECT_NO_SHOW: '驳回爽约报告',
  NO_ACTION: '不采取措施',
  HIDE_COMMENT: '隐藏留言',
  RESTORE_COMMENT: '恢复留言',
  QUARANTINE_MESSAGE: '隔离这条私信',
  RELEASE_MESSAGE: '解除私信隔离',
  ACCEPT_APPEAL: '接受申诉',
  REJECT_APPEAL: '驳回申诉',
  REVOKE_RESTRICTION: '撤销限制',
};

/** 高风险动作：执行前必须二次确认，并写明影响与到期时间 */
export const HIGH_RISK_ACTIONS: readonly ModerationActionCode[] = ['HIDE_PRODUCT', 'ARCHIVE_CIRCLE', 'RESTRICT_BOOKING', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION', 'CONFIRM_NO_SHOW',
  'HIDE_COMMENT', 'QUARANTINE_MESSAGE'];

export const ACTION_IMPACT: Record<ModerationActionCode, string> = {
  HIDE_PRODUCT: '其他同学将看不到这件商品（卖家本人与已成立订单的对方仍能看到）。卖家会收到处理通知，可以申诉一次。',
  RESTORE_PRODUCT: '商品重新对本校同学可见。',
  ARCHIVE_CIRCLE: '圈子立即归档：不能再发布、订阅或邀请，圈子订阅停用。已成立的订单不受影响。归档不能撤销。',
  RESTRICT_BOOKING: '对方在期限内不能预约新订单；浏览、沟通与已成立订单不受影响。到期自动解除，可以申诉一次。',
  RESTRICT_PUBLISHING: '对方在期限内不能发布商品；保存草稿、下架不受影响。到期自动解除，可以申诉一次。',
  RESTRICT_CIRCLE_CREATION: '对方在期限内不能新建圈子；已有圈子的管理与退出不受影响。到期自动解除，可以申诉一次。',
  CONFIRM_NO_SHOW: '计为一次已确认爽约。30 天内第 2 次会自动限制预约 24 小时，第 3 次起 72 小时。',
  REJECT_NO_SHOW: '这份报告不计入，不产生任何限制。',
  NO_ACTION: '结案，不对任何人采取措施。',
  HIDE_COMMENT: '这条留言对所有人都只显示「已被平台隐藏」，原文保留、不删除。作者会看到提示，可以申诉一次。',
  RESTORE_COMMENT: '留言重新显示。',
  QUARANTINE_MESSAGE: '只隔离被举报的这一条私信：双方都只看到占位提示，会话与其他消息照常，已有订单可以继续沟通。原文保留，发送者可以申诉一次。',
  RELEASE_MESSAGE: '这条私信重新显示。',
};

/** 7.1C：工作人员利益回避的原因（后端 403 details.reason）；界面只展示，不自行判断 */
export const CONFLICT_REASON_LABEL: Record<import('../api/contracts').ConflictReason, string> = {
  SELF_TARGET: '案件或申诉以你本人为对象',
  OWN_CONTENT: '涉及你本人发布的内容',
  OWN_CONVERSATION: '涉及你本人参与的私信会话',
  OWN_ORDER: '涉及你本人参与的订单',
  OWN_REPORT: '涉及你本人提交的举报',
  OWN_ACTION: '涉及你本人做出的处理',
};

/** 7.1B：自动限制的纠正结果 */
export const CORRECTION_LABEL = { SHORTENED: '已按规则缩短', REVOKED: '已按规则撤销' } as const;
export const RESTRICTION_SOURCE_LABEL = { SYSTEM_RULE: '已确认爽约的公开规则（自动）', CASE: '平台工作人员的处理' } as const;
export const NOTICE_SECTION_LABEL: Record<import('../api/contracts').MyNoticeActionCode, string> = {
  HIDE_PRODUCT: '商品被隐藏',
  HIDE_COMMENT: '留言被隐藏',
  QUARANTINE_MESSAGE: '私信被隔离',
  CONFIRM_NO_SHOW: '工作人员确认了一次爽约',
};

export const DECISION_REASON_LABEL: Record<ModerationDecisionReason, string> = {
  POLICY_VIOLATION: '违反平台规则',
  PROHIBITED_ITEM: '违禁物品',
  HARASSMENT: '骚扰',
  FRAUD_RISK: '欺诈风险',
  CONFIRMED_NO_SHOW: '爽约属实',
  INSUFFICIENT_EVIDENCE: '证据不足',
  APPEAL_ACCEPTED: '申诉成立',
  APPEAL_REJECTED: '申诉不成立',
  DUPLICATE: '重复举报',
  OTHER: '其他（请写一句说明）',
};

/** 可读的到期时间：同时写出具体时间与还剩多久，不只靠颜色表示状态 */
export function formatUntil(epochMs: number, now = Date.now()): string {
  const at = new Date(epochMs).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const hours = Math.max(0, Math.round((epochMs - now) / 3_600_000));
  if (epochMs <= now) return `${at}（已结束）`;
  return hours >= 48 ? `${at}（约 ${Math.round(hours / 24)} 天后）` : `${at}（约 ${Math.max(1, hours)} 小时后）`;
}

/** 7.1A：下单时可选的面交时长（分钟），与服务端 15～120 分钟的范围一致 */
export const SLOT_CHOICES: readonly number[] = [15, 30, 45, 60, 90, 120];

/** 完整面交时段的展示：开始、结束与时长都明确写出 */
export function formatSlotRange(startMs: number, endMs: number): string {
  const day = new Date(startMs).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const end = new Date(endMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${day}–${end}（${Math.round((endMs - startMs) / 60_000)} 分钟）`;
}
