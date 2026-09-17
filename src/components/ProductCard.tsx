import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import type { Product } from '../types';
import { CATEGORY_EMOJI, CATEGORY_GRADIENT, CONDITION_COLOR } from '../utils/constants';
import { formatPrice, formatRelativeTime } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';
import ImageWithFallback from './ImageWithFallback';

interface ProductCardProps {
  product: Product;
}

/** 商品卡片：用于首页、收藏、我的发布等网格 */
export default function ProductCard({ product }: ProductCardProps) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { isFavorite, toggleFavorite } = useMarket();
  const { success, info } = useNotify();

  const favorited = isFavorite(currentUser?.id, product.id);
  const soldOut = product.status !== '在售';

  const handleOpen = () => {
    navigate(`/product/${product.id}`);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen();
    }
  };

  const handleFavorite = (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (!currentUser) {
      info('请先登录后再收藏');
      navigate('/login');
      return;
    }
    const nowFav = toggleFavorite(currentUser.id, product.id);
    success(nowFav ? '已加入收藏' : '已取消收藏');
  };

  return (
    <Card
      elevation={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
      aria-label={`查看商品：${product.title}`}
      className="cm-fade-in group cursor-pointer overflow-hidden border border-slate-200/70 bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-brand-100 hover:shadow-card-hover"
      sx={{
        borderRadius: '20px',
        '&:focus-visible': {
          outline: '3px solid rgba(13, 138, 132, 0.28)',
          outlineOffset: 3,
        },
      }}
    >
      <div className="relative">
        <ImageWithFallback
          src={product.images[0]}
          alt={product.title}
          emoji={CATEGORY_EMOJI[product.category]}
          gradient={CATEGORY_GRADIENT[product.category]}
          className="aspect-[4/3] w-full sm:aspect-square"
          imgClassName="transition-transform duration-500 ease-out group-hover:scale-[1.045]"
        />

        {/* 售出 / 下架遮罩 */}
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px]">
            <span className="rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-lg">
              {product.status}
            </span>
          </div>
        )}

        {/* 收藏按钮 */}
        <Tooltip title={favorited ? '取消收藏' : '收藏'}>
          <IconButton
            onClick={handleFavorite}
            size="small"
            aria-label="收藏"
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              bgcolor: 'rgba(255,255,255,0.84)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.75)',
              boxShadow: '0 5px 14px rgba(15,23,42,0.1)',
              '&:hover': { bgcolor: '#fff', transform: 'scale(1.04)' },
            }}
          >
            {favorited ? (
              <FavoriteIcon fontSize="small" color="error" />
            ) : (
              <FavoriteBorderIcon fontSize="small" className="text-slate-500" />
            )}
          </IconButton>
        </Tooltip>

        {/* 成色标签 */}
        <span
          className="absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
          style={{ backgroundColor: CONDITION_COLOR[product.condition] ?? '#64748b' }}
        >
          {product.condition}
        </span>
      </div>

      <div className="p-4">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-5 text-slate-900">
          {product.title}
        </h3>

        <div className="mt-3 flex items-end gap-2">
          <span className="text-xl font-black leading-none tracking-tight text-brand-700">
            {formatPrice(product.price)}
          </span>
          {product.originalPrice && product.originalPrice > product.price && (
            <span className="text-xs leading-none text-slate-400 line-through">
              {formatPrice(product.originalPrice)}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip
            label={product.campus}
            size="small"
            variant="outlined"
            sx={{
              height: 22,
              fontSize: 11,
              borderRadius: 2,
              borderColor: '#e2e8f0',
              color: '#64748b',
              bgcolor: '#f8fafc',
            }}
          />
          <Chip
            label={product.category}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              borderRadius: 2,
              bgcolor: '#effdfb',
              color: '#0d8a84',
            }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          <span>{formatRelativeTime(product.createdAt)}</span>
          <span className="inline-flex items-center gap-0.5">
            <VisibilityOutlinedIcon sx={{ fontSize: 13 }} />
            {product.views}
          </span>
        </div>
      </div>
    </Card>
  );
}
