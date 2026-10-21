import { Link, Outlet, useLocation } from 'react-router-dom';
import Avatar from '../../components/Avatar';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Badge from '@mui/material/Badge';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';
import { LegalLinks } from '../../legal/LegalDocumentView';
import { contactUnreadLabel, useContactUnreadCounts } from '../../context/ContactUnreadContext';
import { useSchools } from '../../hooks/useSchools';

const CONTACT_TAB = '/profile/contact-requests';

const TAB_ROUTES: { label: string; path: string }[] = [
  { label: '个人资料', path: '/profile' },
  { label: '我的发布', path: '/profile/listings' },
  { label: '我的收藏', path: '/profile/favorites' },
  { label: '联系申请', path: '/profile/contact-requests' },
  { label: '教材建议', path: '/profile/textbook-suggestions' },
  { label: '我的举报', path: '/profile/reports' },
  { label: '我的限制', path: '/profile/restrictions' },
  { label: '账号与安全', path: '/profile/security' },
];

/** 个人中心布局：用户概要卡 + 标签页 + 子路由出口 */
export default function ProfileLayout() {
  const location = useLocation();
  const { currentUser } = useAuth();
  const { campusLabel } = useSchools();
  const { getSellerProducts, getFavoriteProducts } =
    useMarket();
  const { counts: contactUnread } = useContactUnreadCounts();

  if (!currentUser) {
    return null;
  }

  const listings = getSellerProducts(currentUser.id);
  const favoriteCount = getFavoriteProducts(currentUser.id).length;

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
    { label: '收藏', value: favoriteCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 用户概要 */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-teal-400 px-5 py-5 text-white shadow-lg md:px-8 md:py-6">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-4">
          <Avatar
            avatar={currentUser.avatar}
            nickname={currentUser.nickname}
            userId={currentUser.id}
            alt={`${currentUser.nickname}的头像`}
            size={64}
            style={{ border: '3px solid rgba(255,255,255,0.7)' }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold md:text-xl">
              {currentUser.nickname}
            </h1>
            <p className="mt-0.5 text-xs text-white/85 md:text-sm">
              {campusLabel(currentUser.campus)} · 账号 {currentUser.account}
            </p>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white/12 py-3 backdrop-blur">
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
              label={tab.path === CONTACT_TAB && contactUnread.total > 0
                ? <Badge color="error" badgeContent={contactUnread.total} max={99} sx={{ pr: 1.5 }}><span>{tab.label}</span></Badge>
                : tab.label}
              // 联系申请标签的可访问名称带上未读数
              aria-label={tab.path === CONTACT_TAB ? contactUnreadLabel(contactUnread.total) : undefined}
              component={Link}
              to={tab.path}
              sx={{ minHeight: 46, fontWeight: 600 }}
            />
          ))}
        </Tabs>
      </div>

      <Outlet />

      <nav aria-label="协议与政策" className="text-center text-xs text-slate-500">
        <LegalLinks />
      </nav>
    </div>
  );
}
