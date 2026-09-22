import { useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import Badge from '@mui/material/Badge';
import HomeIcon from '@mui/icons-material/Home';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';

interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  requireAuth: boolean;
  primary?: boolean;
}

/** 移动端底部导航（md 以上隐藏） */
export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, currentUser } = useAuth();
  const { getUnreadCount } = useMarket();
  const unread = currentUser ? getUnreadCount(currentUser.id) : 0;

  const items: NavItem[] = [
    { label: '首页', icon: <HomeIcon />, path: '/', requireAuth: false },
    {
      label: '消息',
      icon: <ChatBubbleOutlineIcon />,
      path: '/messages',
      requireAuth: true,
    },
    {
      label: '发布',
      icon: <AddCircleIcon sx={{ fontSize: 40 }} />,
      path: '/publish',
      requireAuth: true,
      primary: true,
    },
    {
      label: '收藏',
      icon: <FavoriteBorderIcon />,
      path: '/profile/favorites',
      requireAuth: true,
    },
    {
      label: '我的',
      icon: <PersonOutlineIcon />,
      path: '/profile',
      requireAuth: true,
    },
  ];

  const isActive = (path: string): boolean => {
    if (path === '/') return location.pathname === '/';
    if (path === '/profile') {
      return location.pathname === '/profile';
    }
    return location.pathname.startsWith(path);
  };

  const handleClick = (item: NavItem) => {
    if (item.requireAuth && !isAuthenticated) {
      navigate('/login');
      return;
    }
    navigate(item.path);
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 pb-1 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-app items-stretch justify-around px-1">
        {items.map((item) => {
          const active = isActive(item.path);

          if (item.primary) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => handleClick(item)}
                className="flex flex-1 flex-col items-center justify-center py-1"
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <span className="-mt-5 flex h-[52px] w-[52px] items-center justify-center rounded-[18px] bg-gradient-to-br from-brand-700 to-brand-500 text-white shadow-xl shadow-brand-600/30 ring-4 ring-white">
                  {item.icon}
                </span>
                <span className="mt-0.5 text-[11px] font-bold text-slate-600">
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => handleClick(item)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] transition ${
                active ? 'text-brand-600' : 'text-slate-400'
              }`}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={`flex h-8 w-14 items-center justify-center rounded-2xl transition ${
                  active ? 'bg-brand-50 text-brand-600' : 'text-slate-400'
                }`}
              >
                <Badge
                  color="error"
                  badgeContent={item.path === '/messages' ? unread : 0}
                  max={99}
                  sx={{
                    '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 },
                  }}
                >
                  {item.icon}
                </Badge>
              </span>
              <span className={active ? 'font-bold' : 'font-medium'}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </nav>
  );
}
