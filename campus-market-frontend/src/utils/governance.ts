import type {
  HistoricalActionCode, LegacyDecisionReason, LegacyReportReason, ModerationActionCode, ModerationCaseStatus, ModerationDecisionReason,
  ModerationReportReason, ModerationTargetType, RestrictionScope, RevokeReason,
} from '../api/contracts';

/**
 * 模块 7 的展示文案。所有判断都用服务端给出的机器码，中文只做展示。
 * 平台不托管资金、不做赔付、不鉴定真伪；这些说法在界面里从不出现。
 *
 * <p>阶段 1：平台只展示商品与联系方式。站内交易（订单、预约、核对、爽约）已经停用，
 * 相关的机器码只在历史记录里出现，文案一律标明「历史」，不再把它们写成当前功能。
 */

export const REPORT_REASON_LABEL: Record<ModerationReportReason | LegacyReportReason, string> = {
  PROHIBITED_ITEM: '违禁或不允许交易的物品',
  MISLEADING: '描述明显不实',
  FRAUD_SUSPECTED: '疑似诈骗',
  HARASSMENT: '骚扰或辱骂',
  SPAM: '垃圾广告或刷屏',
  IMPERSONATION: '冒充他人或组织',
  OTHER: '其他（请写一句说明）',
  NO_SHOW_REVIEW: '请求复核爽约（历史）',
};

export const TARGET_LABEL: Record<ModerationTargetType, string> = {
  PRODUCT: '商品', USER: '用户', CIRCLE: '圈子', COMMENT: '留言', MESSAGE: '私信', ORDER: '订单（历史）', NO_SHOW: '爽约复核（历史）',
};

export const MY_REPORT_STATUS_LABEL = { RECEIVED: '已收到', UNDER_REVIEW: '处理中', CLOSED: '已结束' } as const;
export const MY_REPORT_OUTCOME_LABEL = { ACTION_TAKEN: '平台已处理', NO_ACTION: '未采取措施' } as const;

/** BOOKING 是历史上的「预约新订单」限制：不能再新建，到期前与「申请联系方式」限制效果相同 */
export const SCOPE_LABEL: Record<RestrictionScope, string> = {
  CONTACT: '申请联系方式',
  PUBLISHING: '发布商品',
  CIRCLE_CREATION: '创建圈子',
  BOOKING: '申请联系方式（原「预约新订单」限制）',
};

/** 限制期间仍然可以做的事：限制只针对一个入口 */
export const SCOPE_STILL_ALLOWED: Record<RestrictionScope, string> = {
  CONTACT: '仍然可以浏览、私信，查看与撤回已经发出的联系申请。',
  PUBLISHING: '仍然可以保存草稿、下架已发布的商品，其他功能不受影响。',
  CIRCLE_CREATION: '仍然可以管理已有圈子、退出圈子，其他功能不受影响。',
  BOOKING: '仍然可以浏览、私信，查看与撤回已经发出的联系申请。',
};

export const CASE_STATUS_LABEL: Record<ModerationCaseStatus, string> = {
  OPEN: '待处理', UNDER_REVIEW: '处理中', RESOLVED: '已处理', DISMISSED: '未采取措施', APPEALED: '申诉中',
};

/** 动作名称。历史动作只用于展示过去的处理记录，工作人员不能再选择它们 */
export const ACTION_LABEL: Record<ModerationActionCode | HistoricalActionCode | 'ACCEPT_APPEAL' | 'REJECT_APPEAL' | 'REVOKE_RESTRICTION', string> = {
  HIDE_PRODUCT: '隐藏商品',
  RESTORE_PRODUCT: '恢复商品',
  ARCHIVE_CIRCLE: '强制归档圈子',
  RESTRICT_CONTACT: '限制申请联系方式',
  RESTRICT_PUBLISHING: '限制发布商品',
  RESTRICT_CIRCLE_CREATION: '限制创建圈子',
  NO_ACTION: '不采取措施',
  HIDE_COMMENT: '隐藏留言',
  RESTORE_COMMENT: '恢复留言',
  QUARANTINE_MESSAGE: '隔离这条私信',
  RELEASE_MESSAGE: '解除私信隔离',
  ACCEPT_APPEAL: '接受申诉',
  REJECT_APPEAL: '驳回申诉',
  REVOKE_RESTRICTION: '撤销限制',
  RESTRICT_BOOKING: '限制预约新订单（历史）',
  CONFIRM_NO_SHOW: '确认爽约（历史）',
  REJECT_NO_SHOW: '驳回爽约报告（历史）',
};

/** 高风险动作：执行前必须二次确认，并写明影响与到期时间 */
export const HIGH_RISK_ACTIONS: readonly ModerationActionCode[] = ['HIDE_PRODUCT', 'ARCHIVE_CIRCLE', 'RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION',
  'HIDE_COMMENT', 'QUARANTINE_MESSAGE'];

export const ACTION_IMPACT: Record<ModerationActionCode, string> = {
  HIDE_PRODUCT: '本校其他同学将看不到这件商品，商品上的联系方式也不再向任何人展示（卖家本人仍能看到）。卖家会收到处理通知，可以申诉一次。',
  RESTORE_PRODUCT: '商品重新对本校同学可见。',
  ARCHIVE_CIRCLE: '圈子立即归档：不能再发布、订阅或邀请，圈子订阅停用。归档不能撤销。',
  RESTRICT_CONTACT: '对方在期限内不能发起新的联系申请；浏览、私信，以及查看与撤回已经发出的申请不受影响。到期自动解除，可以申诉一次。',
  RESTRICT_PUBLISHING: '对方在期限内不能发布商品；保存草稿、下架不受影响。到期自动解除，可以申诉一次。',
  RESTRICT_CIRCLE_CREATION: '对方在期限内不能新建圈子；已有圈子的管理与退出不受影响。到期自动解除，可以申诉一次。',
  NO_ACTION: '结案，不对任何人采取措施。',
  HIDE_COMMENT: '这条留言对所有人都只显示「已被平台隐藏」，原文保留、不删除。作者会看到提示，可以申诉一次。',
  RESTORE_COMMENT: '留言重新显示。',
  QUARANTINE_MESSAGE: '只隔离被举报的这一条私信：双方都只看到占位提示，会话与其他消息照常，双方可以继续私信。原文保留，发送者可以申诉一次。',
  RELEASE_MESSAGE: '这条私信重新显示。',
};

/** 7.1C：工作人员利益回避的原因（后端 403 details.reason）；界面只展示，不自行判断 */
export const CONFLICT_REASON_LABEL: Record<import('../api/contracts').ConflictReason, string> = {
  SELF_TARGET: '案件或申诉以你本人为对象',
  OWN_CONTENT: '涉及你本人发布的内容',
  OWN_CONVERSATION: '涉及你本人参与的私信会话',
  OWN_ORDER: '涉及你本人参与的历史订单',
  OWN_REPORT: '涉及你本人提交的举报',
  OWN_ACTION: '涉及你本人做出的处理',
  // 阶段 2（V17）：工作人员本人申请过这件商品的联系方式
  CONTACT_PARTY: '涉及你申请过联系方式的商品',
};

/** 7.1B：历史上自动限制的纠正结果 */
export const CORRECTION_LABEL = { SHORTENED: '已按规则缩短', REVOKED: '已按规则撤销' } as const;
export const RESTRICTION_SOURCE_LABEL = { SYSTEM_RULE: '已停用的爽约自动规则（历史）', CASE: '平台工作人员的处理' } as const;
/** 限制被撤销的原因 */
export const REVOKE_REASON_LABEL: Record<RevokeReason, string> = {
  APPEAL_ACCEPTED: '申诉成立，已撤销',
  STAFF_CORRECTION: '工作人员纠正，已撤销',
  RULE_RECOMPUTED: '已按规则重算撤销',
  RULE_RETIRED: '规则已停用，自动撤销',
};
export const NOTICE_SECTION_LABEL: Record<import('../api/contracts').MyNoticeActionCode, string> = {
  HIDE_PRODUCT: '商品被隐藏',
  HIDE_COMMENT: '留言被隐藏',
  QUARANTINE_MESSAGE: '私信被隔离',
  CONFIRM_NO_SHOW: '爽约确认（历史）',
};

export const DECISION_REASON_LABEL: Record<ModerationDecisionReason | LegacyDecisionReason, string> = {
  POLICY_VIOLATION: '违反平台规则',
  PROHIBITED_ITEM: '违禁物品',
  HARASSMENT: '骚扰',
  FRAUD_RISK: '欺诈风险',
  INSUFFICIENT_EVIDENCE: '证据不足',
  APPEAL_ACCEPTED: '申诉成立',
  APPEAL_REJECTED: '申诉不成立',
  DUPLICATE: '重复举报',
  OTHER: '其他（请写一句说明）',
  CONFIRMED_NO_SHOW: '爽约属实（历史）',
};

/** 可读的到期时间：同时写出具体时间与还剩多久，不只靠颜色表示状态 */
export function formatUntil(epochMs: number, now = Date.now()): string {
  const at = new Date(epochMs).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const hours = Math.max(0, Math.round((epochMs - now) / 3_600_000));
  if (epochMs <= now) return `${at}（已结束）`;
  return hours >= 48 ? `${at}（约 ${Math.round(hours / 24)} 天后）` : `${at}（约 ${Math.max(1, hours)} 小时后）`;
}
