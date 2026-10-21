import { List, DatagridConfigurable, DateField, FunctionField, NumberField, TextField, TextInput } from 'react-admin';
import { ListActions, ListSummary } from './ListTools';
import { IdentifierField, PageHeading, ReadAuditResourceField } from './adminUi';

export const QUERY_DIGEST_TEXT = '含搜索词（只存哈希）';
/** 读取审计（admin_read_audit）只有列表：后端详情接口返回 404，因此不注册详情页、行不可点击。 */
export function ReadAuditList() {
    return <><PageHeading title="读取审计" description="记录工作人员读取用户、历史订单、授权审计、复核请求、注册邀请码与读取审计的时间与范围。搜索词只保存哈希，不保存原文；查看本页也会留痕。" eyebrow="READ AUDIT / 读取留痕" />
        <List actions={<ListActions />} perPage={25} sort={{ field: 'createdAt', order: 'DESC' }} filters={[<TextInput key="q" source="q" label="搜索工作人员" alwaysOn resettable inputProps={{ maxLength: 100 }} />]}>
            <ListSummary /><DatagridConfigurable bulkActionButtons={false} rowClick={false}>
                <TextField source="actorNickname" label="工作人员" sortable={false} />
                <ReadAuditResourceField source="resource" label="读取内容" sortable={false} />
                <IdentifierField source="recordId" label="记录编号" sortable={false} />
                <NumberField source="resultCount" label="返回条数" sortable={false} emptyText="—" />
                <FunctionField source="withQuery" label="搜索条件" sortable={false} render={record => record.withQuery ? QUERY_DIGEST_TEXT : '—'} />
                <IdentifierField source="requestId" label="请求编号" sortable={false} />
                <DateField locales="zh-CN" source="createdAt" label="时间" showTime />
            </DatagridConfigurable>
        </List></>;
}
