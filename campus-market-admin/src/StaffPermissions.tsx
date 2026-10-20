import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from '@mui/material';
import { Edit, SimpleForm, SelectInput, BooleanInput, TextInput, required, FormDataConsumer, useGetIdentity, useRecordContext, useSaveContext, useNotify, useRedirect, type RaRecord } from 'react-admin';
import ShieldIcon from '@mui/icons-material/VerifiedUserOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import { PageHeading, PENDING_ROLE_REQUEST_NOTICE, ROLES, needsSecondAdmin, roleName, staffStateText } from './adminUi';

function SectionTitle({ number, title }: { number: string; title: string }) { return <Box className="section-title"><span>{number}</span><Typography variant="h6">{title}</Typography></Box>; }
const noteValidation = [required(), (value: string) => value?.trim() ? undefined : '请填写实际的授权或停用原因'];
/** 后端 PATCH /users/{id}/staff 的结果：涉及学校管理员时只生成一条待确认的复核请求（pendingRoleRequest），变更尚未生效。 */
export interface PendingRoleRequest { id: string; status: string; newRole: string; newActive: boolean; oldRole?: string | null; oldActive?: boolean | null; expiresAt?: number }
export function staffSaveOutcome(result: unknown): { pending: PendingRoleRequest | null; message: string } {
    const pending = (result as { pendingRoleRequest?: PendingRoleRequest } | null)?.pendingRoleRequest ?? null;
    return pending ? { pending, message: PENDING_ROLE_REQUEST_NOTICE } : { pending: null, message: '工作人员权限已更新' };
}
export function PendingRoleRequestNotice({ request }: { request: PendingRoleRequest }) {
    return <Alert severity="warning" role="status" aria-label="待确认的人员变更" sx={{ mb: 2 }}
        action={<Button component={Link} to={`/role-requests/${encodeURIComponent(request.id)}/show`} color="inherit" size="small">查看复核请求</Button>}>
        <strong>{PENDING_ROLE_REQUEST_NOTICE}</strong>
        <Typography sx={{ fontSize: 12, mt: .5 }}>待确认的变更：{staffStateText(request.oldRole, request.oldActive)} → {staffStateText(request.newRole, request.newActive)}。当前权限保持不变{request.expiresAt ? `；${new Date(request.expiresAt).toLocaleString('zh-CN', { hour12: false })} 前未确认将自动过期` : ''}。</Typography>
    </Alert>;
}
function StaffForm() {
    const record = useRecordContext(); const { data: me } = useGetIdentity(); const { save, saving } = useSaveContext();
    const [draft, setDraft] = useState<Partial<RaRecord> | null>(null);
    const [pending, setPending] = useState<PendingRoleRequest | null>(null);
    const [saveError, setSaveError] = useState(''); const notify = useNotify(); const redirect = useRedirect();
    if (!record) return null;
    if (!me) return <Alert sx={{ m: 3 }}>正在核对当前工作人员身份…</Alert>;
    if (record.id === me.id) return <Alert severity="info" sx={{ m: 3 }}>不能修改自己的后台权限，请由其他学校管理员操作。</Alert>;
    if (record.deleted) return <Alert severity="info" sx={{ m: 3 }}>该账号已注销，不能授予后台权限。</Alert>;
    const twoPerson = needsSecondAdmin(record.role, draft?.role);
    const confirm = async () => {
        if (!draft || !save) return;
        setSaveError('');
        await save({ ...draft, note: draft.note.trim() }, {
            onSuccess: (result: unknown) => {
                const outcome = staffSaveOutcome(result);
                setDraft(null);
                // 涉及学校管理员：只提交了复核请求，留在本页显示提示，不宣称变更已生效。
                if (outcome.pending) { setPending(outcome.pending); notify(outcome.message, { type: 'info' }); return; }
                notify(outcome.message, { type: 'success' }); redirect('show', 'users', record.id);
            },
            onError: (error: Error) => { setSaveError(error.message || '保存失败，请重试'); },
        });
    };
    return <>{pending && <PendingRoleRequestNotice request={pending} />}<SimpleForm className="admin-form" onSubmit={(values: Partial<RaRecord>) => { setSaveError(''); setDraft(values); }} defaultValues={{ note: '' }}>
        <Box className="staff-profile"><Avatar sx={{ width: 46, height: 46, bgcolor: '#e4efe8', color: '#487c5e' }}>{record.nickname?.slice(0, 1) ?? '用'}</Avatar><Box sx={{ flex: 1 }}><Typography variant="h6">{record.nickname ?? '校园用户'}</Typography><Typography color="text.secondary" sx={{ fontSize: 12, mt: .5 }}>{record.account} · {record.campus}</Typography></Box><Chip label={record.active ? '后台权限已启用' : '后台权限未启用'} color={record.active ? 'success' : 'default'} size="small" variant="outlined" /></Box>
        <SectionTitle number="01" title="分配后台角色" />
        <SelectInput source="role" label="后台角色" choices={ROLES} validate={required()} helperText="选择与工作职责相符的角色" fullWidth />
        <FormDataConsumer>{({ formData }) => { const role = ROLES.find(item => item.id === formData.role); return role ? <Box className="role-preview"><Typography sx={{ fontWeight: 600, color: '#376248' }}>{role.name} · 权限范围</Typography><Typography color="text.secondary" sx={{ mt: .5 }}>{role.description}</Typography><ul>{role.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></Box> : <Alert severity="info" sx={{ mb: 2 }}>选择角色后可预览对应的权限范围。</Alert>; }}</FormDataConsumer>
        <SectionTitle number="02" title="设置访问状态" />
        <BooleanInput source="active" label="启用后台权限" helperText="关闭后立即停止该账号的后台访问" />
        <SectionTitle number="03" title="填写变更原因" />
        <TextInput source="note" label="授权或停用原因" multiline minRows={3} validate={noteValidation} fullWidth inputProps={{ maxLength: 500 }} placeholder="例如：新增校区运营工作人员，负责日常内容审核" helperText="必填，最多 500 字；将与操作人、变更内容一起记录" />
        <FormDataConsumer>{({ formData }) => <Alert severity="info" icon={<InfoIcon fontSize="small" />}>变更仅影响后台权限，普通校园账号仍可登录。{needsSecondAdmin(record.role, formData.role) ? '涉及学校管理员的授予、降级或停用：保存后只提交复核请求，需要另一位学校管理员确认后生效。' : '保存后立即生效。'}</Alert>}</FormDataConsumer>
    </SimpleForm>
        <Dialog open={Boolean(draft)} onClose={() => !saving && setDraft(null)} fullWidth maxWidth="sm" aria-labelledby="staff-confirm-title"><DialogTitle id="staff-confirm-title">确认工作人员权限变更</DialogTitle><DialogContent><Typography sx={{ mb: 2 }}>即将更新「{record.nickname}」的后台访问权限。</Typography>
            <Box sx={{ p: 2, bgcolor: '#f5f8f6', borderRadius: 2 }}><Typography sx={{ mb: 1 }}>角色：{roleName(record.role)} → {roleName(draft?.role)}</Typography><Typography>状态：{record.active ? '已启用' : '未启用'} → {draft?.active ? '启用' : '停用'}</Typography><Divider sx={{ my: 2 }} /><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>变更原因：{draft?.note}</Typography></Box>
            {twoPerson && <Alert severity="info" sx={{ mt: 2 }}>这项变更涉及学校管理员：提交后不会立即生效，需要另一位学校管理员确认（72 小时内有效）。</Alert>}
            {!draft?.active && <Alert severity="warning" sx={{ mt: 2 }}>{twoPerson ? '确认生效后，该账号将失去后台访问权限。' : '该账号将立即失去后台访问权限。'}</Alert>}
            {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
        </DialogContent><DialogActions><Button disabled={saving} onClick={() => setDraft(null)}>返回修改</Button><Button variant="contained" disabled={saving} onClick={() => void confirm()}>{saving ? '正在保存…' : twoPerson ? '提交复核请求' : '确认变更'}</Button></DialogActions></Dialog>
    </>;
}
export default function StaffPermissions() {
    return <Box><PageHeading title="配置工作人员权限" description="按工作职责分配角色，确保每一次授权都有据可查。" eyebrow="ACCESS CONTROL / 人员授权" />
        <Box className="staff-grid"><Edit mutationMode="pessimistic" title="配置工作人员权限" redirect="show"><StaffForm /></Edit><Box>
            <Card><CardContent sx={{ p: 3 }}><ShieldIcon sx={{ color: '#4e8964', mb: 1.5 }} /><Typography variant="h6">授权须知</Typography><Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.9 }} color="text.secondary">权限仅适用于本校。请根据实际职责分配角色，定期核对工作人员的访问状态。</Typography><Divider sx={{ my: 2 }} />
                {['角色决定可查看的数据与可执行的操作', '停用权限会阻止后续后台请求', '涉及学校管理员的授予、降级或停用需另一位学校管理员确认', '每次变更记录操作人、原因和前后状态', '自己的权限由其他管理员调整'].map((text, index) => <Typography key={text} sx={{ display: 'flex', gap: 1.2, fontSize: 12, lineHeight: 1.8, mb: 1.5, color: '#6d8275' }}><span style={{ color: '#95ae9d' }}>0{index + 1}</span>{text}</Typography>)}
            </CardContent></Card>
            <Card sx={{ mt: 2 }}><CardContent sx={{ p: 3 }}><Typography variant="h6" sx={{ mb: 1 }}>角色说明</Typography>{ROLES.map(role => <Box key={role.id} sx={{ mt: 2 }}><Typography sx={{ fontWeight: 600, fontSize: 12 }}>{role.name}</Typography><Typography color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.8, mt: .5 }}>{role.description}</Typography></Box>)}</CardContent></Card>
        </Box></Box>
    </Box>;
}
