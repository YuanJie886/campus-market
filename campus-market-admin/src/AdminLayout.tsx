import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppBar, Layout, Menu, Login, LoginForm, TitlePortal, UserMenu, usePermissions, useGetIdentity, useSidebarState, useRefresh, type LayoutProps } from 'react-admin';
import { Avatar, Box, Button, Dialog, DialogContent, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Tooltip, Typography } from '@mui/material';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import PeopleIcon from '@mui/icons-material/PeopleOutline';
import ProductIcon from '@mui/icons-material/Inventory2Outlined';
import OrderIcon from '@mui/icons-material/ReceiptLongOutlined';
import CaseIcon from '@mui/icons-material/GppMaybeOutlined';
import AppealIcon from '@mui/icons-material/ForumOutlined';
import AuditIcon from '@mui/icons-material/HistoryOutlined';
import RoleIcon from '@mui/icons-material/VerifiedUserOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ArrowIcon from '@mui/icons-material/ArrowOutward';
import RefreshIcon from '@mui/icons-material/Refresh';
import StoreIcon from '@mui/icons-material/StorefrontOutlined';
import { type AdminIdentity } from './authProvider';
import { resourceNames, roleName } from './adminUi';
import './admin.css';

export const resourceIcons = { users: PeopleIcon, products: ProductIcon, orders: OrderIcon, cases: CaseIcon, appeals: AppealIcon, audit: AuditIcon, roles: RoleIcon };
function Navigation() {
    const [expanded] = useSidebarState();
    const { permissions } = usePermissions<AdminIdentity>();
    const groups = [ { name: '运营管理', resources: ['users', 'products', 'orders'] }, { name: '社区治理', resources: ['cases', 'appeals'] }, { name: '安全与权限', resources: ['audit', 'roles'] } ];
    return <Box className={`navigation ${expanded ? 'expanded' : 'collapsed'}`}>
        <Box className="nav-brand"><StoreIcon /><Box sx={{ display: expanded ? 'block' : 'none' }}><strong>校园集市</strong><span>运营管理平台</span></Box></Box>
        <Menu><Menu.Item to="/" primaryText="运营工作台" leftIcon={<DashboardIcon />} />
            {groups.map(group => {
                const resources = group.resources.filter(resource => permissions?.permissions.includes(`${resource}:read`));
                return resources.length ? <Box key={group.name}>{expanded && <Typography className="nav-section">{group.name}</Typography>}{resources.map(resource => <Menu.ResourceItem key={resource} name={resource} />)}</Box> : null;
            })}
        </Menu>
        {expanded && <Box className="nav-footer"><Box className="school-badge"><RoleIcon fontSize="small" /><span>校内管理空间</span></Box><Typography>仅展示当前账号可访问的数据</Typography><Button href="/" endIcon={<ArrowIcon />} fullWidth>前往校园集市</Button></Box>}
    </Box>;
}
function QuickNavigation() {
    const [open, setOpen] = useState(false); const [search, setSearch] = useState('');
    const { permissions } = usePermissions<AdminIdentity>(); const navigate = useNavigate();
    useEffect(() => {
        const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); } };
        window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
    }, []);
    const entries = [{ path: '/', label: '运营工作台', Icon: DashboardIcon }, ...Object.entries(resourceNames).filter(([key]) => permissions?.permissions.includes(`${key}:read`)).map(([key, label]) => ({ path: `/${key}`, label, Icon: resourceIcons[key as keyof typeof resourceIcons] }))];
    return <><Button className="quick-search" aria-label="快速导航" color="inherit" startIcon={<SearchIcon />} onClick={() => { setSearch(''); setOpen(true); }}><span>快速导航</span><kbd>⌘ / Ctrl K</kbd></Button>
        <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-label="快速导航">
            <DialogContent><TextField autoFocus fullWidth label="搜索管理页面" value={search} onChange={event => setSearch(event.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} onKeyDown={event => { if (event.key === 'Enter') { const entry = entries.find(item => item.label.includes(search.trim())); if (entry) { navigate(entry.path); setOpen(false); } } }} />
                <List>{entries.filter(entry => entry.label.includes(search.trim())).map(({ path, label, Icon }) => <ListItemButton key={path} onClick={() => { navigate(path); setOpen(false); }}><ListItemIcon><Icon /></ListItemIcon><ListItemText primary={label} /></ListItemButton>)}
                    {!entries.some(entry => entry.label.includes(search.trim())) && <Typography sx={{ p: 3 }} color="text.secondary">没有匹配的页面</Typography>}</List>
            </DialogContent>
        </Dialog></>;
}
function Header() {
    const { data: identity } = useGetIdentity(); const refresh = useRefresh(); const location = useLocation();
    const resource = location.pathname.split('/')[1];
    return <AppBar className="admin-header" color="transparent" toolbar={<Tooltip title="刷新当前数据"><IconButton aria-label="刷新当前数据" onClick={refresh}><RefreshIcon fontSize="small" /></IconButton></Tooltip>} userMenu={<Box className="header-account"><UserMenu label="账户菜单" icon={<Avatar sx={{ width: 30, height: 30, bgcolor: '#e0eee7', color: '#24745c', fontSize: 13 }}>{identity?.fullName?.slice(0, 1) ?? '管'}</Avatar>} /><Typography>{roleName(identity?.role)}</Typography></Box>}>
        <Box className="header-breadcrumb"><Typography component={Link} to="/">管理空间</Typography><span>/</span><Typography>{resourceNames[resource] ?? '运营工作台'}</Typography></Box>
        <Box sx={{ display: 'none' }}><TitlePortal /></Box><Box sx={{ flex: 1 }} /><QuickNavigation />
    </AppBar>;
}
export function AdminLayout(props: LayoutProps) {
    return <Layout {...props} menu={Navigation} appBar={Header} appBarAlwaysOn className="admin-layout" />;
}
export function AdminLogin() {
    return <Login className="admin-login" avatarIcon={<StoreIcon />}><Box sx={{ textAlign: 'center', px: 3, pt: 2, pb: 1 }}><Typography className="eyebrow">CAMPUS MARKET</Typography><Typography variant="h4" sx={{ mt: 1 }}>校园集市管理后台</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>用校园账号登录，开始今日运营</Typography></Box><LoginForm /><Typography sx={{ textAlign: 'center', pb: 3, px: 3, fontSize: 12 }} color="text.secondary">后台访问需要已授权的工作人员身份</Typography></Login>;
}
