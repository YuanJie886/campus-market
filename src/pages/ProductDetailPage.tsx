import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout';
import SendIcon from '@mui/icons-material/Send';
import EmptyState from '../components/EmptyState';
import ImageWithFallback from '../components/ImageWithFallback';
import ProductGrid from '../components/ProductGrid';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import { useNotify } from '../context/NotificationContext';
import {
  CATEGORY_EMOJI,
  CATEGORY_GRADIENT,
  CONDITION_COLOR,
} from '../utils/constants';
import { formatDateTime, formatPrice, formatRelativeTime, maskContact } from '../utils/format';

/** 商品详情页：图片、信息、卖家、下单/收藏/联系、留言板 */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, getUser } = useAuth();
  const {
    getProduct,
    incrementViews,
    isFavorite,
    toggleFavorite,
    createOrder,
    getProductComments,
    addComment,
    getOrCreateConversation,
    products,
  } = useMarket();
  const { success, info, error } = useNotify();

  const product = id ? getProduct(id) : undefined;

  const [imageIndex, setImageIndex] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [viewed, setViewed] = useState(false);

  // 浏览量 +1（每次进入详情页仅一次）
  useEffect(() => {
    if (id && !viewed) {
      incrementViews(id);
      setViewed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setImageIndex(0);
    setViewed(false);
    setCommentText('');
    setReplyTo(null);
  }, [id]);

  const seller = getUser(product?.sellerId);
  const comments = product ? getProductComments(product.id) : [];
  const topComments = useMemo(
    () => comments.filter((c) => c.parentId === null),
    [comments],
  );
  const repliesOf = (parentId: string) =>
    comments
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt);

  const related = useMemo(() => {
    if (!product) return [];
    return products
      .filter(
        (p) =>
          p.id !== product.id &&
          p.status === '在售' &&
          (p.category === product.category || p.campus === product.campus),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
  }, [product, products]);

  if (!product) {
    return (
      <EmptyState
        title="商品不存在或已被删除"
        description="它可能已经被卖家下架了，去首页看看别的宝贝吧～"
        action={
          <Button variant="contained" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />
    );
  }

  const isOwner = currentUser?.id === product.sellerId;
  const favorited = isFavorite(currentUser?.id, product.id);
  const soldOut = product.status !== '在售';

  const requireLogin = (): boolean => {
    if (!currentUser) {
      info('请先登录后再操作');
      navigate('/login', { state: { from: `/product/${product.id}` } });
      return true;
    }
    return false;
  };

  const handleFavorite = () => {
    if (requireLogin()) return;
    const nowFav = toggleFavorite(currentUser!.id, product.id);
    success(nowFav ? '已加入收藏' : '已取消收藏');
  };

  const handleBuy = () => {
    if (requireLogin()) return;
    if (isOwner) {
      error('不能购买自己发布的商品哦');
      return;
    }
    if (soldOut) {
      error('该商品当前不可购买');
      return;
    }
    const order = createOrder(product.id, currentUser!.id);
    if (!order) {
      error('下单失败，商品可能已被抢购');
      return;
    }
    success('下单成功，等待卖家确认');
    navigate('/profile/orders');
  };

  const handleContact = () => {
    if (requireLogin()) return;
    if (isOwner) {
      info('这是你自己发布的商品');
      return;
    }
    const conversation = getOrCreateConversation(
      product.id,
      currentUser!.id,
      product.sellerId,
    );
    navigate(`/messages/${conversation.id}`);
  };

  const handleSubmitComment = () => {
    if (requireLogin()) return;
    const content = commentText.trim();
    if (!content) {
      error('请输入留言内容');
      return;
    }
    addComment(product.id, currentUser!.id, content, replyTo);
    setCommentText('');
    setReplyTo(null);
    success('留言成功');
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-brand-600"
      >
        <ArrowBackIcon fontSize="small" />
        返回
      </button>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-6">
        {/* 图片区 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-card">
          <ImageWithFallback
            src={product.images[imageIndex]}
            alt={product.title}
            emoji={CATEGORY_EMOJI[product.category]}
            gradient={CATEGORY_GRADIENT[product.category]}
            className="aspect-square w-full rounded-xl"
          />
          {product.images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {product.images.map((img, index) => (
                <button
                  key={`${img}-${index}`}
                  type="button"
                  onClick={() => setImageIndex(index)}
                  className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    index === imageIndex
                      ? 'border-brand-500'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <ImageWithFallback
                    src={img}
                    alt={`${product.title} 图片 ${index + 1}`}
                    emoji={CATEGORY_EMOJI[product.category]}
                    gradient={CATEGORY_GRADIENT[product.category]}
                    className="h-16 w-16"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 信息区 */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-5">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg font-bold leading-7 text-slate-800 md:text-xl">
                {product.title}
              </h1>
              <Tooltip title={favorited ? '取消收藏' : '收藏'}>
                <IconButton onClick={handleFavorite} aria-label="收藏">
                  {favorited ? (
                    <FavoriteIcon color="error" />
                  ) : (
                    <FavoriteBorderIcon />
                  )}
                </IconButton>
              </Tooltip>
            </div>

            <div className="mt-2 flex items-end gap-3">
              <span className="text-3xl font-extrabold leading-none text-brand-600">
                {formatPrice(product.price)}
              </span>
              {product.originalPrice && product.originalPrice > product.price && (
                <>
                  <span className="text-sm leading-none text-slate-400 line-through">
                    {formatPrice(product.originalPrice)}
                  </span>
                  <Chip
                    label={`省 ${Math.round(
                      (1 - product.price / product.originalPrice) * 100,
                    )}%`}
                    size="small"
                    color="secondary"
                    sx={{ height: 20, fontSize: 11 }}
                  />
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                style={{
                  backgroundColor: CONDITION_COLOR[product.condition] ?? '#64748b',
                }}
              >
                {product.condition}
              </span>
              <Chip label={product.category} size="small" variant="outlined" />
              <Chip
                icon={<LocationOnOutlinedIcon />}
                label={product.campus}
                size="small"
                variant="outlined"
              />
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <VisibilityOutlinedIcon sx={{ fontSize: 14 }} />
                {product.views} 次浏览
              </span>
            </div>

            <Divider sx={{ my: 2 }} />

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>发布于 {formatDateTime(product.createdAt)}</span>
              <span>{formatRelativeTime(product.createdAt)}</span>
            </div>

            {soldOut && (
              <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">
                该商品已{product.status}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={soldOut || isOwner}
                startIcon={<ShoppingCartCheckoutIcon />}
                onClick={handleBuy}
                sx={{ py: 1.2 }}
              >
                {isOwner ? '这是我发布的' : soldOut ? '已售出' : '我想要'}
              </Button>
              <Button
                variant="outlined"
                size="large"
                fullWidth
                disabled={isOwner}
                startIcon={<ChatBubbleOutlineIcon />}
                onClick={handleContact}
                sx={{ py: 1.2 }}
              >
                联系卖家
              </Button>
            </div>
          </div>

          {/* 卖家卡片 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
            <h2 className="mb-3 text-sm font-bold text-slate-700">卖家信息</h2>
            <div className="flex items-center gap-3">
              <Avatar src={seller?.avatar} alt={seller?.nickname ?? '卖家'}>
                {seller?.nickname?.slice(0, 1)}
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {seller?.nickname ?? '未知用户'}
                </p>
                <p className="text-xs text-slate-400">
                  {seller?.campus ?? '—'} · 注册于{' '}
                  {seller ? formatRelativeTime(seller.createdAt) : '—'}
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              联系方式：
              <span className="font-semibold text-slate-700">
                {currentUser ? product.contact : maskContact(product.contact)}
              </span>
              {!currentUser && (
                <button
                  type="button"
                  className="ml-2 font-semibold text-brand-600 underline"
                  onClick={() => navigate('/login')}
                >
                  登录查看
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 商品描述 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-5">
        <h2 className="mb-2 text-sm font-bold text-slate-700">商品描述</h2>
        <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">
          {product.description}
        </p>
      </div>

      {/* 留言板 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-700">
          留言板 · {comments.length} 条
        </h2>

        <div className="flex flex-col gap-2 sm:flex-row">
          <TextField
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder={
              replyTo
                ? `回复 @${getUser(comments.find((c) => c.id === replyTo)?.userId)?.nickname ?? ''}`
                : '想问点什么？例如：还在吗？能小刀吗？'
            }
            fullWidth
            multiline
            maxRows={3}
          />
          <div className="flex gap-2 sm:flex-col">
            <Button
              variant="contained"
              onClick={handleSubmitComment}
              startIcon={<SendIcon />}
              sx={{ flex: 1, minWidth: 96 }}
            >
              留言
            </Button>
            {replyTo && (
              <Button color="inherit" onClick={() => setReplyTo(null)} sx={{ flex: 1 }}>
                取消回复
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {topComments.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              还没有留言，来问第一个问题吧～
            </p>
          )}

          {topComments.map((comment) => {
            const author = getUser(comment.userId);
            const replies = repliesOf(comment.id);
            return (
              <div key={comment.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-start gap-2.5">
                  <Avatar src={author?.avatar} sx={{ width: 32, height: 32 }}>
                    {author?.nickname?.slice(0, 1)}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-700">
                        {author?.nickname ?? '匿名用户'}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {comment.content}
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-brand-600"
                      onClick={() => {
                        if (requireLogin()) return;
                        setReplyTo(comment.id);
                      }}
                    >
                      回复
                    </button>
                  </div>
                </div>

                {replies.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2 border-l-2 border-slate-200 pl-3">
                    {replies.map((reply) => {
                      const replyAuthor = getUser(reply.userId);
                      return (
                        <div key={reply.id} className="flex items-start gap-2">
                          <Avatar
                            src={replyAuthor?.avatar}
                            sx={{ width: 26, height: 26 }}
                          >
                            {replyAuthor?.nickname?.slice(0, 1)}
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-700">
                                {replyAuthor?.nickname ?? '匿名用户'}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatRelativeTime(reply.createdAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                              {reply.content}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 相关推荐 */}
      {related.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-bold text-slate-700">你可能还喜欢</h2>
          <ProductGrid products={related} />
        </div>
      )}
    </div>
  );
}
