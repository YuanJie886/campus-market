import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField as Input, Typography } from '@mui/material';
import { List, Show, DatagridConfigurable, DateField, TextField, TextInput, SelectInput, ShowButton, useCanAccess, useGetIdentity, useNotify, useRecordContext, useRefresh, type FieldProps, type RaRecord } from 'react-admin';
import { ListActions, ListSummary } from './ListTools';
import { PageHeading, RoleRequestStatusField, roleRequestStatusNames, staffStateText } from './adminUi';
import { roleRequestDecision, type RoleRequestDecision } from './dataProvider';

/** admin_role_requests 的后台投影（AdminService RESOURCES["role-requests"]）。 */
export interface RoleRequestRecord extends RaRecord {
    targetId: string; targetNickname?: string; targetAccount?: string;
    requestedBy: string; requesterNickname?: string;
    oldRole?: string | null; oldActive?: boolean | null; newRole: string; newActive: boolean; note?: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
    decidedBy?: string | null; deciderNickname?: string | null; decisionNote?: string | null; decidedAt?: number | null;
    expiresAt?: number; createdAt?: number;
}
const time = (value?: number | null) => value == null ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });
const statusChoices = Object.entries(roleRequestStatusNames).map(([id, name]) => ({ id, name }));
export const changeText = (record: Pick<RoleRequestRecord, 'oldRole' | 'oldActive' | 'newRole' | 'newActive'>) =>
    `${staffStateText(record.oldRole, record.oldActive)} → ${staffStateText(record.newRole, record.newActive)}`;
/** 前端与后端同样的限制：发起人与被变更的本人都不能确认或驳回（后端仍会再次校验）。 */
export function decisionBlockedReason(meId: string | undefined, record: Pick<RoleRequestRecord, 'requestedBy' | 'targetId'>) {
    if (meId && meId === record.requestedBy) return '不能确认自己发起的变更，需要另一位学校管理员确认';
    if (meId && meId === record.targetId) return '不能确认与自己有关的变更';
    return '';
}

function TargetCell(_: FieldProps) {
    const record = useRecordContext<RoleRequestRecord>();
    return record ? <Box><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{record.targetNickname || '未提供昵称'}</Typography><Typography sx={{ fontSize: 11, mt: .5 }} color="text.secondary">{record.targetAccount || record.targetId}</Typography></Box> : null;
}
function ChangeCell(_: FieldProps) {
    const record = useRecordContext<RoleRequestRecord>();
    return record ? <Typography component="span" sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{changeText(record)}</Typography> : null;
}
export function RoleRequestsList() {
    return <><PageHeading title="人员变更复核" description="涉及学校管理员的授予、降级与停用，需要另一位本校学校管理员确认后才生效；72 小时内未处理自动过期。" eyebrow="TWO-PERSON RULE / 两人复核" />
        <List actions={<ListActions />} perPage={25} sort={{ field: 'createdAt', order: 'DESC' }} filterDefaultValues={{ status: 'PENDING' }} filters={[
            <SelectInput key="status" source="status" label="复核状态" choices={statusChoices} alwaysOn />,
            <TextInput key="q" source="q" label="搜索目标或发起人" alwaysOn resettable inputProps={{ maxLength: 100 }} />,
        ]}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
            <TargetCell source="targetNickname" label="目标" sortable={false} />
            <ChangeCell source="newRole" label="变更前 → 变更后" sortable={false} />
            <TextField source="requesterNickname" label="发起人" sortable={false} />
            <TextField source="note" label="说明" sortable={false} />
            <RoleRequestStatusField source="status" label="状态" sortable={false} />
            <DateField locales="zh-CN" source="expiresAt" label="到期时间" showTime sortable={false} />
            <DateField locales="zh-CN" source="createdAt" label="发起时间" showTime />
            <ShowButton label="查看" />
        </DatagridConfigurable></List></>;
}

const decisionLabels: Record<RoleRequestDecision, { button: string; submit: string; title: string; note: string; done: string }> = {
    approve: { button: '确认生效', submit: '确认并生效', title: '确认这条人员变更', note: '确认理由（必填）', done: '变更已确认并生效' },
    reject: { button: '驳回', submit: '确认驳回', title: '驳回这条人员变更', note: '驳回理由（必填）', done: '已驳回这条变更' },
    cancel: { button: '撤回', submit: '确认撤回', title: '撤回这条人员变更', note: '撤回说明（选填）', done: '已撤回这条变更' },
};
function RoleRequestActions({ record }: { record: RoleRequestRecord }) {
    const { canAccess: canDecide } = useCanAccess({ resource: 'users', action: 'edit' });
    const { identity } = useGetIdentity();
    const notify = useNotify(), refresh = useRefresh();
    const [mode, setMode] = useState<RoleRequestDecision | null>(null);
    const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (record.status !== 'PENDING') return <Alert severity="info">这条复核请求{roleRequestStatusNames[record.status] ?? record.status}，不能再处理。</Alert>;
    if (!canDecide) return <Alert severity="info">只读查看：确认、驳回或撤回人员变更需要学校管理员权限。</Alert>;
    if (!identity) return null;
    const isRequester = identity.id === record.requestedBy;
    const blocked = decisionBlockedReason(String(identity.id), record);
    const open = (value: RoleRequestDecision) => { setNote(''); setError(''); setMode(value); };
    const noteValid = note.trim().length <= 500 && (mode === 'cancel' || note.trim().length > 0);
    const submit = async () => {
        if (!mode || !noteValid || busy) return;
        setBusy(true); setError('');
        try {
            await roleRequestDecision(record.id, mode, note);
            notify(decisionLabels[mode].done, { type: 'success' }); setMode(null); refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '处理失败，请重试');
            if ((failure as { status?: number }).status === 409) refresh();
        } finally { setBusy(false); }
    };
    return <>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" disabled={Boolean(blocked)} onClick={() => open('approve')}>{decisionLabels.approve.button}</Button>
            <Button variant="outlined" color="error" disabled={Boolean(blocked)} onClick={() => open('reject')}>{decisionLabels.reject.button}</Button>
            {isRequester && <Button variant="outlined" onClick={() => open('cancel')}>{decisionLabels.cancel.button}</Button>}
        </Stack>
        {blocked && <Typography sx={{ fontSize: 12, mt: 1.5 }} color="text.secondary">{blocked}{isRequester ? '；你可以撤回这条请求。' : '。'}</Typography>}
        <Dialog open={mode !== null} onClose={() => { if (!busy) setMode(null); }} fullWidth maxWidth="sm" aria-labelledby="role-request-dialog-title">
            <DialogTitle id="role-request-dialog-title">{mode ? decisionLabels[mode].title : ''}</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Box sx={{ p: 2, bgcolor: '#f5f8f6', borderRadius: 2, mb: 2 }}>
                    <Typography>目标：{record.targetNickname || record.targetId}</Typography>
                    <Typography sx={{ mt: 1 }}>变更：{changeText(record)}</Typography>
                    <Typography sx={{ mt: 1, overflowWrap: 'anywhere' }}>发起说明：{record.note || '—'}</Typography>
                </Box>
                {mode === 'approve' && <Alert severity="warning" sx={{ mb: 2 }}>确认后立即生效，并同时记录发起人与确认人。</Alert>}
                <Input label={mode ? decisionLabels[mode].note : ''} value={note} onChange={event => setNote(event.target.value)} multiline minRows={3} fullWidth required={mode !== 'cancel'} inputProps={{ maxLength: 500 }} helperText={`${note.length}/500`} />
            </DialogContent>
            <DialogActions>
                <Button disabled={busy} onClick={() => setMode(null)}>取消</Button>
                <Button variant="contained" color={mode === 'reject' ? 'error' : 'primary'} disabled={!noteValid || busy} onClick={() => void submit()}>{busy ? '提交中…' : mode ? decisionLabels[mode].submit : ''}</Button>
            </DialogActions>
        </Dialog>
    </>;
}
function Info({ label, children }: { label: string; children?: ReactNode }) {
    return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px 1fr' }, gap: 1, py: 1.2, borderBottom: '1px solid #edf1ef' }}><Typography color="text.secondary" sx={{ fontSize: 12 }}>{label}</Typography><Box sx={{ fontSize: 13, overflowWrap: 'anywhere' }}>{children ?? '—'}</Box></Box>;
}
function RoleRequestDetails() {
    const record = useRecordContext<RoleRequestRecord>();
    if (!record) return null;
    return <Card><CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}><RoleRequestStatusField source="status" /><Typography variant="h6">{record.targetNickname || '校园用户'}</Typography></Box>
        <Divider sx={{ my: 2 }} />
        <Info label="目标">{record.targetNickname || '—'}（{record.targetAccount || record.targetId}）</Info>
        <Info label="变更前">{staffStateText(record.oldRole, record.oldActive)}</Info>
        <Info label="变更后">{staffStateText(record.newRole, record.newActive)}</Info>
        <Info label="发起人">{record.requesterNickname || record.requestedBy}</Info>
        <Info label="发起说明">{record.note}</Info>
        <Info label="发起时间">{time(record.createdAt)}</Info>
        <Info label="到期时间">{time(record.expiresAt)}</Info>
        {record.decidedAt != null && <><Info label="处理人">{record.deciderNickname || record.decidedBy || '—'}</Info><Info label="处理说明">{record.decisionNote || '—'}</Info><Info label="处理时间">{time(record.decidedAt)}</Info></>}
        <Box sx={{ mt: 3 }}><RoleRequestActions record={record} /></Box>
    </CardContent></Card>;
}
export function RoleRequestShow() {
    return <><PageHeading title="人员变更复核详情" description="核对变更内容与发起原因。确认后立即生效，审计同时记录发起人与确认人；发起人与被变更的本人不能确认。" eyebrow="TWO-PERSON RULE / 两人复核" action={<Button component={Link} to="/role-requests" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>返回复核列表</Button>} />
        <Show actions={false} component="div" title="人员变更复核详情"><RoleRequestDetails /></Show></>;
}
