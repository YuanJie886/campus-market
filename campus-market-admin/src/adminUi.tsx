import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { useFieldValue, useNotify, useRecordContext, type FieldProps } from 'react-admin';

/**
 * 角色说明只用于显示；实际可访问的菜单和操作始终来自 GET /v1/admin/me 的 permissions（与后端 AdminPermissions 一致）。
 * 阶段 2：高级审核员不再自动获得用户 / 订单 / 审计只读与商品编辑；学校管理员与只读审计员可查看复核请求与读取审计。
 */
export const ROLES = [
    { id: 'SCHOOL_ADMIN', name: '学校管理员', description: '统筹本校运营，发起与确认人员变更，处理治理案件与申诉。涉及学校管理员的变更需另一位学校管理员确认。', capabilities: ['本校用户与商品', '历史订单（只读）', '商品信息编辑与展示管理', '工作人员授权与停用（涉及学校管理员时需另一位学校管理员确认）', '人员变更复核：确认 / 驳回 / 撤回', '案件处理与申诉复核', '授权审计、读取审计与角色权限'] },
    { id: 'SENIOR_MODERATOR', name: '高级审核员', description: '与审核员相同的后台范围：商品目录只读，处理案件与申诉；更长的限制等按治理规则。不能查看用户、订单与审计，不能编辑商品。', capabilities: ['本校商品（只读）', '案件处理与申诉复核（高级治理规则）'] },
    { id: 'MODERATOR', name: '审核员', description: '负责日常内容治理和申诉处理，限制类动作最长 7 天。', capabilities: ['本校商品（只读）', '日常案件处理与申诉复核', '限制类动作最长 7 天'] },
    { id: 'AUDITOR', name: '只读审计员', description: '查看业务数据、授权记录、人员变更复核与读取审计，不能修改权限或处理案件。', capabilities: ['本校用户、商品与历史订单（只读）', '授权审计、人员变更复核与读取审计（只读）', '角色权限（只读）'] },
];
export const resourceNames: Record<string, string> = { users: '用户与工作人员', products: '商品目录', orders: '历史订单（只读）', cases: '治理案件', appeals: '用户申诉', audit: '授权审计', 'role-requests': '人员变更复核', 'read-audit': '读取审计', roles: '角色权限' };
/** 人员变更复核请求状态（admin_role_requests）。 */
export const roleRequestStatusNames: Record<string, string> = { PENDING: '待确认', APPROVED: '已确认生效', REJECTED: '已驳回', CANCELLED: '已撤回', EXPIRED: '已过期' };
/** 读取审计里的资源名（admin_read_audit.resource）。 */
export const readAuditResourceNames: Record<string, string> = { users: '用户', orders: '历史订单', audit: '授权审计', 'role-requests': '人员变更复核', 'read-audit': '读取审计' };
/** 发起涉及学校管理员的变更后，界面显示的提示：变更尚未生效。 */
export const PENDING_ROLE_REQUEST_NOTICE = '已提交，需要另一位学校管理员确认后生效';
/** 后端规则：变更前或变更后角色是学校管理员时，需要两人复核。 */
export const needsSecondAdmin = (oldRole: unknown, newRole: unknown) => oldRole === 'SCHOOL_ADMIN' || newRole === 'SCHOOL_ADMIN';
export const staffStateText = (role: unknown, active: unknown) => `${role ? roleName(role) : '无后台角色'} · ${active ? '启用' : '停用'}`;
export const statusNames: Record<string, string> = {
    OPEN: '待处理', UNDER_REVIEW: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回', APPEALED: '申诉中',
    PENDING: '待复核', ACCEPTED: '已接受', REJECTED: '已驳回', PENDING_SELLER_CONFIRM: '待卖家确认',
    PENDING_MEETING: '待面交', BUYER_CONFIRMED: '买家已确认', SELLER_CONFIRMED: '卖家已确认', COMPLETED: '已完成',
    CANCELLED: '已取消', EXPIRED: '已过期', DISPUTED: '争议中',
};
export const targetNames: Record<string, string> = { PRODUCT: '商品', USER: '用户', CIRCLE: '圈子', COMMENT: '评论', MESSAGE: '私信', ORDER: '订单（历史）', NO_SHOW: '爽约报告（历史）' };
/** 治理动作。站内交易停用（V16）后，预约与爽约相关动作只用于显示历史记录，不再作为可选动作。 */
export const actionNames: Record<string, string> = {
    HIDE_PRODUCT: '隐藏商品', RESTORE_PRODUCT: '恢复商品', ARCHIVE_CIRCLE: '归档圈子',
    RESTRICT_CONTACT: '限制申请联系方式', RESTRICT_PUBLISHING: '限制发布', RESTRICT_CIRCLE_CREATION: '限制创建圈子',
    NO_ACTION: '不采取措施', HIDE_COMMENT: '隐藏评论', RESTORE_COMMENT: '恢复评论', QUARANTINE_MESSAGE: '隔离私信', RELEASE_MESSAGE: '解除私信隔离',
    REVOKE_RESTRICTION: '撤销限制', ACCEPT_APPEAL: '接受申诉', REJECT_APPEAL: '驳回申诉',
    RESTRICT_BOOKING: '限制预约新订单（历史）', CONFIRM_NO_SHOW: '确认爽约（历史）', REJECT_NO_SHOW: '驳回爽约报告（历史）',
};
export const RETIRED_ACTIONS: ReadonlySet<string> = new Set(['RESTRICT_BOOKING', 'CONFIRM_NO_SHOW', 'REJECT_NO_SHOW']);
/** 限制范围。BOOKING 只存在于历史限制中，新的限制使用 CONTACT。 */
export const scopeNames: Record<string, string> = {
    CONTACT: '申请联系方式', PUBLISHING: '发布商品', CIRCLE_CREATION: '创建圈子', BOOKING: '预约新订单（历史）',
};
export const reasonNames: Record<string, string> = {
    POLICY_VIOLATION: '违反平台规则', PROHIBITED_ITEM: '违禁物品', HARASSMENT: '骚扰', FRAUD_RISK: '欺诈风险',
    INSUFFICIENT_EVIDENCE: '证据不足', DUPLICATE: '重复案件', OTHER: '其他', CONFIRMED_NO_SHOW: '确认爽约（历史）',
    APPEAL_ACCEPTED: '申诉成立', APPEAL_REJECTED: '申诉不成立',
};
/** 后端 DECISION_REASONS；CONFIRMED_NO_SHOW 只用于显示历史记录。 */
const DECISION_REASONS = ['POLICY_VIOLATION', 'PROHIBITED_ITEM', 'HARASSMENT', 'FRAUD_RISK', 'INSUFFICIENT_EVIDENCE', 'DUPLICATE', 'OTHER'];
/** 处理表单只提供后端仍接受的动作；已停用的历史动作即使出现在旧响应里也不会被提供。 */
export const decisionActionChoices = (allowed: readonly string[]) => allowed.filter(id => !RETIRED_ACTIONS.has(id)).map(id => ({ id, name: actionNames[id] ?? id }));
export const decisionReasonChoices = DECISION_REASONS.map(id => ({ id, name: reasonNames[id] }));
function LabelField({ source, names }: FieldProps & { names: Record<string, string> }) {
    const value = useFieldValue({ source: source! });
    if (value == null || value === '') return <span>—</span>;
    return <span>{names[String(value)] ?? String(value)}</span>;
}
export function ActionCodeField(props: FieldProps) { return <LabelField {...props} names={actionNames} />; }
export function ScopeField(props: FieldProps) { return <LabelField {...props} names={scopeNames} />; }
export function ReasonCodeField(props: FieldProps) { return <LabelField {...props} names={reasonNames} />; }
export function ReadAuditResourceField(props: FieldProps) { return <LabelField {...props} names={readAuditResourceNames} />; }
export const roleName = (role: unknown) => ROLES.find(r => r.id === role)?.name ?? (role ? String(role) : '普通用户');
export function StatusBadge({ value }: { value: unknown }) {
    const key = String(value ?? '');
    const color = ['RESOLVED', 'ACCEPTED', 'COMPLETED', '在售'].includes(key) ? 'success'
        : ['DISPUTED', 'APPEALED', '已下架'].includes(key) ? 'error'
            : ['OPEN', 'PENDING', 'PENDING_SELLER_CONFIRM', '预约中'].includes(key) ? 'warning'
                : ['UNDER_REVIEW', 'PENDING_MEETING', 'BUYER_CONFIRMED', 'SELLER_CONFIRMED'].includes(key) ? 'info' : 'default';
    return <Chip size="small" color={color} label={statusNames[key] ?? (key || '未设置')} variant="outlined" />;
}
export function StatusField({ source = 'status' }: FieldProps) {
    const record = useRecordContext();
    return <StatusBadge value={record?.[source]} />;
}
export function RoleRequestStatusField({ source = 'status' }: FieldProps) {
    const record = useRecordContext(); const key = String(record?.[source] ?? '');
    const color = key === 'APPROVED' ? 'success' : key === 'PENDING' ? 'warning' : key === 'REJECTED' ? 'error' : 'default';
    return <Chip size="small" color={color} label={roleRequestStatusNames[key] ?? (key || '未设置')} variant="outlined" />;
}
export function RoleField({ source = 'role' }: FieldProps) {
    const record = useRecordContext();
    return <Chip size="small" label={roleName(record?.[source])} variant="outlined" />;
}
export function IdentifierField({ source = 'id' }: FieldProps) {
    const record = useRecordContext(); const notify = useNotify(); const value = String(record?.[source] ?? '');
    const copy = async (event: React.MouseEvent) => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(value); notify('编号已复制', { type: 'success' }); }
        catch { notify('复制失败，请在详情页选中编号复制', { type: 'warning' }); }
    };
    if (!value) return <span>—</span>;
    return <Box sx={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', gap: .5 }}><Tooltip title={value}><Typography component="span" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value}</Typography></Tooltip><Tooltip title="复制完整编号"><IconButton size="small" aria-label={`复制编号 ${value}`} onClick={event => void copy(event)}><CopyIcon sx={{ fontSize: 13, color: '#8fa397' }} /></IconButton></Tooltip></Box>;
}
export function PageHeading({ title, description, eyebrow = 'CAMPUS MARKET', action }: { title: string; description: string; eyebrow?: string; action?: React.ReactNode }) {
    return <Box className="page-heading">
        <Box><Typography className="eyebrow">{eyebrow}</Typography><Typography component="h1" variant="h4">{title}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{description}</Typography></Box>{action}
    </Box>;
}
export const dateText = (value: unknown) => value ? new Date(value as string | number).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
export const queueLink = (resource: string, status: string) => `/${resource}?filter=${encodeURIComponent(JSON.stringify({ status }))}`;
