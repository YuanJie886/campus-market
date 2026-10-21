import { useId, useReducer, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Table, TableBody, TableCell, TableHead, TableRow, TextField as Input, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/AddOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { DatagridConfigurable, DateField, List, SelectInput, Show, TextField, useCanAccess, useNotify, useRecordContext, useRefresh, type FieldProps, type Identifier, type RaRecord } from 'react-admin';
import { HttpError } from './HttpError';
import { request } from './http';
import { ListActions, ListSummary } from './ListTools';
import { PageHeading } from './adminUi';
import { SIZE_PAGED } from './dataProvider';

/**
 * 注册邀请码（小范围测试只开放邀请注册）。学校管理员发放与撤销，只读审计员只能查看列表与详情。
 *
 * 完整邀请码只在发放接口的响应里出现一次，因此：
 * - 发放直接用 request 调用接口，不经过 dataProvider / react-query，结果不进入任何查询缓存或 react-admin store；
 * - 只保存在发放弹窗自己的 state 里，关闭弹窗立即清空；不写 localStorage / sessionStorage，不打印日志；
 * - 列表与详情只显示尾号（codeHint）。
 */
export const INVITE_RESOURCE = 'registration-invites';
const BASE = `/v1/admin/${INVITE_RESOURCE}`;

export type InviteStatus = 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'REVOKED';
export interface InviteUse { userId: string; nickname?: string | null; usedAt: number }
export interface RegistrationInviteRecord extends RaRecord {
    codeHint: string; maxUses: number; usedCount: number; expiresAt: number; revokedAt?: number | null;
    note?: string | null; createdBy?: string | null; createdAt: number; status: InviteStatus; uses?: InviteUse[];
}
/** 发放接口的响应：记录本身加上只出现这一次的完整邀请码。 */
export interface IssuedInviteRecord extends RegistrationInviteRecord { code: string }

export const inviteStatusNames: Record<InviteStatus, string> = { ACTIVE: '有效', USED_UP: '已用完', EXPIRED: '已过期', REVOKED: '已撤销' };
export const inviteStatusLabel = (status: unknown) => inviteStatusNames[String(status) as InviteStatus] ?? (status ? String(status) : '未设置');
/** createdBy 为空表示邀请码由服务器命令发放（不是某位工作人员）。 */
export const SERVER_COMMAND_ISSUER = '服务器命令';
export const issuerText = (createdBy: unknown) => createdBy == null || createdBy === '' ? SERVER_COMMAND_ISSUER : String(createdBy);
export const usageText = (record: Pick<RegistrationInviteRecord, 'usedCount' | 'maxUses'>) => `${record.usedCount ?? 0} / ${record.maxUses ?? '—'}`;
export const INVITE_CODE_WARNING = '完整邀请码只显示这一次，关闭后无法再次查看；请现在复制，或把下面的邀请消息直接发给受邀同学。';
/** 可直接转发给受邀同学的邀请消息。 */
export const inviteMessage = (code: string, days: number) => `校园集市小范围测试邀请码：${code}，${days} 天内有效，注册时填写`;
const MISSING_CODE = '服务器没有返回完整邀请码，请在列表中撤销这条新邀请码后重新发放';
const time = (value?: number | null) => value == null ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });

// ───────────── 发放：表单校验与请求 ─────────────

/** 表单里的原始输入（数字输入框给出的是字符串）。 */
export interface InviteDraft { maxUses: string; expiresInDays: string; note: string }
export const INVITE_DEFAULTS: Readonly<InviteDraft> = { maxUses: '10', expiresInDays: '14', note: '' };
export const INVITE_LIMITS = { maxUses: { min: 1, max: 500 }, expiresInDays: { min: 1, max: 90 }, note: 100 } as const;
const wholeNumber = (value: string | number) => { const text = String(value ?? '').trim(); return /^\d+$/.test(text) ? Number(text) : Number.NaN; };
const within = (value: number, { min, max }: { min: number; max: number }) => Number.isInteger(value) && value >= min && value <= max;

/** 备注长度按字符（码点）计算，与后端 RegistrationInvites.validate 一致。 */
export const noteLength = (note: string) => [...(note ?? '').trim()].length;
/** 与发放接口的契约一致：可用次数 1～500 的整数、有效天数 1～90 的整数、备注最多 100 个字。返回每个字段的问题（文案与后端相同），没有问题时为空对象。 */
export function inviteDraftProblems(draft: InviteDraft): Partial<Record<keyof InviteDraft, string>> {
    const problems: Partial<Record<keyof InviteDraft, string>> = {};
    if (!within(wholeNumber(draft.maxUses), INVITE_LIMITS.maxUses)) problems.maxUses = '可用次数需为 1～500 的整数';
    if (!within(wholeNumber(draft.expiresInDays), INVITE_LIMITS.expiresInDays)) problems.expiresInDays = '有效天数需为 1～90 的整数';
    if (noteLength(draft.note) > INVITE_LIMITS.note) problems.note = '备注最多 100 个字';
    return problems;
}
/** 请求体只含 maxUses、expiresInDays 与去掉首尾空白的 note；备注为空时不发送 note。 */
export function invitePayload(draft: InviteDraft): { maxUses: number; expiresInDays: number; note?: string } {
    const note = (draft.note ?? '').trim();
    return { maxUses: wholeNumber(draft.maxUses), expiresInDays: wholeNumber(draft.expiresInDays), ...(note ? { note } : {}) };
}
/** POST /v1/admin/registration-invites。输入不合法时直接拒绝（400），不发请求；服务器错误信息原样交给界面。 */
export function createRegistrationInvite(draft: InviteDraft): Promise<IssuedInviteRecord> {
    const problem = Object.values(inviteDraftProblems(draft))[0];
    if (problem) return Promise.reject(new HttpError(problem, 400));
    return request<IssuedInviteRecord>(BASE, { method: 'POST', body: JSON.stringify(invitePayload(draft)) });
}
/** POST /v1/admin/registration-invites/{id}/revoke（幂等，没有请求体）。 */
export function revokeRegistrationInvite(id: Identifier) {
    return request<RegistrationInviteRecord>(`${BASE}/${encodeURIComponent(String(id))}/revoke`, { method: 'POST' });
}

// ───────────── 发放弹窗：完整邀请码只显示一次 ─────────────

export interface IssuedCode { code: string; days: number; maxUses: number; expiresAt?: number | null }
export type InviteDialogState = { phase: 'closed' } | { phase: 'form' } | { phase: 'issued'; issued: IssuedCode };
export type InviteDialogAction = { type: 'open' } | { type: 'issued'; issued: IssuedCode } | { type: 'close' };
export const CLOSED_INVITE_DIALOG: InviteDialogState = { phase: 'closed' };
/**
 * 发放弹窗的状态。完整邀请码只存在于 phase=issued 的状态里：
 * 关闭立即回到 closed 并丢弃邀请码；重新打开总是回到空白表单；只有表单阶段才能接收新的邀请码。
 */
export function inviteDialogReducer(state: InviteDialogState, action: InviteDialogAction): InviteDialogState {
    switch (action.type) {
        case 'open': return state.phase === 'issued' ? state : { phase: 'form' };
        case 'issued': return state.phase === 'form' ? { phase: 'issued', issued: action.issued } : state;
        case 'close': return CLOSED_INVITE_DIALOG;
        default: return state;
    }
}

type CopyState = '' | 'code' | 'message' | 'failed';
/** 邀请码、警示、邀请消息与两个复制按钮（弹窗正文）。 */
export function InviteCodeContent({ issued, copied, onCopy }: { issued: IssuedCode; copied: CopyState; onCopy: (kind: 'code' | 'message') => void }) {
    return <>
        <Alert severity="warning" role="alert" sx={{ mb: 2 }}>{INVITE_CODE_WARNING}</Alert>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>注册邀请码</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>
            <Typography aria-label="邀请码" sx={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 700, letterSpacing: 2, userSelect: 'all', overflowWrap: 'anywhere' }}>{issued.code}</Typography>
            <Button variant="outlined" size="small" startIcon={<CopyIcon fontSize="small" />} onClick={() => onCopy('code')}>复制邀请码</Button>
        </Box>
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>{`可使用 ${issued.maxUses} 次；${issued.expiresAt ? `有效期至 ${time(issued.expiresAt)}` : `${issued.days} 天内有效`}。`}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2.5 }}>可直接发送的邀请消息</Typography>
        <Box sx={{ p: 1.5, mt: 1, bgcolor: '#f5f8f6', borderRadius: 2 }}>
            <Typography aria-label="邀请消息" sx={{ fontSize: 13, overflowWrap: 'anywhere', userSelect: 'all' }}>{inviteMessage(issued.code, issued.days)}</Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<CopyIcon fontSize="small" />} sx={{ mt: 1.5 }} onClick={() => onCopy('message')}>复制邀请消息</Button>
        {copied === 'code' && <Typography role="status" sx={{ fontSize: 12, mt: 1.5, color: 'success.main' }}>邀请码已复制。</Typography>}
        {copied === 'message' && <Typography role="status" sx={{ fontSize: 12, mt: 1.5, color: 'success.main' }}>邀请消息已复制，可以直接发给受邀同学。</Typography>}
        {copied === 'failed' && <Typography role="status" sx={{ fontSize: 12, mt: 1.5, color: 'error.main' }}>复制失败，请手动选中后复制。</Typography>}
    </>;
}

/** 发放邀请码的弹窗。state 由调用方持有（见 inviteDialogReducer）；phase 不是 issued 时不渲染任何邀请码。 */
export function InviteDialog({ state, draft, busy, error, copied, onDraft, onSubmit, onCopy, onClose }: {
    state: InviteDialogState; draft: InviteDraft; busy: boolean; error: string; copied: CopyState;
    onDraft: (draft: InviteDraft) => void; onSubmit: () => void; onCopy: (kind: 'code' | 'message') => void; onClose: () => void;
}) {
    const problems = inviteDraftProblems(draft);
    const invalid = Object.keys(problems).length > 0;
    const field = (key: keyof InviteDraft) => (event: { target: { value: string } }) => onDraft({ ...draft, [key]: event.target.value });
    return <Dialog open={state.phase !== 'closed'} fullWidth maxWidth="sm" aria-labelledby="invite-dialog-title"
        onClose={(_, reason) => { if (busy || (state.phase === 'issued' && reason === 'backdropClick')) return; onClose(); }}>
        <DialogTitle id="invite-dialog-title">{state.phase === 'issued' ? '邀请码已生成' : '发放注册邀请码'}</DialogTitle>
        {state.phase === 'issued' ? <>
            <DialogContent><InviteCodeContent issued={state.issued} copied={copied} onCopy={onCopy} /></DialogContent>
            <DialogActions><Button variant="contained" onClick={onClose}>我已保存，关闭</Button></DialogActions>
        </> : state.phase === 'form' ? <>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Alert severity="info" sx={{ mb: 2.5 }}>小范围测试期间只开放邀请注册。完整邀请码只在生成后显示一次，列表与详情只保留尾号。</Alert>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                    <Input label="可用次数" type="number" required value={draft.maxUses} onChange={field('maxUses')} inputProps={{ min: 1, max: 500, step: 1 }}
                        error={Boolean(problems.maxUses)} helperText={problems.maxUses ?? '1～500，每注册一个账号用掉一次'} />
                    <Input label="有效天数" type="number" required value={draft.expiresInDays} onChange={field('expiresInDays')} inputProps={{ min: 1, max: 90, step: 1 }}
                        error={Boolean(problems.expiresInDays)} helperText={problems.expiresInDays ?? '1～90 天，从现在开始计算'} />
                </Box>
                <Input label="备注（选填）" value={draft.note} onChange={field('note')} fullWidth multiline minRows={2} sx={{ mt: 2 }}
                    placeholder="例如：计算机学院 2026 级试点班" error={Boolean(problems.note)} helperText={`${problems.note ?? '只给工作人员看'}；${noteLength(draft.note)}/100`} />
            </DialogContent>
            <DialogActions>
                <Button disabled={busy} onClick={onClose}>取消</Button>
                <Button variant="contained" disabled={invalid || busy} onClick={onSubmit}>{busy ? '生成中…' : '生成邀请码'}</Button>
            </DialogActions>
        </> : null}
    </Dialog>;
}

/** 列表页的「发放邀请码」：只对有 registration-invites:write 的工作人员（学校管理员）显示。 */
export function CreateInviteButton() {
    const { canAccess } = useCanAccess({ resource: INVITE_RESOURCE, action: 'write' });
    const refresh = useRefresh();
    const [state, dispatch] = useReducer(inviteDialogReducer, CLOSED_INVITE_DIALOG);
    const [draft, setDraft] = useState<InviteDraft>({ ...INVITE_DEFAULTS });
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState<CopyState>('');
    if (!canAccess && state.phase === 'closed') return null;
    const open = () => { setDraft({ ...INVITE_DEFAULTS }); setError(''); setCopied(''); dispatch({ type: 'open' }); };
    const close = () => { setCopied(''); setError(''); setDraft({ ...INVITE_DEFAULTS }); dispatch({ type: 'close' }); };
    const submit = async () => {
        if (busy || Object.keys(inviteDraftProblems(draft)).length) return;
        setBusy(true); setError('');
        try {
            const payload = invitePayload(draft);
            const invite = await createRegistrationInvite(draft);
            if (!invite?.code) throw new HttpError(MISSING_CODE, 502);
            dispatch({ type: 'issued', issued: { code: invite.code, days: payload.expiresInDays, maxUses: invite.maxUses ?? payload.maxUses, expiresAt: invite.expiresAt } });
            setDraft({ ...INVITE_DEFAULTS });
            refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '发放失败，请重试');
            if (failure instanceof HttpError && failure.status === 502) refresh();
        } finally { setBusy(false); }
    };
    const copy = async (kind: 'code' | 'message') => {
        if (state.phase !== 'issued') return;
        const text = kind === 'code' ? state.issued.code : inviteMessage(state.issued.code, state.issued.days);
        try { await navigator.clipboard.writeText(text); setCopied(kind); } catch { setCopied('failed'); }
    };
    return <>
        {canAccess && <Button variant="contained" startIcon={<AddIcon />} onClick={open} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>发放邀请码</Button>}
        <InviteDialog state={state} draft={draft} busy={busy} error={error} copied={copied} onDraft={setDraft} onSubmit={() => void submit()} onCopy={kind => void copy(kind)} onClose={close} />
    </>;
}

// ───────────── 撤销：需要确认 ─────────────

/** 撤销按钮（列表行与详情页）：只对学校管理员显示，且只针对状态为「有效」的邀请码。 */
export function RevokeInviteButton({ record: given }: { record?: RegistrationInviteRecord; label?: string }) {
    const context = useRecordContext<RegistrationInviteRecord>();
    const record = given ?? context;
    const { canAccess } = useCanAccess({ resource: INVITE_RESOURCE, action: 'write' });
    const notify = useNotify(), refresh = useRefresh(), titleId = useId();
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (!record || !canAccess || record.status !== 'ACTIVE') return null;
    const revoke = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            await revokeRegistrationInvite(record.id);
            setOpen(false); notify('邀请码已撤销', { type: 'success' }); refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '撤销失败，请重试');
            if ((failure as { status?: number }).status === 409) refresh();
        } finally { setBusy(false); }
    };
    // 弹窗通过 portal 渲染，但 React 事件仍会冒泡到表格行：在这里拦下，避免点击弹窗时打开详情。
    return <Box component="span" onClick={event => event.stopPropagation()}>
        <Button color="error" size="small" startIcon={<BlockIcon fontSize="small" />} onClick={() => { setError(''); setOpen(true); }}>撤销</Button>
        <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} fullWidth maxWidth="xs" aria-labelledby={titleId}>
            <DialogTitle id={titleId}>撤销邀请码</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Typography>{`确定撤销尾号 ${record.codeHint} 的邀请码吗？`}</Typography>
                <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1.5 }}>{`已用 ${usageText(record)} 次。撤销后不能再用它注册，也不能恢复。`}</Typography>
            </DialogContent>
            <DialogActions>
                <Button disabled={busy} onClick={() => setOpen(false)}>取消</Button>
                <Button variant="contained" color="error" disabled={busy} onClick={() => void revoke()}>{busy ? '撤销中…' : '确认撤销'}</Button>
            </DialogActions>
        </Dialog>
    </Box>;
}

// ───────────── 列表与详情 ─────────────

export function InviteStatusChip({ status }: { status: unknown }) {
    const key = String(status ?? '');
    const color = key === 'ACTIVE' ? 'success' : key === 'REVOKED' ? 'error' : key === 'USED_UP' ? 'info' : 'default';
    return <Chip size="small" color={color} label={inviteStatusLabel(status)} variant="outlined" />;
}
function InviteStatusField(_: FieldProps) { const record = useRecordContext<RegistrationInviteRecord>(); return record ? <InviteStatusChip status={record.status} /> : null; }
function CodeHintField(_: FieldProps) {
    const record = useRecordContext<RegistrationInviteRecord>();
    return record ? <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, letterSpacing: 1 }}>{record.codeHint || '—'}</Typography> : null;
}
function UsageField(_: FieldProps) { const record = useRecordContext<RegistrationInviteRecord>(); return record ? <Typography component="span" sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>{usageText(record)}</Typography> : null; }
function IssuerField(_: FieldProps) { const record = useRecordContext<RegistrationInviteRecord>(); return record ? <Typography component="span" sx={{ fontSize: 12 }}>{issuerText(record.createdBy)}</Typography> : null; }

const statusChoices = Object.entries(inviteStatusNames).map(([id, name]) => ({ id, name }));
const EXPORT_MAX = SIZE_PAGED[INVITE_RESOURCE];
export function RegistrationInvitesList() {
    return <><PageHeading title="注册邀请码" description="小范围测试期间只开放邀请注册。学校管理员在这里发放与撤销邀请码；完整邀请码只在发放时显示一次，列表只保留尾号。" eyebrow="INVITE ONLY / 邀请注册" action={<CreateInviteButton />} />
        <List actions={<ListActions exportMax={EXPORT_MAX} />} perPage={25} filters={[<SelectInput key="status" source="status" label="状态" choices={statusChoices} alwaysOn />]}>
            <ListSummary exportMax={EXPORT_MAX} /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
                <CodeHintField source="codeHint" label="尾号" sortable={false} />
                <UsageField source="usedCount" label="已用/上限" sortable={false} />
                <DateField locales="zh-CN" source="expiresAt" label="到期" showTime sortable={false} />
                <TextField source="note" label="备注" sortable={false} emptyText="—" />
                <IssuerField source="createdBy" label="发放人" sortable={false} />
                <InviteStatusField source="status" label="状态" sortable={false} />
                <RevokeInviteButton label="操作" />
            </DatagridConfigurable>
        </List></>;
}

function Info({ label, children }: { label: string; children?: ReactNode }) {
    return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px 1fr' }, gap: 1, py: 1.2, borderBottom: '1px solid #edf1ef' }}><Typography color="text.secondary" sx={{ fontSize: 12 }}>{label}</Typography><Box sx={{ fontSize: 13, overflowWrap: 'anywhere' }}>{children ?? '—'}</Box></Box>;
}
function InviteUses({ uses }: { uses: InviteUse[] }) {
    const { canAccess: canReadUsers } = useCanAccess({ resource: 'users', action: 'show' });
    if (!uses.length) return <Typography color="text.secondary" sx={{ fontSize: 13, py: 2 }}>还没有人用这个邀请码注册。</Typography>;
    return <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label="使用记录">
        <TableHead><TableRow><TableCell>用户</TableCell><TableCell>用户编号</TableCell><TableCell>使用时间</TableCell></TableRow></TableHead>
        <TableBody>{uses.map(use => <TableRow key={`${use.userId}-${use.usedAt}`}>
            <TableCell>{canReadUsers ? <Button component={Link} to={`/users/${encodeURIComponent(use.userId)}/show`} size="small" sx={{ px: 0, minWidth: 0 }}>{use.nickname || '未提供昵称'}</Button> : use.nickname || '未提供昵称'}</TableCell>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{use.userId}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{time(use.usedAt)}</TableCell>
        </TableRow>)}</TableBody>
    </Table></Box>;
}
function InviteDetails() {
    const record = useRecordContext<RegistrationInviteRecord>();
    const { canAccess } = useCanAccess({ resource: INVITE_RESOURCE, action: 'write' });
    if (!record) return null;
    const uses = record.uses ?? [];
    return <>
        <Card><CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}><InviteStatusChip status={record.status} /><Typography variant="h6">{`尾号 ${record.codeHint}`}</Typography></Box>
            <Divider sx={{ my: 2 }} />
            <Info label="已用 / 上限">{usageText(record)}</Info>
            <Info label="到期时间">{time(record.expiresAt)}</Info>
            <Info label="备注">{record.note || '—'}</Info>
            <Info label="发放人">{issuerText(record.createdBy)}</Info>
            <Info label="发放时间">{time(record.createdAt)}</Info>
            {record.revokedAt != null && <Info label="撤销时间">{time(record.revokedAt)}</Info>}
            <Box sx={{ mt: 3 }}>
                {canAccess === false ? <Alert severity="info">只读查看：发放和撤销邀请码需要学校管理员权限。</Alert>
                    : record.status === 'ACTIVE' ? <RevokeInviteButton record={record} />
                        : <Typography color="text.secondary" sx={{ fontSize: 12 }}>{`这个邀请码${inviteStatusLabel(record.status)}，不能再用于注册。`}</Typography>}
            </Box>
        </CardContent></Card>
        <Card sx={{ mt: 3 }}><CardContent sx={{ p: 3 }}>
            <Typography variant="h6">{`使用记录（${uses.length}）`}</Typography>
            <Divider sx={{ my: 2 }} />
            <InviteUses uses={uses} />
        </CardContent></Card>
    </>;
}
export function RegistrationInviteShow() {
    return <><PageHeading title="邀请码详情" description="核对邀请码的使用情况。完整邀请码只在发放时显示一次，这里只显示尾号。" eyebrow="INVITE ONLY / 邀请注册" action={<Button component={Link} to={`/${INVITE_RESOURCE}`} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>返回邀请码列表</Button>} />
        <Show actions={false} component="div" title="邀请码详情"><InviteDetails /></Show></>;
}
