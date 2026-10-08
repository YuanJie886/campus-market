import { Box, Button, Card, Skeleton, Typography } from '@mui/material';
import { Title, useGetList, usePermissions, useRefresh, type RaRecord } from 'react-admin';
import { Link } from 'react-router-dom';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/TaskAlt';
import { type AdminIdentity } from './authProvider';
import { PageHeading, StatusBadge, dateText, queueLink, roleName, resourceNames, targetNames } from './adminUi';
import { resourceIcons } from './AdminLayout';

const params = { pagination: { page: 1, perPage: 5 }, sort: { field: 'createdAt', order: 'DESC' as const }, filter: {} };
function Metric({ resource, label, hint, status }: { resource: keyof typeof resourceIcons; label: string; hint: string; status?: string }) {
    const { total, isPending, error } = useGetList(resource, { ...params, pagination: { page: 1, perPage: 1 }, filter: status ? { status } : {} });
    const Icon = resourceIcons[resource];
    return <Card component={Link} to={status ? queueLink(resource, status) : `/${resource}`} className="metric-card" aria-label={`${label}：${isPending ? '加载中' : error ? '加载失败' : total ?? 0}`}>
        <Box className="metric-top"><span>{label}</span><Box className="metric-icon"><Icon sx={{ fontSize: 20 }} /></Box></Box>
        <Box className="metric-value">{isPending ? <Skeleton width={80} /> : error ? '—' : (total ?? 0).toLocaleString('zh-CN')}</Box>
        <Box className="metric-bottom"><span>{error ? '读取失败，点击重试查看' : hint}</span><ArrowForwardIcon sx={{ fontSize: 14 }} /></Box>
    </Card>;
}
function PanelHeader({ title, description, to }: { title: string; description: string; to?: string }) {
    return <Box className="panel-header"><Box><Typography variant="h6">{title}</Typography><Typography>{description}</Typography></Box>{to && <Button component={Link} to={to} endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />} size="small">查看全部</Button>}</Box>;
}
function LoadingRows() { return <Box sx={{ p: 3 }}><Skeleton height={36} /><Skeleton height={36} /><Skeleton height={36} /></Box>; }
function QueuePanel() {
    const { data, isPending, error } = useGetList('cases', { ...params, filter: { status: 'OPEN' } });
    return <Card><PanelHeader title="待处理案件" description="按提交时间排列，优先关注社区治理" to={queueLink('cases', 'OPEN')} />
        {isPending ? <LoadingRows /> : error ? <Box className="empty-panel">案件读取失败，请刷新重试</Box> : !data?.length ? <Box className="empty-panel"><CheckIcon sx={{ display: 'block', mx: 'auto', mb: 1, color: '#78a78b' }} />暂无待处理案件</Box> : data.map((record: RaRecord, index: number) => <Box className="queue-row" component={Link} key={record.id} to={`/cases/${encodeURIComponent(record.id)}/show`}>
            <Box className="queue-number">{String(index + 1).padStart(2, '0')}</Box><Box className="row-content"><strong>{record.target?.label ?? `${targetNames[record.targetType] ?? record.targetType ?? '内容'} · ${String(record.id).slice(0, 8)}`}</strong><small>{record.reportCount ?? 0} 条举报 · {dateText(record.createdAt)}</small></Box><StatusBadge value={record.status} /><ArrowForwardIcon sx={{ fontSize: 16, color: '#a7b5ac' }} />
        </Box>)}
    </Card>;
}
function RecentProducts() {
    const { data, isPending, error } = useGetList('products', params);
    return <Card sx={{ mt: 3 }}><PanelHeader title="最新发布" description="本校近期发布的商品" to="/products" />
        {isPending ? <LoadingRows /> : error ? <Box className="empty-panel">商品读取失败，请刷新重试</Box> : !data?.length ? <Box className="empty-panel">暂无商品，发布后会显示在这里</Box> : data.map(record => <Box className="queue-row" component={Link} key={record.id} to={`/products/${encodeURIComponent(record.id)}/show`}>
            <Box className="metric-icon"><resourceIcons.products sx={{ fontSize: 18 }} /></Box><Box className="row-content"><strong>{record.title}</strong><small>{record.category ?? '未分类'} · {dateText(record.createdAt)}</small></Box><Typography sx={{ fontWeight: 700, fontSize: 13 }}>¥{Number(record.price ?? 0).toFixed(2)}</Typography><StatusBadge value={record.status} />
        </Box>)}
    </Card>;
}
function RecentAudit() {
    const { data, isPending, error } = useGetList('audit', { ...params, pagination: { page: 1, perPage: 3 } });
    return <Card sx={{ mt: 3 }}><PanelHeader title="最近授权动态" description="工作人员权限变更记录" to="/audit" />
        {isPending ? <LoadingRows /> : error ? <Box className="empty-panel">审计读取失败，请刷新重试</Box> : !data?.length ? <Box className="empty-panel">暂无授权变更记录</Box> : data.map(record => <Box className="queue-row" component={Link} to={`/audit/${encodeURIComponent(record.id)}/show`} key={record.id}><Box className="metric-icon"><resourceIcons.audit sx={{ fontSize: 18 }} /></Box><Box className="row-content"><strong>{record.newActive ? `授予${roleName(record.newRole)}权限` : '停用后台权限'}</strong><small>{record.note} · {dateText(record.createdAt)}</small></Box><ArrowForwardIcon sx={{ fontSize: 15, color: '#a7b5ac' }} /></Box>)}
    </Card>;
}
export default function Dashboard() {
    const { permissions } = usePermissions<AdminIdentity>(); const refresh = useRefresh();
    const canRead = (resource: string) => permissions?.permissions.includes(`${resource}:read`);
    const date = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    return <Box><Title title="运营工作台" /><PageHeading title="校园集市运营工作台" description={`欢迎回来，${permissions?.fullName ?? '管理员'}。今天是 ${date}`} eyebrow="OVERVIEW / 运营概览" action={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} sx={{ whiteSpace: 'nowrap', bgcolor: 'white' }}>刷新数据</Button>} />
        <Box className="metric-grid">
            {canRead('users') && <Metric resource="users" label="校园用户" hint="本校注册用户总数" />}
            {canRead('products') && <Metric resource="products" label="商品总数" hint="本校商品目录" />}
            {canRead('cases') && <Metric resource="cases" label="待处理案件" hint="点击进入待处理队列" status="OPEN" />}
            {canRead('appeals') ? <Metric resource="appeals" label="待复核申诉" hint="点击进入申诉队列" status="PENDING" /> : canRead('orders') && <Metric resource="orders" label="交易订单" hint="本校订单总数" />}
        </Box>
        <Box className="dashboard-columns"><Box>
            {canRead('cases') && <QueuePanel />}
            {canRead('products') && <RecentProducts />}
            {canRead('audit') && <RecentAudit />}
        </Box><Box className="dashboard-aside">
            <Box className="welcome-banner"><Typography className="eyebrow">YOUR WORKSPACE</Typography><Typography variant="h6">一起维护友好的校园集市</Typography><Typography>当前身份：{roleName(permissions?.role)}。从待办队列开始，让每一次交易更安心。</Typography><Button component={Link} to={canRead('cases') ? queueLink('cases', 'OPEN') : '/products'} variant="contained" endIcon={<ArrowForwardIcon />}>开始今日工作</Button></Box>
            <Card><PanelHeader title="快捷入口" description="常用管理功能，一步直达" />
                {Object.entries(resourceNames).filter(([key]) => canRead(key)).map(([key, label]) => { const Icon = resourceIcons[key as keyof typeof resourceIcons]; return <Box key={key} className="quick-link" component={Link} to={`/${key}`}><Icon sx={{ fontSize: 18, color: '#789d87' }} /><span>{label}</span><ArrowForwardIcon sx={{ fontSize: 14, color: '#a7b5ac' }} /></Box>; })}
            </Card>
        </Box></Box>
    </Box>;
}
