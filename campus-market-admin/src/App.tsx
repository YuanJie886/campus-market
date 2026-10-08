import {
    Admin, Resource, List, Datagrid, DatagridConfigurable, TextField, NumberField, DateField, BooleanField,
    Show, SimpleShowLayout, Edit, SimpleForm, SelectInput, TextInput,
    NumberInput, ArrayField, FunctionField, EditButton,
    TopToolbar, ListButton, required, useRecordContext,
    useNotify, useRefresh, useCanAccess, useListContext, ListBase,
} from 'react-admin';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, TextField as MuiTextField, Typography } from '@mui/material';
import { useState } from 'react';
import { authProvider } from './authProvider';
import { dataProvider } from './dataProvider';
import { request } from './http';
import { i18nProvider } from './i18n';
import { AdminLayout, AdminLogin, resourceIcons } from './AdminLayout';
import Dashboard from './Dashboard';
import StaffPermissions from './StaffPermissions';
import { adminTheme } from './theme';
import { ListActions, ListSummary } from './ListTools';
import { PageHeading, IdentifierField, RoleField, StatusField, ROLES, statusNames, targetNames, resourceNames } from './adminUi';

const reasonChoices = [
    ['POLICY_VIOLATION', '违反平台规则'], ['PROHIBITED_ITEM', '违禁物品'], ['HARASSMENT', '骚扰'],
    ['FRAUD_RISK', '欺诈风险'], ['CONFIRMED_NO_SHOW', '确认爽约'], ['INSUFFICIENT_EVIDENCE', '证据不足'],
    ['DUPLICATE', '重复案件'], ['OTHER', '其他'],
].map(([id, name]) => ({ id, name }));
const actionNames: Record<string, string> = {
    HIDE_PRODUCT: '隐藏商品', RESTORE_PRODUCT: '恢复商品', ARCHIVE_CIRCLE: '归档圈子',
    RESTRICT_BOOKING: '限制预约', RESTRICT_PUBLISHING: '限制发布', RESTRICT_CIRCLE_CREATION: '限制创建圈子',
    CONFIRM_NO_SHOW: '确认爽约', REJECT_NO_SHOW: '驳回爽约报告', NO_ACTION: '不采取措施',
    HIDE_COMMENT: '隐藏评论', RESTORE_COMMENT: '恢复评论', QUARANTINE_MESSAGE: '隔离私信', RELEASE_MESSAGE: '解除私信隔离',
};
const readActions = <TopToolbar><ListButton /><EditButton /></TopToolbar>;
const search = [<TextInput key="q" source="q" label="搜索" alwaysOn />];
const defaultSort = { field: 'createdAt', order: 'DESC' as const };
function UsersList() { return <><PageHeading title="用户与工作人员" description="查看本校校园账号，管理工作人员角色与访问权限。" eyebrow="PEOPLE / 用户管理" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <TextField source="nickname" label="昵称" /><TextField source="account" label="账号" sortable={false} />
    <TextField source="campus" label="校区" sortable={false} /><RoleField source="role" label="后台角色" sortable={false} />
    <BooleanField source="active" label="后台权限启用" sortable={false} /><DateField locales="zh-CN" source="createdAt" label="注册时间" showTime />
    <EditButton label="配置权限" />
</DatagridConfigurable></List></>; }
function UserShow() { return <><PageHeading title="用户详情" description="查看校园账号信息与当前后台访问权限。" /><Show actions={readActions}><SimpleShowLayout className="record-details">
    <TextField source="id" label="用户编号" /><TextField source="nickname" label="昵称" /><TextField source="account" label="账号" />
    <TextField source="campus" label="校区" /><RoleField source="role" label="后台角色" /><BooleanField source="active" label="后台权限启用" />
    <DateField locales="zh-CN" source="createdAt" label="注册时间" showTime />
</SimpleShowLayout></Show></>; }
function ProductsList() { return <><PageHeading title="商品目录" description="浏览本校商品信息与治理状态，追踪每一件校园闲置。" eyebrow="CATALOG / 商品管理" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <TextField source="title" label="商品" /><TextField source="category" label="分类" sortable={false} /><NumberField source="price" label="价格" options={{ style: 'currency', currency: 'CNY' }} /><StatusField source="status" label="状态" sortable={false} /><TextField source="campus" label="校区" sortable={false} /><BooleanField source="moderationHidden" label="已治理隐藏" sortable={false} /><DateField locales="zh-CN" source="createdAt" label="发布时间" showTime />
</DatagridConfigurable></List></>; }
function ProductShow() { return <><PageHeading title="商品详情" description="查看商品发布信息、交易状态与治理标记。" /><Show><SimpleShowLayout><TextField source="id" label="商品编号" /><TextField source="title" label="商品" /><TextField source="sellerId" label="卖家编号" /><TextField source="category" label="分类" /><NumberField source="price" label="价格" options={{ style: 'currency', currency: 'CNY' }} /><StatusField source="status" label="状态" /><BooleanField source="moderationHidden" label="已治理隐藏" /><DateField locales="zh-CN" source="createdAt" label="发布时间" showTime /></SimpleShowLayout></Show></>; }
function OrdersList() { return <><PageHeading title="交易订单" description="查看校园交易进度，了解订单状态与参与双方。" eyebrow="TRANSACTIONS / 交易管理" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show"><IdentifierField source="productId" label="商品编号" sortable={false} /><IdentifierField source="id" label="订单编号" /><StatusField source="status" label="状态" sortable={false} /><DateField locales="zh-CN" source="createdAt" label="创建时间" showTime /></DatagridConfigurable></List></>; }
function OrderShow() { return <><PageHeading title="订单详情" description="查看订单状态、交易金额与参与双方。" /><Show><SimpleShowLayout><TextField source="id" label="订单编号" /><TextField source="productId" label="商品编号" /><TextField source="buyerId" label="买家编号" /><TextField source="sellerId" label="卖家编号" /><NumberField source="price" label="交易金额" options={{ style: 'currency', currency: 'CNY' }} /><StatusField source="status" label="状态" /><DateField locales="zh-CN" source="createdAt" label="创建时间" showTime /></SimpleShowLayout></Show></>; }
const caseStatuses = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'APPEALED'].map(id => ({ id, name: statusNames[id] ?? id }));
function CasesList() { return <><PageHeading title="治理案件" description="集中查看举报、证据与处理记录，维护校园社区秩序。" eyebrow="MODERATION / 社区治理" /><List actions={<ListActions />} perPage={25} sort={defaultSort} filters={[<SelectInput key="status" source="status" label="案件状态" choices={caseStatuses} alwaysOn />, <SelectInput key="targetType" source="targetType" label="目标类型" choices={Object.entries(targetNames).map(([id, name]) => ({ id, name }))} alwaysOn />]}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <IdentifierField source="id" label="案件编号" sortable={false} /><FunctionField label="目标类型" render={record => targetNames[record.targetType] ?? record.targetType} />
    <StatusField source="status" label="案件状态" sortable={false} /><NumberField source="reportCount" label="举报数" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="创建时间" showTime sortable={false} /><EditButton label="处理" />
</DatagridConfigurable></List></>; }
function CaseShow() { return <><PageHeading title="案件详情" description="查看举报依据与历史处理记录，审慎评估后再采取措施。" /><Show actions={readActions}><SimpleShowLayout>
    <TextField source="id" label="案件编号" /><TextField source="target.label" label="目标" /><StatusField source="status" label="状态" />
    <CaseEvidenceLink />
    <ArrayField source="reports" label="举报依据"><Datagrid bulkActionButtons={false}>
        <TextField source="reasonCode" label="原因" /><TextField source="note" label="说明" /><TextField source="snapshot" label="提交时快照" />
        <DateField locales="zh-CN" source="createdAt" label="时间" showTime />
    </Datagrid></ArrayField>
    <ArrayField source="actions" label="处理记录"><Datagrid bulkActionButtons={false}>
        <TextField source="actionCode" label="动作" /><TextField source="reasonCode" label="原因" /><TextField source="note" label="说明" />
        <BooleanField source="effective" label="已生效" /><DateField locales="zh-CN" source="createdAt" label="时间" showTime />
    </Datagrid></ArrayField>
</SimpleShowLayout></Show></>; }
function CaseEvidenceLink() {
    const record = useRecordContext();
    return record?.id ? <Button href={`/moderation/cases/${encodeURIComponent(record.id)}`}>查看完整案件证据与面交记录</Button> : null;
}
function CaseDecisionForm() {
    const record = useRecordContext();
    const actions: string[] = record?.allowedActions ?? [];
    if (!actions.length) return <Alert sx={{ m: 2 }} severity="info">当前案件没有可用处理动作，可能已结案、已由其他人领取或需要更高级权限。</Alert>;
    return <SimpleForm className="admin-form">
        <TextField source="target.label" label="处理目标" />
        <CaseEvidenceLink />
        <SelectInput source="action" label="处理动作" choices={actions.map(id => ({ id, name: actionNames[id] ?? id }))} validate={required()} />
        <SelectInput source="reasonCode" label="处理原因" choices={reasonChoices} validate={required()} />
        <TextInput source="note" label="处理说明" multiline inputProps={{ maxLength: 500 }} />
        <NumberInput source="durationHours" label="限制时长（小时，仅限制类动作需要）" min={1} max={720} />
        <Alert severity="info">提交后立即生效。平台会校验学校、案件状态、利益冲突和角色权限。</Alert>
    </SimpleForm>;
}
function CaseEdit() { return <><PageHeading title="处理治理案件" description="结合案件证据选择适当措施，提交后立即生效。" eyebrow="CASE DECISION / 案件处理" /><Edit mutationMode="pessimistic" title="处理治理案件"><CaseDecisionForm /></Edit></>; }
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
function AppealsList() { return <><PageHeading title="用户申诉" description="复核用户申诉，对处理结果作出公正的判断。" eyebrow="APPEALS / 申诉复核" /><List actions={<ListActions />} perPage={25} sort={defaultSort} filters={[<SelectInput key="status" source="status" label="申诉状态" choices={['PENDING', 'ACCEPTED', 'REJECTED'].map(id => ({ id, name: statusNames[id] }))} alwaysOn />]}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick={false}>
    <IdentifierField source="id" label="申诉编号" sortable={false} /><TextField source="reason" label="申诉原因" sortable={false} />
    <TextField source="subject.kind" label="申诉对象" sortable={false} /><TextField source="subject.actionCode" label="原处理动作" sortable={false} />
    <TextField source="subject.scope" label="限制范围" sortable={false} /><StatusField source="status" label="状态" sortable={false} />
    <DateField locales="zh-CN" source="createdAt" label="时间" showTime sortable={false} /><AppealDecision />
</DatagridConfigurable></List></>; }
function AuditList() { return <><PageHeading title="授权审计" description="追踪人员授权变更，查看操作人、原因与前后状态。" eyebrow="AUDIT LOG / 安全审计" /><List actions={<ListActions />} perPage={25} filters={search} sort={defaultSort}><ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick="show">
    <IdentifierField source="actorId" label="操作人编号" sortable={false} /><IdentifierField source="targetId" label="授权对象编号" sortable={false} />
    <RoleField source="newRole" label="新角色" sortable={false} /><BooleanField source="newActive" label="启用" sortable={false} />
    <TextField source="note" label="原因" sortable={false} /><DateField locales="zh-CN" source="createdAt" label="时间" showTime />
</DatagridConfigurable></List></>; }
function AuditShow() { return <><PageHeading title="授权记录详情" description="核对权限变更前后状态与操作追踪编号。" /><Show><SimpleShowLayout className="record-details">
    <TextField source="actorId" label="操作人编号" /><TextField source="targetId" label="授权对象编号" />
    <RoleField source="oldRole" label="原角色" /><RoleField source="newRole" label="新角色" />
    <BooleanField source="oldActive" label="原启用状态" /><BooleanField source="newActive" label="新启用状态" />
    <TextField source="note" label="原因" /><TextField source="requestId" label="操作追踪编号" /><DateField locales="zh-CN" source="createdAt" label="时间" showTime />
</SimpleShowLayout></Show></>; }
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
        <Resource icon={resourceIcons.products} name="products" options={{ label: '商品目录' }} list={ProductsList} show={ProductShow} />
        <Resource icon={resourceIcons.orders} name="orders" options={{ label: '交易订单' }} list={OrdersList} show={OrderShow} />
        <Resource icon={resourceIcons.cases} name="cases" options={{ label: '治理案件' }} list={CasesList} show={CaseShow} edit={CaseEdit} />
        <Resource icon={resourceIcons.appeals} name="appeals" options={{ label: '用户申诉' }} list={AppealsList} />
        <Resource icon={resourceIcons.audit} name="audit" options={{ label: '授权审计' }} list={AuditList} show={AuditShow} />
        <Resource icon={resourceIcons.roles} name="roles" options={{ label: '角色权限' }} list={RolesList} />
    </Admin>;
}
