import {
    Admin, Resource, List, Datagrid, DatagridConfigurable, TextField, NumberField, DateField, BooleanField,
    Show, SimpleShowLayout, Edit, SimpleForm, SelectInput, TextInput,
    NumberInput, ArrayField, FunctionField, EditButton,
    TopToolbar, ListButton, required, useRecordContext,
    useNotify, useRefresh, useCanAccess, useListContext, ListBase,
} from 'react-admin';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, TextField as MuiTextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authProvider } from './authProvider';
import { dataProvider } from './dataProvider';
import { request } from './http';
import { i18nProvider } from './i18n';
import { AdminLayout, AdminLogin, resourceIcons } from './AdminLayout';
import Dashboard from './Dashboard';
import StaffPermissions from './StaffPermissions';
import { adminTheme } from './theme';
import { ListActions, ListSummary } from './ListTools';
import { OrdersList, OrderShow } from './Orders';
import { ProductsList, ProductShow } from './Products';
import { RoleRequestsList, RoleRequestShow } from './RoleRequests';
import { ReadAuditList } from './ReadAudit';
import { PasswordResetAction } from './PasswordReset';
import { RegistrationInvitesList, RegistrationInviteShow } from './RegistrationInvites';
import { CampusField } from './CampusUi';
import { PageHeading, IdentifierField, RoleField, StatusField, ActionCodeField, ReasonCodeField, ScopeField, ROLES, statusNames, targetNames, resourceNames, decisionActionChoices, decisionReasonChoices } from './adminUi';

const readActions = <TopToolbar><ListButton /><EditButton /></TopToolbar>;
const search = [<TextInput key="q" source="q" label="搜索" alwaysOn />];
const defaultSort = { field: 'createdAt', order: 'DESC' as const };
export function UsersList() { return <><PageHeading title="用户与工作人员" description="查看本校校园账号，管理工作人员角色与访问权限。" eyebrow="PEOPLE / 用户管理" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <TextField source="nickname" label="昵称" /><TextField source="account" label="账号" sortable={false} />
    <CampusField source="campus" label="校区" sortable={false} /><RoleField source="role" label="后台角色" sortable={false} />
    <BooleanField source="active" label="后台权限启用" sortable={false} /><AccountStateField source="deleted" label="账户状态" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="注册时间" showTime />
    <StaffConfigButton label="配置权限" />
</DatagridConfigurable></List></>; }
/** 阶段 3：已注销的账号（deleted=true）显示「已注销」，不能配置后台权限或签发重置码（服务端同样拒绝）。 */
function AccountStateField(_: { source?: string; label?: string; sortable?: boolean }) {
    const record = useRecordContext();
    return record?.deleted ? <Chip size="small" color="default" label="已注销" variant="outlined" /> : <Chip size="small" color="success" label="正常" variant="outlined" />;
}
function StaffConfigButton({ label }: { label?: string }) {
    const record = useRecordContext();
    return record?.deleted ? null : <EditButton label={label} />;
}
const userActions = <TopToolbar><ListButton /><StaffConfigButton label="配置权限" /><PasswordResetAction /></TopToolbar>;
export function UserShow() { return <><PageHeading title="用户详情" description="查看校园账号信息与当前后台访问权限。" /><Show actions={userActions}><SimpleShowLayout className="record-details">
    <TextField source="id" label="用户编号" /><TextField source="nickname" label="昵称" /><AccountStateField label="账户状态" /><TextField source="account" label="账号" />
    <CampusField source="campus" label="校区" /><RoleField source="role" label="后台角色" /><BooleanField source="active" label="后台权限启用" />
    <DateField locales="zh-CN" source="createdAt" label="注册时间" showTime />
</SimpleShowLayout></Show></>; }
const caseStatuses = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'APPEALED'].map(id => ({ id, name: statusNames[id] ?? id }));
function CasesList() { return <><PageHeading title="治理案件" description="集中查看举报、证据与处理记录，维护校园社区秩序。" eyebrow="MODERATION / 社区治理" /><List actions={<ListActions />} perPage={25} sort={defaultSort} filters={[<SelectInput key="status" source="status" label="案件状态" choices={caseStatuses} alwaysOn />, <SelectInput key="targetType" source="targetType" label="目标类型" choices={Object.entries(targetNames).map(([id, name]) => ({ id, name }))} alwaysOn />]}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <IdentifierField source="id" label="案件编号" sortable={false} /><FunctionField label="目标类型" render={record => targetNames[record.targetType] ?? record.targetType} />
    <StatusField source="status" label="案件状态" sortable={false} /><NumberField source="reportCount" label="举报数" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="创建时间" showTime sortable={false} /><EditButton label="处理" />
</DatagridConfigurable></List></>; }
export function CaseShow() { return <><PageHeading title="案件详情" description="查看举报依据与历史处理记录，审慎评估后再采取措施。" /><Show actions={readActions}><SimpleShowLayout>
    <TextField source="id" label="案件编号" /><TextField source="target.label" label="目标" /><StatusField source="status" label="状态" />
    <CaseEvidenceLink />
    <ArrayField source="reports" label="举报依据"><Datagrid bulkActionButtons={false}>
        <ReasonCodeField source="reasonCode" label="原因" /><TextField source="note" label="说明" /><TextField source="snapshot" label="提交时快照" />
        <DateField locales="zh-CN" source="createdAt" label="时间" showTime />
    </Datagrid></ArrayField>
    <ArrayField source="actions" label="处理记录"><Datagrid bulkActionButtons={false}>
        <ActionCodeField source="actionCode" label="动作" /><ReasonCodeField source="reasonCode" label="原因" /><TextField source="note" label="说明" />
        <BooleanField source="effective" label="已生效" /><DateField locales="zh-CN" source="createdAt" label="时间" showTime />
    </Datagrid></ArrayField>
</SimpleShowLayout></Show></>; }
function CaseEvidenceLink() {
    const record = useRecordContext();
    return record?.id ? <Button href={`/moderation/cases/${encodeURIComponent(record.id)}`}>查看完整案件证据</Button> : null;
}
function CaseDecisionForm() {
    const record = useRecordContext();
    const actions = decisionActionChoices(record?.allowedActions ?? []);
    if (!actions.length) return <Alert sx={{ m: 2 }} severity="info">当前案件没有可用处理动作，可能已结案、已由其他人领取或需要更高级权限。</Alert>;
    return <SimpleForm className="admin-form">
        <TextField source="target.label" label="处理目标" />
        <CaseEvidenceLink />
        <SelectInput source="action" label="处理动作" choices={actions} validate={required()} />
        <SelectInput source="reasonCode" label="处理原因" choices={decisionReasonChoices} validate={required()} />
        <TextInput source="note" label="处理说明" multiline inputProps={{ maxLength: 500 }} />
        <NumberInput source="durationHours" label="限制时长（小时，仅限制类动作需要）" min={1} max={720} />
        <Alert severity="info">提交后立即生效。平台会校验学校、案件状态、利益冲突和角色权限。</Alert>
    </SimpleForm>;
}
export function CaseEdit() { return <><PageHeading title="处理治理案件" description="结合案件证据选择适当措施，提交后立即生效。" eyebrow="CASE DECISION / 案件处理" /><Edit mutationMode="pessimistic" title="处理治理案件"><CaseDecisionForm /></Edit></>; }
function AppealDecision() {
    const record = useRecordContext(); const { canAccess } = useCanAccess({ resource: 'appeals', action: 'edit' });
    const [open, setOpen] = useState(false); const [note, setNote] = useState(''); const [pending, setPending] = useState(false);
    const notify = useNotify(); const refresh = useRefresh();
    if (!record?.decidable || !canAccess) return null;
    const decide = async (accept: boolean) => {
        setPending(true);
        try {
            await request(`/v1/admin/appeals/${encodeURIComponent(record.id)}/decision`, { method: 'POST', body: JSON.stringify({ accept, reasonCode: accept ? 'APPEAL_ACCEPTED' : 'APPEAL_REJECTED', note: note || undefined }) });
            setOpen(false); notify('申诉已处理', { type: 'success' }); refresh();
        } catch (error) { notify(error instanceof Error ? error.message : '处理失败', { type: 'error' }); }
        finally { setPending(false); }
    };
    return <><Button onClick={event => { event.stopPropagation(); setOpen(true); }}>复核</Button>
        <Dialog open={open} onClose={() => !pending && setOpen(false)} fullWidth maxWidth="sm"><DialogTitle>复核申诉</DialogTitle><DialogContent>
            <Typography sx={{ mb: 2 }}>{record.reason}</Typography>
            <MuiTextField label="复核说明" fullWidth multiline minRows={4} inputProps={{ maxLength: 500 }} value={note} onChange={e => setNote(e.target.value)} />
        </DialogContent><DialogActions><Button disabled={pending} onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={pending} color="error" onClick={() => void decide(false)}>驳回申诉</Button>
            <Button disabled={pending} onClick={() => void decide(true)}>接受申诉</Button>
        </DialogActions></Dialog>
    </>;
}
export function AppealsList() { return <><PageHeading title="用户申诉" description="复核用户申诉，对处理结果作出公正的判断。" eyebrow="APPEALS / 申诉复核" /><List actions={<ListActions />} perPage={25} sort={defaultSort} filters={[<SelectInput key="status" source="status" label="申诉状态" choices={['PENDING', 'ACCEPTED', 'REJECTED'].map(id => ({ id, name: statusNames[id] }))} alwaysOn />]}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick={false}>
    <IdentifierField source="id" label="申诉编号" sortable={false} /><TextField source="reason" label="申诉原因" sortable={false} />
    <TextField source="subject.kind" label="申诉对象" sortable={false} /><ActionCodeField source="subject.actionCode" label="原处理动作" sortable={false} />
    <ScopeField source="subject.scope" label="限制范围" sortable={false} /><StatusField source="status" label="状态" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="时间" showTime sortable={false} /><AppealDecision />
</DatagridConfigurable></List></>; }
export function AuditList() { return <><PageHeading title="授权审计" description="追踪人员授权变更，查看操作人、原因与前后状态。" eyebrow="AUDIT LOG / 安全审计" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <IdentifierField source="actorId" label="操作人编号" sortable={false} /><IdentifierField source="targetId" label="授权对象编号" sortable={false} />
    <RoleField source="newRole" label="新角色" sortable={false} /><BooleanField source="newActive" label="启用" sortable={false} />
    <TextField source="note" label="原因" sortable={false} /><IdentifierField source="confirmedBy" label="确认人编号" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="时间" showTime />
</DatagridConfigurable></List></>; }
export function AuditShow() { return <><PageHeading title="授权记录详情" description="核对权限变更前后状态与操作追踪编号。" /><Show><SimpleShowLayout className="record-details">
    <TextField source="actorId" label="操作人编号" /><TextField source="targetId" label="授权对象编号" />
    <RoleField source="oldRole" label="原角色" /><RoleField source="newRole" label="新角色" />
    <BooleanField source="oldActive" label="原启用状态" /><BooleanField source="newActive" label="新启用状态" />
    <TextField source="note" label="原因" /><TextField source="requestId" label="操作追踪编号" />
    {/* 阶段 2：涉及学校管理员的变更由另一位学校管理员确认，审计同时记录确认人与对应的复核请求；一人完成的变更这两项为空。 */}
    <TextField source="confirmedBy" label="确认人编号" emptyText="无需确认（一人完成）" /><RoleRequestLink label="关联复核请求" />
    <DateField locales="zh-CN" source="createdAt" label="时间" showTime />
</SimpleShowLayout></Show></>; }
function RoleRequestLink(_: { label?: string }) {
    const record = useRecordContext(); const { canAccess } = useCanAccess({ resource: 'role-requests', action: 'show' });
    if (!record?.roleRequestId) return <Typography component="span">—</Typography>;
    return canAccess ? <Button component={Link} to={`/role-requests/${encodeURIComponent(record.roleRequestId)}/show`} sx={{ px: 0 }}>{record.roleRequestId}</Button> : <Typography component="span">{record.roleRequestId}</Typography>;
}
function RoleCards() {
    const { data, isPending, error } = useListContext();
    if (isPending) return <Typography color="text.secondary">正在加载角色权限…</Typography>;
    if (error) return <Alert severity="error">角色权限读取失败，请刷新重试</Alert>;
    return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>{data.map(record => <Card key={record.id}><CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="h5">{record.name}</Typography><Chip size="small" label="固定角色" variant="outlined" /></Box>
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1, minHeight: 44, lineHeight: 1.8 }}>{ROLES.find(role => role.id === record.id)?.description}</Typography><Divider sx={{ my: 2 }} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{record.permissions.map((permission: string) => { const [resource, action] = permission.split(':'); return <Chip key={permission} size="small" label={`${resourceNames[resource] ?? resource} · ${action === 'write' ? '管理' : '查看'}`} color={action === 'write' ? 'success' : 'default'} variant="outlined" />; })}</Box>
    </CardContent></Card>)}</Box>;
}
function RolesList() { return <><PageHeading title="角色权限" description="了解四种固定角色的职责边界，为工作人员分配合适的权限。" eyebrow="ROLE MATRIX / 权限矩阵" /><ListBase perPage={25} sort={{ field: 'id', order: 'ASC' }}><RoleCards /></ListBase></>; }
export default function App() {
    return <Admin layout={AdminLayout} loginPage={AdminLogin} theme={adminTheme} darkTheme={null} defaultTheme="light" title="校园集市 · 管理后台" dataProvider={dataProvider} authProvider={authProvider} dashboard={Dashboard} i18nProvider={i18nProvider} requireAuth>
        <Resource icon={resourceIcons.users} name="users" options={{ label: '用户与工作人员' }} list={UsersList} show={UserShow} edit={StaffPermissions} />
        {/* 邀请注册：发放在列表页的弹窗里完成（完整邀请码只显示一次），撤销走专用接口；没有新建 / 编辑视图。 */}
        <Resource icon={resourceIcons['registration-invites']} name="registration-invites" options={{ label: resourceNames['registration-invites'] }} list={RegistrationInvitesList} show={RegistrationInviteShow} />
        <Resource icon={resourceIcons.products} name="products" options={{ label: '商品目录' }} list={ProductsList} show={ProductShow} />
        {/* 站内交易已停用（V16）：历史订单只读，不提供 edit / create。 */}
        <Resource icon={resourceIcons.orders} name="orders" options={{ label: resourceNames.orders }} list={OrdersList} show={OrderShow} />
        <Resource icon={resourceIcons.cases} name="cases" options={{ label: '治理案件' }} list={CasesList} show={CaseShow} edit={CaseEdit} />
        <Resource icon={resourceIcons.appeals} name="appeals" options={{ label: '用户申诉' }} list={AppealsList} />
        <Resource icon={resourceIcons.audit} name="audit" options={{ label: '授权审计' }} list={AuditList} show={AuditShow} />
        {/* 阶段 2：两人复核与读取留痕。复核请求只通过确认 / 驳回 / 撤回接口处理，没有编辑视图；读取审计只有列表。 */}
        <Resource icon={resourceIcons['role-requests']} name="role-requests" options={{ label: resourceNames['role-requests'] }} list={RoleRequestsList} show={RoleRequestShow} />
        <Resource icon={resourceIcons['read-audit']} name="read-audit" options={{ label: resourceNames['read-audit'] }} list={ReadAuditList} />
        <Resource icon={resourceIcons.roles} name="roles" options={{ label: '角色权限' }} list={RolesList} />
    </Admin>;
}
