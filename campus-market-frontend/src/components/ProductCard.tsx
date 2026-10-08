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
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
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
import { toUserMessage } from '../api/errors';

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
  // feed 返回的商品带有相对当前用户宿舍楼的近似位置。普通列表没有这些字段，
  // 此时什么都不显示——绝不拿校区距离编一个「约 N 分钟」出来。
  const feedProduct = product as Product & {
    sameBuilding?: boolean;
    approximateWalkMinutes?: number | null;
  };
  const proximityLabel = feedProduct.sameBuilding
    ? '同楼栋'
    : typeof feedProduct.approximateWalkMinutes === 'number'
      ? `步行约 ${feedProduct.approximateWalkMinutes} 分钟`
      : null;

  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { isFavorite, setFavorite } = useMarket();
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
      const nowFav = await setFavorite(currentUser.id, product.id, !isFavorite(currentUser.id, product.id));
      success(nowFav ? '已加入心愿单' : '已移出心愿单');
    } catch (e) {
      error(toUserMessage(e));
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
            {/*
              有取货楼栋时显示「园区 · 楼栋」，没有就回退到校区。
              这里展示的是<b>商品的取货楼栋</b>，来自商品记录本身，
              不读取卖家的个人资料——卖家的宿舍楼永远不出现在任何公共位置。
            */}
            <span className="cm-apple-campus-tag">
              <PlaceOutlinedIcon sx={{ fontSize: 13, mr: 0.3 }} />
              {product.buildingName
                ? `${product.buildingZone ?? product.campus} · ${product.buildingName}`
                : product.campus}
            </span>
            {proximityLabel && (
              <span className="cm-apple-campus-tag" title="直线估算，实际路线以校园道路为准">
                {proximityLabel}
              </span>
            )}
          </div>

          {/* 标题 */}
          <h3 className="cm-apple-title" title={product.title}>
            {product.title}
          </h3>
          {/* 模块 4：关联了教材版本时写出具体版本，而不是只写「教材」 */}
          {product.textbook && (
            <p className="mt-0.5 truncate text-xs font-medium text-teal-800" data-textbook-edition={product.textbook.editionId}
              title={`${product.textbook.title} ${product.textbook.editionLabel} · ${product.textbook.publisher}${product.textbook.isbn ? ` · ISBN ${product.textbook.isbn}` : ''}`}>
              课程教材 · {product.textbook.editionLabel} · {product.textbook.publisher}
              {product.textbook.isbn ? ` · ISBN ${product.textbook.isbn}` : ''}
              {product.textbook.courseNames[0] ? ` · ${product.textbook.courseNames[0]}` : ''}
            </p>
          )}

          {/* 模块 5：整套打包写明「整套转让」与包含的类数 / 件数，价格是整套总价 */}
          {product.listingKind === 'BUNDLE' && product.bundle && (
            <p className="mt-0.5 text-xs font-medium text-amber-900" data-listing-kind="BUNDLE">
              整套转让 · 包含 {product.bundle.categoryCount} 类 / {product.bundle.totalQuantity} 件
            </p>
          )}

          {/* 模块 6：圈子标签只写服务端返回给当前查看者的圈子（查看者在籍或是卖家本人），不猜测其他圈子 */}
          {product.visibility === 'CIRCLE_ONLY' && product.circles && product.circles.length > 0 && (
            <p className="mt-0.5 truncate text-xs font-medium text-indigo-800" data-visibility="CIRCLE_ONLY">
              圈子可见 · {product.circles.map((c) => c.name).join('、')}
            </p>
          )}

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
                {/* 8.0：平台不核验学籍或身份，不能写「实名」；这里只说明是同校商品 */}
                <SchoolOutlinedIcon sx={{ fontSize: 13 }} />
                同校
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
