import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { useNotify, useRecordContext, type FieldProps } from 'react-admin';

export const ROLES = [
    { id: 'SCHOOL_ADMIN', name: '学校管理员', description: '统筹本校运营，管理工作人员授权，处理治理案件与申诉。', capabilities: ['本校用户、商品与订单', '工作人员授权与停用', '案件处理与申诉复核', '授权审计与角色权限'] },
    { id: 'SENIOR_MODERATOR', name: '高级审核员', description: '处理复杂案件与申诉，可查看本校运营数据，无人员授权权限。', capabilities: ['本校用户、商品与订单（只读）', '高级案件处理与申诉复核', '授权审计与角色权限（只读）'] },
    { id: 'MODERATOR', name: '审核员', description: '负责日常内容治理和申诉处理，限制类动作最长 7 天。', capabilities: ['本校商品（只读）', '日常案件处理与申诉复核', '限制类动作最长 7 天'] },
    { id: 'AUDITOR', name: '只读审计员', description: '查看业务数据和授权记录，不能修改权限或处理案件。', capabilities: ['本校用户、商品与订单（只读）', '授权审计与角色权限（只读）'] },
];
export const resourceNames: Record<string, string> = { users: '用户与工作人员', products: '商品目录', orders: '交易订单', cases: '治理案件', appeals: '用户申诉', audit: '授权审计', roles: '角色权限' };
export const statusNames: Record<string, string> = {
    OPEN: '待处理', UNDER_REVIEW: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回', APPEALED: '申诉中',
    PENDING: '待复核', ACCEPTED: '已接受', REJECTED: '已驳回', PENDING_SELLER_CONFIRM: '待卖家确认',
    PENDING_MEETING: '待面交', BUYER_CONFIRMED: '买家已确认', SELLER_CONFIRMED: '卖家已确认', COMPLETED: '已完成',
    CANCELLED: '已取消', EXPIRED: '已过期', DISPUTED: '争议中',
};
export const targetNames: Record<string, string> = { PRODUCT: '商品', USER: '用户', CIRCLE: '圈子', COMMENT: '评论', MESSAGE: '私信', ORDER: '订单', NO_SHOW: '爽约报告' };
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
