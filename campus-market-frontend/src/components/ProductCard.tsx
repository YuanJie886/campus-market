import { useState, useRef, useEffect } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  CSSProperties,
} from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import type { Product } from '../types';
import {
  CATEGORY_EMOJI,
  CATEGORY_GRADIENT,
  CONDITION_COLOR,
} from '../utils/constants';
import { formatPrice, formatRelativeTime } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';
import ImageWithFallback from './ImageWithFallback';

interface ProductCardProps {
  product: Product;
  index?: number;
}

/**
 * 具有 Apple 级精致触感的商品卡片：
 * - 3D 物理透视倾斜 (Perspective Tilt) 与光斑反射 (Dynamic Specular Glare)
 * - 多图悬停划动/触点切换预览 (Multi-Angle Hover Preview)
 * - 弹簧收藏微交互 (Spring Favorite Pop)
 * - 渐进式信息展示 (Progressive Information Disclosure)
 */
export default function ProductCard({ product, index = 0 }: ProductCardProps) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { isFavorite, toggleFavorite } = useMarket();
  const { success, info, error } = useNotify();

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isPopping, setIsPopping] = useState(false);

  const favorited = isFavorite(currentUser?.id, product.id);
  const soldOut = product.status !== '在售';
  const images = product.images && product.images.length > 0 ? product.images : [''];
  const hasMultipleImages = images.length > 1;

  // 清除收藏弹跳动效
  useEffect(() => {
    if (isPopping) {
      const timer = setTimeout(() => setIsPopping(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isPopping]);

  const handleOpen = () => navigate(`/product/${product.id}`);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen();
    }
  };

  // 3D 物理倾斜计算
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const el = cardRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // 最大倾斜角度约为 6.5 度，符合 Apple 克制微动效原则
    const rotateX = ((centerY - y) / centerY) * 6;
    const rotateY = ((x - centerX) / centerX) * 6;

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;

    el.style.setProperty('--rx', `${rotateX.toFixed(2)}deg`);
    el.style.setProperty('--ry', `${rotateY.toFixed(2)}deg`);
    el.style.setProperty('--glare-x', `${glareX.toFixed(1)}%`);
    el.style.setProperty('--glare-y', `${glareY.toFixed(1)}%`);
    el.style.setProperty('--glare-opacity', '0.75');

    // 如果有多张图片，通过鼠标在图片区域的水平移动位置自适应切图
    if (hasMultipleImages) {
      const segWidth = rect.width / images.length;
      const targetIndex = Math.min(
        images.length - 1,
        Math.max(0, Math.floor(x / segWidth)),
      );
      if (targetIndex !== activeImageIndex) {
        setActiveImageIndex(targetIndex);
      }
    }
  };

  const handlePointerEnter = () => {
    setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    setActiveImageIndex(0);
    const el = cardRef.current;
    if (el) {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--glare-opacity', '0');
    }
  };

  const handleFavorite = async (event: ReactMouseEvent) => {
    try {
      event.stopPropagation();
      if (!currentUser) {
        info('请先登录后再收藏');
        navigate('/login');
        return;
      }
      setIsPopping(true);
      const nowFav = await toggleFavorite(currentUser.id, product.id);
      success(nowFav ? '已加入心愿单' : '已移出心愿单');
    } catch (e) {
      error((e as Error).message);
    }
  };

  return (
    <div
      ref={cardRef}
      className="cm-apple-card-wrapper"
      style={{ '--card-stagger': index } as CSSProperties}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Card
        elevation={0}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        role="link"
        tabIndex={0}
        aria-label={`查看闲置：${product.title}`}
        className="cm-apple-card group"
      >
        {/* 动态物理高光层 */}
        <div className="cm-apple-card-glare" aria-hidden="true" />

        {/* 商品主图视口与多图预览 */}
        <div className="cm-apple-image-viewport">
          {images.map((imgUrl, i) => (
            <div
              key={i}
              className={`cm-apple-image-layer ${activeImageIndex === i ? 'is-active' : ''}`}
            >
              <ImageWithFallback
                src={imgUrl}
                alt={i === 0 ? product.title : `${product.title} 角度 ${i + 1}`}
                emoji={CATEGORY_EMOJI[product.category]}
                gradient={CATEGORY_GRADIENT[product.category]}
                className="w-full h-full object-cover"
                imgClassName="cm-apple-product-img"
              />
            </div>
          ))}

          {/* 售出遮罩 */}
          {soldOut && (
            <div className="cm-apple-sold-badge">
              <span>{product.status}</span>
            </div>
          )}

          {/* 右上角收藏交互按钮（带弹性爆破动画） */}
          <Tooltip title={favorited ? '移出收藏' : '收藏好物'}>
            <IconButton
              onClick={handleFavorite}
              size="small"
              aria-label={favorited ? '移出收藏' : '收藏好物'}
              className={`cm-apple-fav-btn ${isPopping ? 'is-popping' : ''} ${favorited ? 'is-active' : ''}`}
            >
              {favorited ? (
                <FavoriteIcon sx={{ fontSize: 17, color: 'var(--cm-coral)' }} />
              ) : (
                <FavoriteBorderIcon sx={{ fontSize: 17 }} />
              )}
            </IconButton>
          </Tooltip>

          {/* 左下角成色胶囊 */}
          <span
            className="cm-apple-condition-pill"
            style={{
              borderColor: CONDITION_COLOR[product.condition]
                ? `${CONDITION_COLOR[product.condition]}40`
                : 'rgba(255,255,255,0.2)',
            }}
          >
            <i
              style={{
                backgroundColor: CONDITION_COLOR[product.condition] ?? '#64748b',
              }}
            />
            {product.condition}
          </span>

          {/* 多图悬停分段指示条 */}
          {hasMultipleImages && (
            <div className="cm-apple-image-dots" aria-hidden="true">
              {images.map((_, dotIdx) => (
                <span
                  key={dotIdx}
                  className={`cm-apple-dot ${activeImageIndex === dotIdx ? 'is-current' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImageIndex(dotIdx);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 卡片信息区 */}
        <div className="cm-apple-card-info">
          {/* 顶部元数据：分类与校区 */}
          <div className="cm-apple-meta-row">
            <span className="cm-apple-category-tag">{product.category}</span>
            <span className="cm-apple-campus-tag">
              <PlaceOutlinedIcon sx={{ fontSize: 13, mr: 0.3 }} />
              {product.campus}
            </span>
          </div>

          {/* 标题 */}
          <h3 className="cm-apple-title" title={product.title}>
            {product.title}
          </h3>

          {/* 价格行 */}
          <div className="cm-apple-price-row">
            <div className="cm-apple-price-wrap">
              <span className="cm-apple-currency">¥</span>
              <span className="cm-apple-amount">{formatPrice(product.price).replace('¥', '')}</span>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="cm-apple-original-price">
                  {formatPrice(product.originalPrice)}
                </span>
              )}
            </div>
            <span className="cm-apple-inspect-icon">
              <NorthEastRoundedIcon sx={{ fontSize: 15 }} />
            </span>
          </div>

          {/* 渐进式浮现信息：面交点与学子背书 */}
          <div className="cm-apple-progressive-footer">
            <div className="cm-apple-meetup-cue">
              <span className="cm-apple-meetup-pin" />
              <span>{product.meetupPoint ?? `${product.campus}面交`}</span>
            </div>
            <div className="cm-apple-stats-cue">
              <span className="cm-apple-verified-tag">
                <VerifiedUserOutlinedIcon sx={{ fontSize: 13 }} />
                学子实名
              </span>
              <span className="cm-apple-view-count">
                <VisibilityOutlinedIcon sx={{ fontSize: 12 }} />
                {product.views}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
