/**
 * 后台错误信息：后端信息原样保留，只在两种情况下补充说明。
 * - 403 CONFLICT_OF_INTEREST：在后端信息后补上回避原因（原因码来自后端 ConflictGuard，前端只翻译不判断）。
 * - 429：后台按工作人员限流，按 Retry-After 告诉对方多久后可以重试；没有该响应头时显示后端信息。
 */
export const conflictReasonNames: Record<string, string> = {
    SELF_TARGET: '案件或申诉以你本人为对象',
    OWN_CONTENT: '涉及你本人发布的内容',
    OWN_CONVERSATION: '涉及你本人参与的私信会话',
    OWN_ORDER: '涉及你本人参与的历史订单',
    OWN_REPORT: '涉及你本人提交的举报',
    OWN_ACTION: '涉及你本人做出的处理',
    CONTACT_PARTY: '你申请过这件商品的联系方式',
};

/** Retry-After 是秒数（后端 RateLimitExceededException）；也接受 HTTP 日期。无法解析时返回 null。 */
export function retryAfterSeconds(header: string | null | undefined, now = Date.now()): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const date = Date.parse(trimmed);
    return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

function waitText(seconds: number) {
    if (seconds < 60) return `${Math.max(1, seconds)} 秒`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} 分钟`;
}

export function errorMessage(status: number, message: string | undefined, details: unknown, retryAfter: string | null): string {
    const fallback = message || '请求失败';
    if (status === 429) {
        const seconds = retryAfterSeconds(retryAfter);
        return seconds === null ? fallback : `操作过于频繁，请在 ${waitText(seconds)}后重试`;
    }
    const conflict = details as { code?: unknown; reason?: unknown } | null | undefined;
    if (status === 403 && conflict?.code === 'CONFLICT_OF_INTEREST') {
        const reason = conflictReasonNames[String(conflict.reason)];
        return reason ? `${fallback}（回避原因：${reason}）` : fallback;
    }
    return fallback;
}
