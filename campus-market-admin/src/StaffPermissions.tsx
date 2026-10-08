import { useState } from 'react';
import { Alert, Avatar, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from '@mui/material';
import { Edit, SimpleForm, SelectInput, BooleanInput, TextInput, required, FormDataConsumer, useGetIdentity, useRecordContext, useSaveContext, useNotify, useRedirect, type RaRecord } from 'react-admin';
import ShieldIcon from '@mui/icons-material/VerifiedUserOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import { PageHeading, ROLES, roleName } from './adminUi';

function SectionTitle({ number, title }: { number: string; title: string }) { return <Box className="section-title"><span>{number}</span><Typography variant="h6">{title}</Typography></Box>; }
const noteValidation = [required(), (value: string) => value?.trim() ? undefined : '请填写实际的授权或停用原因'];
function StaffForm() {
    const record = useRecordContext(); const { data: me } = useGetIdentity(); const { save, saving } = useSaveContext();
    const [draft, setDraft] = useState<Partial<RaRecord> | null>(null);
    const [saveError, setSaveError] = useState(''); const notify = useNotify(); const redirect = useRedirect();
    if (!record) return null;
    if (!me) return <Alert sx={{ m: 3 }}>正在核对当前工作人员身份…</Alert>;
    if (record.id === me.id) return <Alert severity="info" sx={{ m: 3 }}>不能修改自己的后台权限，请由其他学校管理员操作。</Alert>;
    const confirm = async () => {
        if (!draft || !save) return;
        setSaveError('');
        await save({ ...draft, note: draft.note.trim() }, {
            onSuccess: () => { setDraft(null); notify('工作人员权限已更新', { type: 'success' }); redirect('show', 'users', record.id); },
            onError: (error: Error) => { setSaveError(error.message || '保存失败，请重试'); },
        });
    };
    return <><SimpleForm className="admin-form" onSubmit={(values: Partial<RaRecord>) => { setSaveError(''); setDraft(values); }} defaultValues={{ note: '' }}>
        <Box className="staff-profile"><Avatar sx={{ width: 46, height: 46, bgcolor: '#e4efe8', color: '#487c5e' }}>{record.nickname?.slice(0, 1) ?? '用'}</Avatar><Box sx={{ flex: 1 }}><Typography variant="h6">{record.nickname ?? '校园用户'}</Typography><Typography color="text.secondary" sx={{ fontSize: 12, mt: .5 }}>{record.account} · {record.campus}</Typography></Box><Chip label={record.active ? '后台权限已启用' : '后台权限未启用'} color={record.active ? 'success' : 'default'} size="small" variant="outlined" /></Box>
        <SectionTitle number="01" title="分配后台角色" />
        <SelectInput source="role" label="后台角色" choices={ROLES} validate={required()} helperText="选择与工作职责相符的角色" fullWidth />
        <FormDataConsumer>{({ formData }) => { const role = ROLES.find(item => item.id === formData.role); return role ? <Box className="role-preview"><Typography sx={{ fontWeight: 600, color: '#376248' }}>{role.name} · 权限范围</Typography><Typography color="text.secondary" sx={{ mt: .5 }}>{role.description}</Typography><ul>{role.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></Box> : <Alert severity="info" sx={{ mb: 2 }}>选择角色后可预览对应的权限范围。</Alert>; }}</FormDataConsumer>
        <SectionTitle number="02" title="设置访问状态" />
        <BooleanInput source="active" label="启用后台权限" helperText="关闭后立即停止该账号的后台访问" />
        <SectionTitle number="03" title="填写变更原因" />
        <TextInput source="note" label="授权或停用原因" multiline minRows={3} validate={noteValidation} fullWidth inputProps={{ maxLength: 500 }} placeholder="例如：新增校区运营工作人员，负责日常内容审核" helperText="必填，最多 500 字；将与操作人、变更内容一起记录" />
        <Alert severity="info" icon={<InfoIcon fontSize="small" />}>变更仅影响后台权限，普通校园账号仍可登录。保存后立即生效。</Alert>
    </SimpleForm>
        <Dialog open={Boolean(draft)} onClose={() => !saving && setDraft(null)} fullWidth maxWidth="sm" aria-labelledby="staff-confirm-title"><DialogTitle id="staff-confirm-title">确认工作人员权限变更</DialogTitle><DialogContent><Typography sx={{ mb: 2 }}>即将更新「{record.nickname}」的后台访问权限。</Typography>
            <Box sx={{ p: 2, bgcolor: '#f5f8f6', borderRadius: 2 }}><Typography sx={{ mb: 1 }}>角色：{roleName(record.role)} → {roleName(draft?.role)}</Typography><Typography>状态：{record.active ? '已启用' : '未启用'} → {draft?.active ? '启用' : '停用'}</Typography><Divider sx={{ my: 2 }} /><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>变更原因：{draft?.note}</Typography></Box>
            {!draft?.active && <Alert severity="warning" sx={{ mt: 2 }}>该账号将立即失去后台访问权限。</Alert>}
            {saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}
        </DialogContent><DialogActions><Button disabled={saving} onClick={() => setDraft(null)}>返回修改</Button><Button variant="contained" disabled={saving} onClick={() => void confirm()}>{saving ? '正在保存…' : '确认变更'}</Button></DialogActions></Dialog>
    </>;
}
export default function StaffPermissions() {
    return <Box><PageHeading title="配置工作人员权限" description="按工作职责分配角色，确保每一次授权都有据可查。" eyebrow="ACCESS CONTROL / 人员授权" />
        <Box className="staff-grid"><Edit mutationMode="pessimistic" title="配置工作人员权限" redirect="show"><StaffForm /></Edit><Box>
            <Card><CardContent sx={{ p: 3 }}><ShieldIcon sx={{ color: '#4e8964', mb: 1.5 }} /><Typography variant="h6">授权须知</Typography><Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.9 }} color="text.secondary">权限仅适用于本校。请根据实际职责分配角色，定期核对工作人员的访问状态。</Typography><Divider sx={{ my: 2 }} />
                {['角色决定可查看的数据与可执行的操作', '停用权限会阻止后续后台请求', '每次变更记录操作人、原因和前后状态', '自己的权限由其他管理员调整'].map((text, index) => <Typography key={text} sx={{ display: 'flex', gap: 1.2, fontSize: 12, lineHeight: 1.8, mb: 1.5, color: '#6d8275' }}><span style={{ color: '#95ae9d' }}>0{index + 1}</span>{text}</Typography>)}
            </CardContent></Card>
            <Card sx={{ mt: 2 }}><CardContent sx={{ p: 3 }}><Typography variant="h6" sx={{ mb: 1 }}>角色说明</Typography>{ROLES.map(role => <Box key={role.id} sx={{ mt: 2 }}><Typography sx={{ fontWeight: 600, fontSize: 12 }}>{role.name}</Typography><Typography color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.8, mt: .5 }}>{role.description}</Typography></Box>)}</CardContent></Card>
        </Box></Box>
    </Box>;
}
