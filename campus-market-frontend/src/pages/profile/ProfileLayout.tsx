import { Link, Outlet, useLocation } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';

const TAB_ROUTES: { label: string; path: string }[] = [
  { label: '个人资料', path: '/profile' },
  { label: '我的发布', path: '/profile/listings' },
  { label: '我的收藏', path: '/profile/favorites' },
  { label: '我的订单', path: '/profile/orders' },
];

/** 个人中心布局：用户概要卡 + 标签页 + 子路由出口 */
export default function ProfileLayout() {
  const location = useLocation();
  const { currentUser } = useAuth();
  const { getSellerProducts, getFavoriteProducts, getBuyOrders, getSellOrders } =
    useMarket();

  if (!currentUser) {
    return null;
  }

  const listings = getSellerProducts(currentUser.id);
  const soldCount = listings.filter((p) => p.status === '已售出').length;
  const favoriteCount = getFavoriteProducts(currentUser.id).length;
  const orderCount =
    getBuyOrders(currentUser.id).length + getSellOrders(currentUser.id).length;

  const currentIndex = Math.max(
    0,
    TAB_ROUTES.findIndex((tab) =>
      tab.path === '/profile'
        ? location.pathname === '/profile'
        : location.pathname.startsWith(tab.path),
    ),
  );

  const stats = [
    { label: '发布', value: listings.length },
    { label: '已售出', value: soldCount },
    { label: '收藏', value: favoriteCount },
    { label: '订单', value: orderCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 用户概要 */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-teal-400 px-5 py-5 text-white shadow-lg md:px-8 md:py-6">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-4">
          <Avatar
            src={currentUser.avatar}
            alt={currentUser.nickname}
            sx={{ width: 64, height: 64, border: '3px solid rgba(255,255,255,0.7)' }}
          >
            {currentUser.nickname.slice(0, 1)}
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold md:text-xl">
              {currentUser.nickname}
            </h1>
            <p className="mt-0.5 text-xs text-white/85 md:text-sm">
              {currentUser.campus} · 账号 {currentUser.account}
            </p>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-white/12 py-3 backdrop-blur">
          {stats.map((item) => (
            <div key={item.label} className="text-center">
              <p className="text-lg font-extrabold leading-none">{item.value}</p>
              <p className="mt-1 text-[11px] text-white/85">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 标签页 */}
      <div className="rounded-2xl border border-slate-100 bg-white px-1 shadow-card">
        <Tabs
          value={currentIndex}
          variant="scrollable"
          scrollButtons={false}
          allowScrollButtonsMobile
          sx={{ minHeight: 46 }}
        >
          {TAB_ROUTES.map((tab) => (
            <Tab
              key={tab.path}
              label={tab.label}
              component={Link}
              to={tab.path}
              sx={{ minHeight: 46, fontWeight: 600 }}
            />
          ))}
        </Tabs>
      </div>

      <Outlet />
    </div>
  );
}
