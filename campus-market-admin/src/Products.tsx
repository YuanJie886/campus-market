import { useState } from 'react';
import { Avatar, Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField as Input, Typography } from '@mui/material';
import ProductIcon from '@mui/icons-material/Inventory2Outlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import HideIcon from '@mui/icons-material/VisibilityOffOutlined';
import RestoreIcon from '@mui/icons-material/VisibilityOutlined';
import { List, Show, DatagridConfigurable, TextField, NumberField, DateField, TextInput, SelectInput, ShowButton, useRecordContext, useCanAccess, useGetIdentity, useNotify, useRefresh, type FieldProps, type RaRecord } from 'react-admin';
import { ListActions, ListSummary } from './ListTools';
import { PageHeading, IdentifierField, StatusBadge, StatusField } from './adminUi';
import { request } from './http';

interface ProductRecord extends RaRecord {
    title: string; description?: string; price: number; originalPrice?: number; category: string; condition?: string;
    campus: string; status: string; moderationHidden: boolean; image?: string; images?: string[]; version: string;
    sellerId: string; sellerNickname?: string; sellerAccount?: string; listingKind?: string; views?: number; visibility?: string; createdAt?: number;
    bundleItems?: { id: string; name: string; category: string; condition: string; quantity: number; note?: string }[];
    history?: { id: string; action: string; actorNickname: string; note?: string; createdAt: number }[];
}
const categories = ['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他'];
const states = ['在售', '预约中', '已售出', '已下架'];
const choices = (values: string[]) => values.map(id => ({ id, name: id }));
const money = (value?: number) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
const time = (value?: number) => value == null ? '—' : new Date(value).toLocaleString('zh-CN', { hour12: false });
const actions: Record<string, string> = { EDIT_PRODUCT: '编辑商品', HIDE_PRODUCT: '管理下架', RESTORE_PRODUCT: '恢复展示' };
const preferenceKey = 'products.management.v2';
function ProductCell(_: FieldProps) {
    const record = useRecordContext<ProductRecord>();
    return record ? <Box className="order-product-cell"><Avatar variant="rounded" src={record.image} className="order-thumbnail"><ProductIcon /></Avatar><Box><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{record.title}</Typography><Typography sx={{ fontSize: 11, mt: .5 }} color="text.secondary">{record.condition || '未记录成色'} · {record.listingKind === 'BUNDLE' ? '整套打包' : '单件商品'}</Typography></Box></Box> : null;
}
function SellerCell(_: FieldProps) {
    const record = useRecordContext<ProductRecord>();
    return record ? <Box><Typography sx={{ fontSize: 12 }}>{record.sellerNickname || '未提供昵称'}</Typography><Typography sx={{ fontSize: 11, mt: .5 }} color="text.secondary">{record.sellerAccount || record.sellerId}</Typography></Box> : null;
}
function VisibilityCell(_: FieldProps) {
    const record = useRecordContext<ProductRecord>();
    return <Chip size="small" color={record?.moderationHidden ? 'error' : 'default'} variant="outlined" label={record?.moderationHidden ? '管理下架' : '正常展示'} />;
}
export function ProductsList() {
    return <><PageHeading title="商品目录" description="管理本校商品信息、卖家与展示状态，所有变更均记录操作原因。" eyebrow="CATALOG / 商品管理" />
        <List perPage={25} sort={{ field: 'createdAt', order: 'DESC' }} actions={<ListActions preferenceKey={preferenceKey} />} filters={[
            <TextInput key="q" source="q" label="搜索商品、编号或卖家" alwaysOn resettable inputProps={{ maxLength: 100 }} />,
            <SelectInput key="status" source="status" label="交易状态" choices={choices(states)} alwaysOn />,
            <SelectInput key="category" source="category" label="商品分类" choices={choices(categories)} alwaysOn />,
            <SelectInput key="moderationHidden" source="moderationHidden" label="展示管理" choices={[{ id: 'false', name: '正常展示' }, { id: 'true', name: '管理下架' }]} alwaysOn />,
            <TextInput key="campus" source="campus" label="所在校区（完整名称）" resettable inputProps={{ maxLength: 100 }} />,
        ]}><ListSummary /><DatagridConfigurable preferenceKey={preferenceKey} bulkActionButtons={false} rowClick="show" sx={{ '& .RaDatagrid-table': { minWidth: 1100 } }}>
            <ProductCell source="title" label="商品信息" /><SellerCell source="sellerNickname" label="卖家" sortable={false} />
            <TextField source="category" label="分类" sortable={false} /><NumberField source="price" locales="zh-CN" label="价格" options={{ style: 'currency', currency: 'CNY' }} />
            <StatusField source="status" label="交易状态" sortable={false} /><VisibilityCell source="moderationHidden" label="展示状态" sortable={false} />
            <TextField source="campus" label="校区" sortable={false} /><DateField source="createdAt" locales="zh-CN" label="发布时间" showTime /><ShowButton label="管理详情" />
        </DatagridConfigurable></List></>;
}

function ProductManagement({ record }: { record: ProductRecord }) {
    const { canAccess } = useCanAccess({ resource: 'products', action: 'edit' });
    const { identity } = useGetIdentity();
    const notify = useNotify(), refresh = useRefresh();
    const [mode, setMode] = useState<'edit' | 'visibility' | null>(null);
    const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [price, setPrice] = useState(''), [note, setNote] = useState('');
    const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [snapshot, setSnapshot] = useState<ProductRecord>(record);
    const editable = ['在售', '已下架'].includes(record.status);
    const open = (value: 'edit' | 'visibility') => {
        setSnapshot(record); setTitle(record.title); setDescription(record.description || ''); setPrice(String(record.price)); setNote(''); setError(''); setConfirm(false); setMode(value);
    };
    const valid = note.trim().length > 0 && note.trim().length <= 500 && (mode !== 'edit' || (title.trim().length > 0 && description.trim().length > 0 && /^\d+(\.\d{1,2})?$/.test(price) && Number(price) <= 9999999999.99));
    const label = mode === 'edit' ? '编辑商品' : snapshot.moderationHidden ? '恢复展示' : '管理下架';
    const submit = async () => {
        if (!valid || busy) return;
        setBusy(true); setError('');
        try {
            await request(`/v1/admin/products/${encodeURIComponent(String(snapshot.id))}${mode === 'edit' ? '' : '/visibility'}`, {
                method: mode === 'edit' ? 'PATCH' : 'POST', body: JSON.stringify(mode === 'edit' ? { title: title.trim(), description: description.trim(), price: Number(price), note: note.trim(), version: snapshot.version } : { action: snapshot.moderationHidden ? 'RESTORE_PRODUCT' : 'HIDE_PRODUCT', note: note.trim(), version: snapshot.version }),
            });
            setMode(null); notify('商品管理操作已保存', { type: 'success' }); refresh();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : '保存失败，请重试'); setConfirm(false);
            if ((failure as { status?: number }).status === 409) refresh();
        } finally { setBusy(false); }
    };
    if (!canAccess) return <Alert severity="info">当前角色可查看商品，信息编辑和展示管理需要学校管理员或高级审核员权限。</Alert>;
    if (identity?.id === record.sellerId) return <Alert severity="info">本人发布的商品需要由其他工作人员管理。</Alert>;
    return <><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Button variant="outlined" startIcon={<EditIcon />} disabled={!editable} onClick={() => open('edit')}>编辑商品</Button><Button variant="contained" color={record.moderationHidden ? 'primary' : 'warning'} startIcon={record.moderationHidden ? <RestoreIcon /> : <HideIcon />} onClick={() => open('visibility')}>{record.moderationHidden ? '恢复展示' : '管理下架'}</Button></Stack>
        {!editable && <Typography sx={{ fontSize: 12, mt: 1.5 }} color="text.secondary">预约中或已售出的商品保留交易信息，可进行展示管理。</Typography>}
        <Dialog open={mode !== null} onClose={() => { if (!busy) setMode(null); }} fullWidth maxWidth="sm"><DialogTitle>{confirm ? `确认${label}` : label}</DialogTitle><DialogContent>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Typography sx={{ mb: 2, fontWeight: 600 }}>{snapshot.title}</Typography>
            {confirm ? <Stack spacing={2}>{mode === 'edit' && <Box><Typography>标题：{title}</Typography><Typography>价格：{money(snapshot.price)} → {money(Number(price))}</Typography><Typography sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>描述：{description}</Typography></Box>}<Typography sx={{ overflowWrap: 'anywhere' }}>操作原因：{note}</Typography><Alert severity="warning">确认后立即生效，并记录操作者、原因和处理时间。</Alert></Stack> : <Stack spacing={2}>
                {mode === 'edit' ? <><Input label="商品标题" value={title} onChange={event => setTitle(event.target.value)} inputProps={{ maxLength: 100 }} fullWidth /><Input label="商品描述" value={description} onChange={event => setDescription(event.target.value)} multiline minRows={4} inputProps={{ maxLength: 4000 }} fullWidth /><Input label="商品价格（元）" value={price} onChange={event => setPrice(event.target.value)} inputProps={{ inputMode: 'decimal' }} fullWidth /><Alert severity="info">修改当前商品信息；订单已记录的成交金额和交易快照保持原样。</Alert></> : <Alert severity="info">{snapshot.moderationHidden ? '解除管理隐藏。卖家已下架或售出的商品仍保留原交易状态。' : '商品将从买家浏览和新预约入口中隐藏，已有订单继续保留。'}</Alert>}
                <Input label="操作原因" value={note} onChange={event => setNote(event.target.value)} multiline minRows={2} required inputProps={{ maxLength: 500 }} helperText={`${note.length}/500`} fullWidth />
            </Stack>}
        </DialogContent><DialogActions><Button disabled={busy} onClick={() => confirm ? setConfirm(false) : setMode(null)}>{confirm ? '返回修改' : '取消'}</Button><Button variant="contained" disabled={!valid || busy} onClick={() => confirm ? void submit() : setConfirm(true)}>{busy ? '保存中…' : confirm ? '确认提交' : '预览变更'}</Button></DialogActions></Dialog>
    </>;
}
function ProductDetails() {
    const { canAccess: canReadCases } = useCanAccess({ resource: 'cases', action: 'list' });
    const record = useRecordContext<ProductRecord>(); if (!record) return null;
    return <Box className="catalog-detail-grid"><Box><Card><CardContent sx={{ p: 3 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><StatusBadge value={record.status} /><VisibilityCell source="moderationHidden" /><Chip size="small" label={record.listingKind === 'BUNDLE' ? '整套打包' : '单件商品'} variant="outlined" /></Stack><Typography variant="h5" sx={{ mt: 2 }}>{record.title}</Typography><Typography variant="h4" sx={{ color: 'primary.main', mt: 1.5 }}>{money(record.price)}</Typography><Typography sx={{ mt: 1 }} color="text.secondary">{[record.category, record.condition, record.campus].filter(Boolean).join(' · ')}</Typography><Divider sx={{ my: 2.5 }} /><ProductManagement record={record} />
        <Typography variant="h6" sx={{ mt: 3 }}>商品描述</Typography><Typography sx={{ mt: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.description || '未提供描述'}</Typography>
        {!!record.images?.length && <Box className="catalog-gallery">{record.images.map((src, index) => <Box component="img" key={index} src={src} alt={`${record.title} 图片 ${index + 1}`} />)}</Box>}
        {!!record.bundleItems?.length && <Box sx={{ mt: 3 }}><Typography variant="h6">打包明细</Typography>{record.bundleItems.map(item => <Box key={item.id} sx={{ py: 1.5, borderBottom: '1px solid #edf1ef' }}><Typography>{item.name} × {item.quantity}</Typography><Typography color="text.secondary" sx={{ fontSize: 12 }}>{item.category} · {item.condition}{item.note ? ` · ${item.note}` : ''}</Typography></Box>)}</Box>}
        </CardContent></Card><Card sx={{ mt: 2 }}><CardContent sx={{ p: 3 }}><Typography variant="h6">管理操作历史</Typography><Divider sx={{ my: 2 }} />{record.history?.length ? record.history.map(entry => <Box key={entry.id} sx={{ py: 1.5, borderBottom: '1px solid #edf1ef' }}><Typography sx={{ fontWeight: 600 }}>{actions[entry.action] || entry.action} · {entry.actorNickname}</Typography><Typography sx={{ mt: .5, overflowWrap: 'anywhere' }}>{entry.note || '未提供说明'}</Typography><Typography color="text.secondary" sx={{ fontSize: 12, mt: .5 }}>{time(entry.createdAt)}</Typography></Box>) : <Typography color="text.secondary">暂无管理操作记录</Typography>}</CardContent></Card></Box>
        <Stack spacing={2}><Card><CardContent sx={{ p: 3 }}><Typography variant="h6">卖家信息</Typography><Divider sx={{ my: 2 }} /><Typography sx={{ fontWeight: 600 }}>{record.sellerNickname || '未提供昵称'}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>校园账号：{record.sellerAccount || '未记录'}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>校区：{record.campus}</Typography><Typography sx={{ fontSize: 11, mt: 2, overflowWrap: 'anywhere' }}>用户编号：{record.sellerId}</Typography></CardContent></Card><Card><CardContent sx={{ p: 3 }}><Typography variant="h6">发布信息</Typography><Divider sx={{ my: 2 }} /><Typography sx={{ fontSize: 12 }}>发布时间：{time(record.createdAt)}</Typography><Typography sx={{ fontSize: 12, mt: 1 }}>浏览次数：{record.views ?? 0}</Typography><Typography sx={{ fontSize: 12, mt: 1 }}>可见范围：{record.visibility === 'CIRCLE_ONLY' ? '圈子内可见' : '全校公开'}</Typography><Box sx={{ mt: 2 }}><IdentifierField source="id" /></Box></CardContent></Card>{canReadCases && <Button href="/admin/cases?filter=%7B%22targetType%22%3A%22PRODUCT%22%7D">前往商品治理案件</Button>}</Stack></Box>;
}
export function ProductShow() {
    return <><PageHeading title="商品管理详情" description="查看完整发布信息，编辑商品或管理展示状态，并追踪操作历史。" eyebrow="CATALOG / 商品管理" action={<Button href="/admin/products" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>返回商品目录</Button>} /><Show actions={false} component="div"><ProductDetails /></Show></>;
}
