import { useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import InputBase from '@mui/material/InputBase';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SearchIcon from '@mui/icons-material/Search';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import LoginIcon from '@mui/icons-material/Login';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';

/** 全局顶部导航栏：Logo / 搜索 / 发布 / 消息 / 用户菜单 */
export default function Navbar() {
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, logout } = useAuth();
  const { getUnreadCount } = useMarket();
  const { success } = useNotify();

  const [keyword, setKeyword] = useState('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  const unread = currentUser ? getUnreadCount(currentUser.id) : 0;

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const kw = keyword.trim();
    navigate(kw ? `/?keyword=${encodeURIComponent(kw)}` : '/');
  };

  const openMenu = (event: ReactMouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const closeMenu = () => setAnchorEl(null);

  const go = (path: string) => {
    closeMenu();
    navigate(path);
  };

  const handleLogout = () => {
    closeMenu();
    logout();
    success('已退出登录');
    navigate('/');
  };

  const handlePublish = () => {
    navigate(isAuthenticated ? '/publish' : '/login');
  };

  const handleMessages = () => {
    navigate(isAuthenticated ? '/messages' : '/login');
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: 'rgba(247,249,248,0.86)',
        backdropFilter: 'blur(18px)',
        color: 'text.primary',
        borderBottom: '1px solid',
        borderColor: 'rgba(226,232,240,0.88)',
        boxShadow: '0 6px 24px rgba(15,23,42,0.035)',
      }}
    >
      <Toolbar
        sx={{
          gap: { xs: 1, md: 2.5 },
          minHeight: { xs: 60, md: 68 },
          maxWidth: 1180,
          width: '100%',
          mx: 'auto',
          px: { xs: 1.5, sm: 2, md: 3 },
        }}
      >
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-1.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-700 to-brand-500 text-white shadow-lg shadow-brand-600/20">
            <StorefrontIcon fontSize="small" />
          </span>
          <span className="hidden text-[17px] font-extrabold tracking-tight text-slate-900 sm:inline">
            校园集市
          </span>
        </Link>

        {/* 桌面端搜索框 */}
        <form
          onSubmit={handleSearch}
          className="hidden flex-1 items-center sm:flex"
          style={{ maxWidth: 480 }}
        >
          <div className="flex w-full items-center gap-1 rounded-[16px] border border-transparent bg-white px-3 py-1.5 shadow-[0_5px_18px_rgba(15,23,42,0.05)] transition focus-within:border-brand-300 focus-within:shadow-[0_8px_24px_rgba(13,138,132,0.12)]">
            <SearchIcon fontSize="small" className="text-slate-400" />
            <InputBase
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索你想要的闲置好物…"
              sx={{ flex: 1, fontSize: 14 }}
              inputProps={{ 'aria-label': '搜索商品' }}
            />
            <Button
              type="submit"
              size="small"
              variant="contained"
              sx={{ borderRadius: 3, minWidth: 68, py: 0.55, px: 1.6 }}
            >
              搜索
            </Button>
          </div>
        </form>

        <div className="flex-1 sm:hidden" />

        {/* 右侧操作区 */}
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            variant="contained"
            size="small"
            startIcon={<AddCircleOutlineIcon />}
            onClick={handlePublish}
            sx={{
              borderRadius: 3,
              display: { xs: 'none', sm: 'inline-flex' },
              px: 2,
            }}
          >
            发布闲置
          </Button>

          <Tooltip title="消息">
            <IconButton
              onClick={handleMessages}
              aria-label="消息"
              sx={{
                borderRadius: 2.5,
                '&:hover': { bgcolor: 'rgba(13,138,132,0.08)' },
              }}
            >
              <Badge color="error" badgeContent={unread} max={99}>
                <ChatBubbleOutlineIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          {isAuthenticated && currentUser ? (
            <>
              <Tooltip title={currentUser.nickname}>
                <IconButton onClick={openMenu} sx={{ p: 0.5 }} aria-label="用户菜单">
                  <Avatar
                    src={currentUser.avatar}
                    alt={currentUser.nickname}
                    sx={{
                      width: 36,
                      height: 36,
                      border: '2px solid #fff',
                      boxShadow: '0 3px 12px rgba(15,23,42,0.12)',
                    }}
                  >
                    {currentUser.nickname.slice(0, 1)}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={anchorEl}
                open={menuOpen}
                onClose={closeMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { minWidth: 190, mt: 1 } } }}
              >
                <div className="px-4 py-2">
                  <p className="text-sm font-semibold text-slate-800">
                    {currentUser.nickname}
                  </p>
                  <p className="text-xs text-slate-400">{currentUser.campus}</p>
                </div>
                <Divider />
                <MenuItem onClick={() => go('/profile')}>
                  <ListItemIcon>
                    <PersonOutlineIcon fontSize="small" />
                  </ListItemIcon>
                  个人中心
                </MenuItem>
                <MenuItem onClick={() => go('/profile/listings')}>
                  <ListItemIcon>
                    <Inventory2OutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  我的发布
                </MenuItem>
                <MenuItem onClick={() => go('/profile/favorites')}>
                  <ListItemIcon>
                    <FavoriteBorderIcon fontSize="small" />
                  </ListItemIcon>
                  我的收藏
                </MenuItem>
                <MenuItem onClick={() => go('/profile/orders')}>
                  <ListItemIcon>
                    <ReceiptLongOutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  我的订单
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  退出登录
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Button
              variant="outlined"
              size="small"
              startIcon={<LoginIcon />}
              onClick={() => navigate('/login')}
              sx={{ borderRadius: 3, px: 1.5 }}
            >
              登录
            </Button>
          )}
        </div>
      </Toolbar>

      {/* 移动端搜索行 */}
      <form
        onSubmit={handleSearch}
        className="flex px-3 pb-2 sm:hidden"
      >
        <div className="flex w-full items-center gap-1 rounded-[16px] border border-transparent bg-white px-3 py-1.5 shadow-[0_5px_18px_rgba(15,23,42,0.05)]">
          <SearchIcon fontSize="small" className="text-slate-400" />
          <InputBase
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索闲置好物…"
            sx={{ flex: 1, fontSize: 14 }}
            inputProps={{ 'aria-label': '搜索商品' }}
          />
          <Button type="submit" size="small" variant="contained" sx={{ borderRadius: 3, minWidth: 60, py: 0.55 }}>
            搜索
          </Button>
        </div>
      </form>
    </AppBar>
  );
}
