import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField as Input, Typography } from '@mui/material';
import KeyIcon from '@mui/icons-material/KeyOutlined';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import { useCanAccess, useGetIdentity, useRecordContext, type Identifier } from 'react-admin';
import { HttpError } from './HttpError';
import { request } from './http';

/**
 * 阶段 3：人工找回密码。学校管理员线下核对身份后为本校用户签发一次性重置码。
 *
 * 重置码只在这次响应里出现一次，因此：
 * - 直接用 request 调用接口，不经过 dataProvider / react-query，结果不进入任何查询缓存或 react-admin store；
 * - 只保存在弹窗组件自己的 state 里，关闭弹窗立即清空；不写 localStorage / sessionStorage，不打印日志。
 */
export interface PasswordResetTicket { ticketId: string; code: string; expiresAt: number }
export const RESET_CODE_WARNING = '只显示这一次；请在线下核对身份后当面交给本人；30 分钟内有效，最多 5 次错误；重新签发会让旧码作废';

/** 与后端 AccountService.issueResetCode 一致：说明必填、1～500 字、不能包含尖括号。不满足时返回原因，不发请求。 */
export function resetNoteProblem(note: string): string {
    const text = note.trim();
    if (!text) return '请写明做了哪些身份核对';
    if (text.length > 500) return '说明最多 500 字';
    if (/[<>]/.test(text)) return '说明不能包含尖括号';
    return '';
}
export function issuePasswordReset(userId: Identifier, note: string): Promise<PasswordResetTicket> {
    const problem = resetNoteProblem(note);
    if (problem) return Promise.reject(new HttpError(problem, 400));
    return request<PasswordResetTicket>(`/v1/admin/users/${encodeURIComponent(String(userId))}/password-reset`, { method: 'POST', body: JSON.stringify({ note: note.trim() }) });
}

/** 重置码与警示（弹窗正文）。 */
export function ResetCodeContent({ ticket, nickname, copied, onCopy }: { ticket: PasswordResetTicket; nickname?: string; copied: '' | 'ok' | 'failed'; onCopy: () => void }) {
    return <>
        <Alert severity="warning" role="alert" sx={{ mb: 2 }}>{RESET_CODE_WARNING}</Alert>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>{nickname ? `用户「${nickname}」的重置码` : '重置码'}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>
            <Typography aria-label="重置码" sx={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, letterSpacing: 2, userSelect: 'all' }}>{ticket.code}</Typography>
            <Button variant="outlined" size="small" startIcon={<CopyIcon fontSize="small" />} onClick={onCopy}>复制重置码</Button>
        </Box>
        {copied === 'ok' && <Typography role="status" sx={{ fontSize: 12, mt: 1, color: 'success.main' }}>已复制，请当面交给本人，不要通过聊天工具转发。</Typography>}
        {copied === 'failed' && <Typography role="status" sx={{ fontSize: 12, mt: 1, color: 'error.main' }}>复制失败，请手动抄写。</Typography>}
        <Typography sx={{ fontSize: 12, mt: 2 }} color="text.secondary">有效期至 {new Date(ticket.expiresAt).toLocaleString('zh-CN', { hour12: false })}。关闭后无法再次查看。</Typography>
    </>;
}
/** 只显示一次的重置码。ticket 为 null（已关闭）时不渲染重置码。 */
export function ResetCodeDialog({ ticket, nickname, onClose }: { ticket: PasswordResetTicket | null; nickname?: string; onClose: () => void }) {
    const [copied, setCopied] = useState<'' | 'ok' | 'failed'>('');
    const close = () => { setCopied(''); onClose(); };
    const copy = async () => {
        if (!ticket) return;
        try { await navigator.clipboard.writeText(ticket.code); setCopied('ok'); } catch { setCopied('failed'); }
    };
    return <Dialog open={ticket !== null} onClose={(_, reason) => { if (reason !== 'backdropClick') close(); }} fullWidth maxWidth="sm" aria-labelledby="reset-code-title">
        <DialogTitle id="reset-code-title">重置码已签发</DialogTitle>
        {ticket && <DialogContent><ResetCodeContent ticket={ticket} nickname={nickname} copied={copied} onCopy={() => void copy()} /></DialogContent>}
        <DialogActions><Button variant="contained" onClick={close}>我已记下，关闭</Button></DialogActions>
    </Dialog>;
}

/** 用户详情页的「签发重置码」：只对有 users:write 的工作人员显示；自己的账号与已注销账号不显示。 */
export function PasswordResetAction() {
    const record = useRecordContext();
    const { canAccess } = useCanAccess({ resource: 'users', action: 'edit' });
    const { identity } = useGetIdentity();
    const [confirming, setConfirming] = useState(false);
    const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [ticket, setTicket] = useState<PasswordResetTicket | null>(null);
    if (!record || !canAccess || !identity || record.deleted || String(identity.id) === String(record.id)) return null;
    const problem = resetNoteProblem(note);
    const open = () => { setNote(''); setError(''); setConfirming(true); };
    const submit = async () => {
        if (problem || busy) return;
        setBusy(true); setError('');
        try {
            const issued = await issuePasswordReset(record.id, note);
            setConfirming(false); setNote(''); setTicket(issued);
        } catch (failure) { setError(failure instanceof Error ? failure.message : '签发失败，请重试'); }
        finally { setBusy(false); }
    };
    return <>
        <Button startIcon={<KeyIcon />} onClick={open}>签发重置码</Button>
        <Dialog open={confirming} onClose={() => { if (!busy) setConfirming(false); }} fullWidth maxWidth="sm" aria-labelledby="reset-confirm-title">
            <DialogTitle id="reset-confirm-title">为「{record.nickname ?? '该用户'}」签发重置码</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Alert severity="info" sx={{ mb: 2 }}>只在线下核对本人身份后签发。签发后旧码立即作废；重置成功后该用户的全部登录会话结束。</Alert>
                <Input label="身份核对说明" required value={note} onChange={event => setNote(event.target.value)} multiline minRows={3} fullWidth inputProps={{ maxLength: 500 }}
                    placeholder="例如：本人持学生证到办公室，已核对照片与学号" helperText={note && problem ? problem : `必填，写明做了哪些身份核对；${note.length}/500`} error={Boolean(note && problem)} />
            </DialogContent>
            <DialogActions><Button disabled={busy} onClick={() => setConfirming(false)}>取消</Button>
                <Button variant="contained" disabled={Boolean(problem) || busy} onClick={() => void submit()}>{busy ? '签发中…' : '确认签发'}</Button></DialogActions>
        </Dialog>
        <ResetCodeDialog ticket={ticket} nickname={record.nickname} onClose={() => setTicket(null)} />
    </>;
}
