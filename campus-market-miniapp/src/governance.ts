/**
 * 可信治理（用户侧）的展示文案与规则，不依赖 Taro，便于测试。
 * 文案逐条取自 Web 端 campus-market-frontend/src/utils/governance.ts 与「我的举报 / 我的限制」页面：
 * 所有判断都用服务端给出的机器码，中文只做展示；站内交易（订单、预约、爽约）已停用，相关机器码只在历史记录里出现，
 * 一律标明「历史」。平台不托管资金、不做赔付、不鉴定真伪，这些说法在界面里从不出现。
 */
import type {
  AppealInput, AppealSummary, LegacyReportReason, ModerationTargetType, MyGovernance, MyNotice, MyRestriction, NoticeActionCode,
  ReportInput, ReportReason, ReportTargetType, RestrictionScope, RestrictionSource, RevokeReason,
} from './model';
import { REPORT_REASONS } from './model';

export const REPORT_NOTE_MAX = 500;
export const APPEAL_REASON_MAX = 500;

export const REPORT_REASON_LABEL: Record<ReportReason | LegacyReportReason, string> = {
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

export const RESTRICTION_SOURCE_LABEL: Record<RestrictionSource, string> = { SYSTEM_RULE: '已停用的爽约自动规则（历史）', CASE: '平台工作人员的处理' };

export const REVOKE_REASON_LABEL: Record<RevokeReason, string> = {
  APPEAL_ACCEPTED: '申诉成立，已撤销',
  STAFF_CORRECTION: '工作人员纠正，已撤销',
  RULE_RECOMPUTED: '已按规则重算撤销',
  RULE_RETIRED: '规则已停用，自动撤销',
};

export const NOTICE_SECTION_LABEL: Record<NoticeActionCode, string> = {
  HIDE_PRODUCT: '商品被隐藏',
  HIDE_COMMENT: '留言被隐藏',
  QUARANTINE_MESSAGE: '私信被隔离',
  CONFIRM_NO_SHOW: '爽约确认（历史）',
};

export const NOTICE_EXPLAIN: Record<NoticeActionCode, string> = {
  HIDE_PRODUCT: '其他同学看不到这件商品。',
  HIDE_COMMENT: '这条留言对所有人都只显示「已被平台隐藏」；原文保留，没有删除。',
  QUARANTINE_MESSAGE: '只隔离了这一条私信：双方都只看到占位提示，会话与其他消息照常，可以继续沟通。',
  CONFIRM_NO_SHOW: '站内交易与爽约规则已经停用，这条记录只作历史展示，不再计入任何限制，也不需要申诉。',
};

export const REPORT_INTRO = '举报会交给本校的平台工作人员复核；被举报的人不会知道是谁举报的。单方举报不会自动处罚任何人，平台也不做交易仲裁、赔付或真伪鉴定。';
export const REPORT_DONE = '已收到举报。之后可以在「我的举报」里查看处理状态。';
export const REPORT_NOTE_HELP = `最多 ${REPORT_NOTE_MAX} 字，请不要填写手机号、微信号等联系方式`;
export const MY_REPORTS_INTRO = '为了保护双方，这里只显示处理进度；被举报的人不会知道是谁举报的。';
export const AWAITING_STAFF_REPORT = '本校暂时没有可以回避利益冲突的工作人员，这份举报保持待处理，不会被自动驳回；有合适的工作人员后会继续处理。';
export const MY_RESTRICTIONS_INTRO = '这里的内容只有你自己看得到，不会出现在公开资料里。限制都有期限，到期自动解除。';
export const APPEAL_INTRO = '每条限制或处理只能申诉一次，会由与此事无关的另一位平台工作人员处理；申诉成功会撤销尚未到期的限制或恢复内容，不会加重任何处理。';
export const APPEAL_DONE = '申诉已提交，将由另一位平台工作人员处理。';

/** 举报表单检查（与 Web ReportDialog 相同）：原因不预选；「其他」必须写说明；说明最多 500 字、不能有尖括号。 */
export function reportError(reason: ReportReason | '', note: string): string | null {
  if (!reason || !REPORT_REASONS.includes(reason)) return '请选择举报原因';
  if (reason === 'OTHER' && !note.trim()) return '选择「其他」时请写一句说明';
  if (note.trim().length > REPORT_NOTE_MAX || /[<>]/.test(note)) return `说明最多 ${REPORT_NOTE_MAX} 字，且不能包含尖括号`;
  return null;
}

/** 举报请求体：只带白名单字段；说明为空时不带 note。 */
export function reportInput(targetType: ReportTargetType, targetId: string, reason: ReportReason, note: string): ReportInput {
  const trimmed = note.trim();
  return trimmed ? { targetType, targetId, reasonCode: reason, note: trimmed } : { targetType, targetId, reasonCode: reason };
}

export function appealError(reason: string): string | null {
  if (!reason.trim()) return '请写明申诉理由';
  if (reason.trim().length > APPEAL_REASON_MAX || /[<>]/.test(reason)) return `申诉理由最多 ${APPEAL_REASON_MAX} 字，且不能包含尖括号`;
  return null;
}

export type AppealTarget = { kind: 'restriction' | 'action'; id: string; label: string };
/** 申诉请求体：restrictionId 与 actionId 二选一。 */
export function appealInput(target: AppealTarget, reason: string): AppealInput {
  return target.kind === 'restriction' ? { restrictionId: target.id, reason: reason.trim() } : { actionId: target.id, reason: reason.trim() };
}

/** 申诉状态：没有可以回避的工作人员时明确说明「保持待处理」，不会被自动驳回 */
export function appealStatusText(appeal: AppealSummary): string {
  if (appeal.status === 'PENDING') return appeal.awaitingEligibleStaff ? '处理中：本校暂时没有可以回避利益冲突的工作人员，申诉保持待处理，不会被自动驳回' : '处理中';
  return appeal.status === 'ACCEPTED' ? '已接受' : '已驳回';
}

export function reportStatusText(report: { status: keyof typeof MY_REPORT_STATUS_LABEL; outcome: keyof typeof MY_REPORT_OUTCOME_LABEL | null }): string {
  return `${MY_REPORT_STATUS_LABEL[report.status] ?? '处理中'}${report.outcome ? `（${MY_REPORT_OUTCOME_LABEL[report.outcome]}）` : ''}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 「10月21日 14:05」（本地时间）。小程序里不依赖 Intl，结果与 Web 的 zh-CN 月日时分一致。 */
export function formatMoment(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** 「2026/10/21 14:05」：提交时间、到期时间等完整日期。 */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 可读的到期时间：同时写出具体时间与还剩多久，不只靠颜色表示状态（与 Web formatUntil 一致） */
export function formatUntil(epochMs: number, now = Date.now()): string {
  const at = formatMoment(epochMs);
  const hours = Math.max(0, Math.round((epochMs - now) / 3_600_000));
  if (epochMs <= now) return `${at}（已结束）`;
  return hours >= 48 ? `${at}（约 ${Math.round(hours / 24)} 天后）` : `${at}（约 ${Math.max(1, hours)} 小时后）`;
}

/** 已结束的限制一行说明：撤销（带原因与时间）或到期。 */
export function pastRestrictionText(r: MyRestriction): string {
  const head = `${SCOPE_LABEL[r.scope] ?? r.scope} · 来源：${RESTRICTION_SOURCE_LABEL[r.source] ?? r.source}`;
  if (r.revokedAt) return `${head} · ${r.revokeReason ? REVOKE_REASON_LABEL[r.revokeReason] ?? '已撤销' : '已撤销'}（${formatDateTime(r.revokedAt)}）`;
  return `${head} · 已于 ${formatDateTime(r.endsAt)} 到期`;
}

/** 「我的限制」页的分组：生效中的限制、商品处理、其他处理（留言 / 私信 / 历史）、已结束的限制。 */
export function groupGovernance(data: MyGovernance): { active: MyRestriction[]; past: MyRestriction[]; productNotices: MyNotice[]; otherNotices: MyNotice[] } {
  return {
    active: data.restrictions.filter((r) => r.active),
    past: data.restrictions.filter((r) => !r.active),
    productNotices: data.notices.filter((n) => n.actionCode === 'HIDE_PRODUCT'),
    otherNotices: data.notices.filter((n) => n.actionCode !== 'HIDE_PRODUCT'),
  };
}

/** 商品处理记录的标题：隐藏中 / 已恢复。 */
export const productNoticeTitle = (n: MyNotice) => `「${n.targetLabel}」${n.active ? '已被隐藏（其他同学看不到）' : '已恢复'}`;
/** 其他处理记录的标题：生效中 / 已不再生效。 */
export const otherNoticeTitle = (n: MyNotice) => `${NOTICE_SECTION_LABEL[n.actionCode] ?? n.actionCode}：${n.targetLabel}${n.active ? '（生效中）' : '（已不再生效）'}`;
