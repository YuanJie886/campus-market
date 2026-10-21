import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import type { Category, Product } from '../types';
import type { ContactRequestStatus } from '../api/contracts';
import { CATEGORY_EMOJI } from '../utils/constants';
import { formatPrice, formatRelativeTime } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useNotify } from '../context/NotificationContext';
import ImageWithFallback from './ImageWithFallback';
import { toUserMessage } from '../api/errors';

interface ProductCardProps {
  product: Product;
  /** 保留给旧调用方：网格中的序号（不再用于动效） */
  index?: number;
  /** 当前用户对这件商品发出的联系申请状态；没有申请时为空 */
  contactStatus?: ContactRequestStatus | null;
}

/** 无图 / 图片失败时的底色，与小程序 .product-image.category-* 相同（见 index.css 的 --cm-cat-*） */
const CATEGORY_TINT: Record<Category, string> = {
  数码电子: 'var(--cm-cat-electronics)',
  教材书籍: 'var(--cm-cat-books)',
  生活用品: 'var(--cm-cat-home)',
  服饰鞋包: 'var(--cm-cat-fashion)',
  运动户外: 'var(--cm-cat-outdoor)',
  其他: 'var(--cm-cat-other)',
};

/** 只展示对用户有用、且不会误导的两种状态：已申请（等待卖家）与卖家已同意 */
const CONTACT_BADGE: Partial<Record<ContactRequestStatus, { text: string; tone: string }>> = {
  PENDING: { text: '已申请联系', tone: 'is-pending' },
  APPROVED: { text: '卖家已同意', tone: 'is-approved' },
};

/** feed 商品卡片上的距离：同楼栋不显示距离，缺坐标不显示，其余写成约几分钟步行（直线估算）。与小程序 distanceText 相同 */
export function proximityText(product: Product): string {
  const feed = product as Product & { sameBuilding?: boolean; approximateWalkMinutes?: number | null };
  if (feed.sameBuilding) return '同楼栋';
  return typeof feed.approximateWalkMinutes === 'number' ? `约 ${feed.approximateWalkMinutes} 分钟步行` : '';
}

/**
 * 商品卡片。结构固定（与小程序卡片一致）：图片（成色、收藏、距离）→ 价格 → 标题（两行截断）→ 附加标签 → 取货位置 · 发布时间。
 *
 * <p>整张卡片可点击，但只有标题里的链接是真正的可聚焦元素（用 ::after 铺满卡片），
 * 收藏按钮叠在其上——这样不会出现「链接里套按钮」的嵌套交互。
 */
export default function ProductCard({ product, contactStatus = null }: ProductCardProps) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { isFavorite, setFavorite } = useMarket();
  const { success, info, error } = useNotify();
  const [busy, setBusy] = useState(false);

  const favorited = isFavorite(currentUser?.id, product.id);
  const soldOut = product.status !== '在售';
  const proximity = proximityText(product);
  const badge = contactStatus ? CONTACT_BADGE[contactStatus] : undefined;
  // 有取货楼栋时显示「校区 · 楼栋」（与小程序一致），没有就只显示校区。这里是<b>商品的取货楼栋</b>，来自商品记录本身，
  // 不读取卖家的个人资料——卖家的宿舍楼永远不出现在任何公共位置。
  const place = product.buildingName
    ? `${product.campus} · ${product.buildingName}`
    : product.campus;

  const handleFavorite = async (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUser) {
      info('请先登录后再收藏');
      navigate('/login');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const nowFav = await setFavorite(currentUser.id, product.id, !favorited);
      success(nowFav ? '已加入心愿单' : '已移出心愿单');
    } catch (e) {
      error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`cm-card ${soldOut ? 'is-sold' : ''}`}>
      <div className="cm-card-media">
        <ImageWithFallback
          src={product.images?.[0] ?? ''}
          alt={product.title}
          gradient={CATEGORY_TINT[product.category]}
          className="h-full w-full"
          fallback={(reason) => (
            <div className="cm-card-placeholder">
              <span aria-hidden="true" className="cm-card-placeholder-emoji">{CATEGORY_EMOJI[product.category]}</span>
              <span className="cm-card-placeholder-text">{reason === 'failed' ? '图片暂时无法显示' : '暂无图片'}</span>
            </div>
          )}
        />
        <span className="cm-card-condition">{product.condition}</span>
        {proximity && (
          <span className="cm-card-proximity" title="直线估算，实际路线以校园道路为准">{proximity}</span>
        )}
        {soldOut && <span className="cm-card-sold">{product.status}</span>}
        <button
          type="button"
          onClick={(e) => void handleFavorite(e)}
          aria-label={favorited ? '移出收藏' : '收藏好物'}
          aria-pressed={favorited}
          disabled={busy}
          className={`cm-card-fav ${favorited ? 'is-active' : ''}`}
        >
          {favorited ? <FavoriteIcon sx={{ fontSize: 17 }} /> : <FavoriteBorderIcon sx={{ fontSize: 17 }} />}
        </button>
      </div>

      <div className="cm-card-body">
        <div className="cm-card-price-row">
          <p className="cm-card-price">
            <span className="cm-card-currency">¥</span>
            {formatPrice(product.price).replace('¥', '')}
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="cm-card-original">{formatPrice(product.originalPrice)}</span>
            )}
          </p>
          {badge && <span className={`cm-card-badge ${badge.tone}`}>{badge.text}</span>}
        </div>

        <h3 className="cm-card-title">
          <Link to={`/product/${product.id}`} className="cm-card-link" aria-label={`查看闲置：${product.title}`}>
            {product.title}
          </Link>
        </h3>

        {/* 模块 4：关联了教材版本时写出具体版本，而不是只写「教材」 */}
        {product.textbook && (
          <p className="cm-card-tag is-textbook" data-textbook-edition={product.textbook.editionId}
            title={`${product.textbook.title} ${product.textbook.editionLabel} · ${product.textbook.publisher}${product.textbook.isbn ? ` · ISBN ${product.textbook.isbn}` : ''}`}>
            课程教材 · {product.textbook.editionLabel} · {product.textbook.publisher}
            {product.textbook.isbn ? ` · ISBN ${product.textbook.isbn}` : ''}
            {product.textbook.courseNames[0] ? ` · ${product.textbook.courseNames[0]}` : ''}
          </p>
        )}
        {/* 模块 5：整套打包写明「整套转让」与包含的类数 / 件数，价格是整套总价 */}
        {product.listingKind === 'BUNDLE' && product.bundle && (
          <p className="cm-card-tag is-bundle" data-listing-kind="BUNDLE">
            整套转让 · 包含 {product.bundle.categoryCount} 类 / {product.bundle.totalQuantity} 件
          </p>
        )}
        {/* 模块 6：圈子标签只写服务端返回给当前查看者的圈子（查看者在籍或是卖家本人），不猜测其他圈子 */}
        {product.visibility === 'CIRCLE_ONLY' && product.circles && product.circles.length > 0 && (
          <p className="cm-card-tag is-circle" data-visibility="CIRCLE_ONLY">
            圈子可见 · {product.circles.map((c) => c.name).join('、')}
          </p>
        )}

        <div className="cm-card-meta">
          <span className="cm-card-place">
            <PlaceOutlinedIcon sx={{ fontSize: 13 }} aria-hidden="true" />
            <span>{place}</span>
          </span>
          <time className="cm-card-time" dateTime={Number.isFinite(product.createdAt) ? new Date(product.createdAt).toISOString() : undefined}>
            {formatRelativeTime(product.createdAt)}
          </time>
        </div>
      </div>
    </article>
  );
}
