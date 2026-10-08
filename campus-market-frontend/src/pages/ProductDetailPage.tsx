import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Alert,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ShoppingCartCheckoutIcon from "@mui/icons-material/ShoppingCartCheckout";
import SendIcon from "@mui/icons-material/Send";
import EmptyState from "../components/EmptyState";
import ImageWithFallback from "../components/ImageWithFallback";
import ProductGrid from "../components/ProductGrid";
import { useMarket } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotificationContext";
import {
  CATEGORY_EMOJI,
  CATEGORY_GRADIENT,
  CONDITION_COLOR,
} from "../utils/constants";
import {
  formatDateTime,
  formatPrice,
  formatRelativeTime,
  maskContact,
} from "../utils/format";
import { toUserMessage } from '../api/errors';
import { getApiClient } from '../api/client';
import CampusMap from '../components/CampusMap';
import type { Building } from '../types';
import type { ProductDisclosure } from '../api/contracts';
import SellerDeclarationCard from '../components/trust/SellerDeclarationCard';
import PublicTradeSummaryCard from '../components/trust/PublicTradeSummaryCard';
import { averagePerItem } from '../utils/supply';
import ReportDialog from '../components/governance/ReportDialog';
import { SLOT_DEFAULT_MINUTES } from '../api/contracts';
import { SLOT_CHOICES, formatSlotRange } from '../utils/governance';

/** 商品详情页：图片、信息、卖家、下单/收藏/联系、留言板 */
export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  // 从需求匹配收件箱点「去预约面交」进来时带 ?book=1。
  // 这只是替用户打开<b>现有</b>的预约弹窗：在售检查、不能买自己的商品、
  // 活跃订单唯一、面交点确认，全部照常走 handleBuy 与后端校验，绝不自动下单。
  const [searchParams, setSearchParams] = useSearchParams();
  const bookRequested = searchParams.get("book") === "1";
  const navigate = useNavigate();
  const { currentUser, getUser } = useAuth();
  const {
    getProduct,
    loadProduct,
    meetingPoints,
    loading,
    incrementViews,
    isFavorite,
    setFavorite,
    createOrder,
    getProductComments,
    addComment,
    getOrCreateConversation,
    products,
  } = useMarket();
  const { success, info, error } = useNotify();

  const product = id ? getProduct(id) : undefined;

  const [imageIndex, setImageIndex] = useState(0);
  const [commentText, setCommentText] = useState("");
  // 模块 7：举报商品或某条留言
  const [reporting, setReporting] = useState<{ type: 'PRODUCT' | 'COMMENT'; id: string; label: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [viewed, setViewed] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [meetingPoint, setMeetingPoint] = useState("");
  // 仅用于示意地图的楼栋坐标，公共参考数据
  const [campusBuildings, setCampusBuildings] = useState<Building[]>([]);
  const [meetingAt, setMeetingAt] = useState("");
  // 7.1A：明确的面交时长（默认 60 分钟），提交时换算成结束时间；卖家接单时看到同一个完整时段
  const [slotMinutes, setSlotMinutes] = useState(SLOT_DEFAULT_MINUTES);
  const [bookingContact, setBookingContact] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingKey, setBookingKey] = useState("");
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  // 卖家声明只在商品详情里有；undefined 表示尚未读到
  const [disclosure, setDisclosure] = useState<ProductDisclosure | null | undefined>(undefined);
  // 示意地图所需的楼栋坐标：只在商品校区变化时拉一次
  const productCampus = product?.campus;
  useEffect(() => {
    if (!productCampus) return;
    let active = true;
    getApiClient()
      .listBuildings(productCampus)
      .then((list) => { if (active) setCampusBuildings(list) })
      .catch(() => { if (active) setCampusBuildings([]) });   // 地图降级为列表，不影响下单
    return () => { active = false };
  }, [productCampus]);

  useEffect(() => {
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    setDisclosure(undefined);
    if (id && !loading)
      void loadProduct(id)
        .then((detail) => {
          if (active) setDisclosure(detail.inspection ?? null);
        })
        .catch((e) => {
          if (active) setDetailError(e.message);
        })
        .finally(() => {
          if (active) setDetailLoading(false);
        });
    return () => {
      active = false;
    };
  }, [id, loadProduct, currentUser?.id, loading]);

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
    setCommentText("");
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
          p.status === "在售" &&
          (p.category === product.category || p.campus === product.campus),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
  }, [product, products]);

  // 必须位于所有提前 return 之前（Hooks 规则）。handleBuy 定义在其后，经 ref 调用。
  // 之前这组 Hook 排在「加载中」的提前 return 之后：商品不在列表缓存里、首帧走了加载分支时，
  // 下一帧 Hook 数量变化会直接让页面崩溃。
  const buyRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!bookRequested || !product) return;
    const next = new URLSearchParams(searchParams);
    next.delete("book");
    setSearchParams(next, { replace: true });   // 只触发一次，刷新页面不会再弹
    buyRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookRequested, product?.id]);

  if (!product && (loading || detailLoading))
    return <p className="p-8 text-slate-500">正在加载商品…</p>;

  if (!product) {
    return (
      <EmptyState
        title="商品不存在或已被删除"
        description={
          detailError || "它可能已经被卖家下架了，去首页看看别的宝贝吧～"
        }
        action={
          <Button variant="contained" onClick={() => navigate("/")}>
            返回首页
          </Button>
        }
      />
    );
  }

  const isOwner = currentUser?.id === product.sellerId;
  const favorited = isFavorite(currentUser?.id, product.id);
  const soldOut = product.status !== "在售";

  const requireLogin = (): boolean => {
    if (!currentUser) {
      info("请先登录后再操作");
      navigate("/login", { state: { from: `/product/${product.id}` } });
      return true;
    }
    return false;
  };

  const handleFavorite = async () => {
    try {
      if (requireLogin()) return;
      const nowFav = await setFavorite(currentUser!.id, product.id, !isFavorite(currentUser!.id, product.id));
      success(nowFav ? "已加入收藏" : "已取消收藏");
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  const handleBuy = async () => {
    try {
      if (requireLogin()) return;
      if (isOwner) {
        error("不能购买自己发布的商品哦");
        return;
      }
      if (soldOut) {
        error("该商品当前不可购买");
        return;
      }
      // 不替用户预选面交点：地图会标出推荐项，但最终地点必须由用户自己点选确认
      setMeetingPoint("");
      setBookingContact(currentUser!.contact ?? "");
      setBookingKey(crypto.randomUUID());
      setBookingOpen(true);
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  buyRef.current = () => void handleBuy();

  const submitBooking = async () => {
    if (bookingBusy) return;
    setBookingBusy(true);
    try {
      const order = await createOrder(product.id, currentUser!.id, {
        meetingPointId: meetingPoint,
        meetingAtIso: new Date(meetingAt).toISOString(),
        meetingEndsAtIso: new Date(new Date(meetingAt).getTime() + slotMinutes * 60_000).toISOString(),
        contact: bookingContact,
        idempotencyKey: bookingKey,
      });
      if (!order) {
        error("下单失败，商品可能已被抢购");
        return;
      }
      setBookingOpen(false);
      success("预约成功，等待卖家确认");
      navigate("/profile/orders");
    } catch (e) {
      error(toUserMessage(e));
    } finally {
      setBookingBusy(false);
    }
  };

  const handleContact = async () => {
    try {
      if (requireLogin()) return;
      if (isOwner) {
        info("这是你自己发布的商品");
        return;
      }
      const conversation = await getOrCreateConversation(
        product.id,
        currentUser!.id,
        product.sellerId,
      );
      navigate(`/messages/${conversation.id}`);
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  const handleSubmitComment = async () => {
    try {
      if (requireLogin()) return;
      const content = commentText.trim();
      if (!content) {
        error("请输入留言内容");
        return;
      }
      await addComment(product.id, currentUser!.id, content, replyTo);
      setCommentText("");
      setReplyTo(null);
      success("留言成功");
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Dialog
        open={bookingOpen}
        onClose={() => !bookingBusy && setBookingOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>预约校园面交</DialogTitle>
        <DialogContent className="space-y-4">
          <Alert severity="info">
            请选择公共交易点。面交验货后自行付款，平台不代收商品款。
          </Alert>
          <CampusMap
            buildings={campusBuildings}
            meetingPoints={meetingPoints.filter((p) => p.campus === product.campus)}
            productBuildingId={product.buildingId ?? null}
            viewerBuildingId={
              // 只有同校区时才用本人宿舍楼参与计算，跨校区的距离没有意义
              currentUser?.campus === product.campus ? currentUser?.dormBuildingId ?? null : null
            }
            selectedMeetingPointId={meetingPoint || null}
            onPick={(id) => {
              setMeetingPoint(id);
              setBookingKey(crypto.randomUUID());
            }}
          />
          <TextField
            select
            fullWidth
            label="面交地点"
            value={meetingPoint}
            onChange={(e) => {
              setMeetingPoint(e.target.value);
              setBookingKey(crypto.randomUUID());
            }}
          >
            {meetingPoints
              .filter((p) => p.campus === product.campus)
              .map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {product.campus} · {p.name}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            fullWidth
            label="面交时间"
            type="datetime-local"
            value={meetingAt}
            InputLabelProps={{ shrink: true }}
            onChange={(e) => {
              setMeetingAt(e.target.value);
              setBookingKey(crypto.randomUUID());
            }}
          />
          <TextField
            select
            fullWidth
            label="面交时长"
            value={slotMinutes}
            onChange={(e) => {
              setSlotMinutes(Number(e.target.value));
              setBookingKey(crypto.randomUUID());
            }}
            helperText="卖家接单即确认这个完整时段；之后要改时间，需要双方通过改约确认。"
          >
            {SLOT_CHOICES.map((m) => (
              <MenuItem key={m} value={m}>
                {m} 分钟{m === SLOT_DEFAULT_MINUTES ? "（默认）" : ""}
              </MenuItem>
            ))}
          </TextField>
          {meetingAt && !Number.isNaN(new Date(meetingAt).getTime()) && (
            <p className="text-sm text-slate-700" aria-live="polite" data-testid="booking-slot">
              面交时段：{formatSlotRange(new Date(meetingAt).getTime(), new Date(meetingAt).getTime() + slotMinutes * 60_000)}
            </p>
          )}
          <TextField
            fullWidth
            label="联系方式（仅交易双方可见）"
            value={bookingContact}
            onChange={(e) => {
              setBookingContact(e.target.value);
              setBookingKey(crypto.randomUUID());
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={bookingBusy} onClick={() => setBookingOpen(false)}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={
              bookingBusy ||
              !meetingPoint ||
              !meetingAt ||
              !bookingContact.trim()
            }
            onClick={submitBooking}
          >
            {bookingBusy ? "提交中…" : "确认预约"}
          </Button>
        </DialogActions>
      </Dialog>
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
                      ? "border-brand-500"
                      : "border-transparent opacity-70 hover:opacity-100"
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
              <Tooltip title={favorited ? "取消收藏" : "收藏"}>
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
              {product.originalPrice &&
                product.originalPrice > product.price && (
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
                  backgroundColor:
                    CONDITION_COLOR[product.condition] ?? "#64748b",
                }}
              >
                {product.condition}
              </span>
              <Chip label={product.category} size="small" variant="outlined" />
              <Chip
                icon={<LocationOnOutlinedIcon />}
                label={
                  // 取货楼栋来自商品本身，不是卖家资料；没有楼栋就只显示校区
                  product.buildingName
                    ? `${product.campus} · ${product.buildingZone ?? ''}${product.buildingName}`
                    : product.campus
                }
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
                {isOwner ? "这是我发布的" : soldOut ? "已售出" : "我想要"}
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
              <Avatar src={seller?.avatar} alt={seller?.nickname ?? "卖家"}>
                {seller?.nickname?.slice(0, 1)}
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {seller?.nickname ?? "未知用户"}
                </p>
                <p className="text-xs text-slate-400">
                  {seller?.campus ?? "—"} · 注册于{" "}
                  {seller ? formatRelativeTime(seller.createdAt) : "—"}
                </p>
              </div>
            </div>
            <PublicTradeSummaryCard userId={product.sellerId} />
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {isOwner ? `本人联系方式：${product.contact || '未填写'}` : '请使用站内消息联系卖家，面交信息仅交易双方可见。'}
            </div>
            {isOwner && product.moderationHidden && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">
                这件商品已被平台工作人员隐藏，其他同学暂时看不到。可以在「我的限制」里查看原因并申诉一次。
              </p>
            )}
            {!isOwner && (
              <Button size="small" color="inherit" sx={{ mt: 1 }} onClick={() => setReporting({ type: 'PRODUCT', id: product.id, label: product.title })}>
                举报这件商品
              </Button>
            )}
          </div>
        </div>
      </div>

      {product.textbook && (
        <section aria-labelledby="product-textbook-title" className="rounded-2xl border border-teal-100 bg-white p-4 shadow-card md:p-5"
          data-textbook-edition={product.textbook.editionId}>
          <h2 id="product-textbook-title" className="mb-2 text-sm font-bold text-slate-700">课程教材版本</h2>
          <p className="text-sm text-slate-800">
            {product.textbook.title} <strong>{product.textbook.editionLabel}</strong>
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-slate-700">
            <dt>ISBN</dt><dd>{product.textbook.isbn ?? '无 ISBN'}</dd>
            <dt>出版社</dt><dd>{product.textbook.publisher}</dd>
            <dt>关联课程</dt><dd>{product.textbook.courseNames.length ? product.textbook.courseNames.join('、') : '暂无已验证的课程'}</dd>
          </dl>
          <p className="mt-2 text-xs text-slate-600">以上是卖家发布时确认的版本。</p>
          <Link to={`/textbooks/${encodeURIComponent(product.textbook.editionId)}`} className="mt-1 inline-block text-xs text-teal-800 underline">
            查看这个版本的其他在售商品
          </Link>
        </section>
      )}

      {product.visibility === 'CIRCLE_ONLY' && (
        <section aria-labelledby="product-circle-title" className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-card md:p-5" data-visibility="CIRCLE_ONLY">
          <h2 id="product-circle-title" className="mb-1 text-sm font-bold text-slate-700">圈子可见</h2>
          <p className="text-xs text-slate-700">
            这件商品只对卖家选择的圈子成员可见。圈子由同学自己创建，不代表学校或任何组织。
          </p>
          {product.circles && product.circles.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-2 text-xs">
              {product.circles.map((c) => (
                <li key={c.id}><Link to={`/circles/${encodeURIComponent(c.id)}`} className="text-indigo-800 underline">{c.name}</Link></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {product.listingKind === 'BUNDLE' && (
        <section aria-labelledby="product-bundle-title" className="rounded-2xl border border-amber-200 bg-white p-4 shadow-card md:p-5" data-listing-kind="BUNDLE">
          <h2 id="product-bundle-title" className="mb-1 text-sm font-bold text-slate-700">整套转让明细</h2>
          <p className="text-sm font-semibold text-amber-900">整套出售，不支持单独下单。</p>
          {(() => {
            const items = product.bundleItems ?? [];
            const quantity = items.reduce((n, i) => n + i.quantity, 0);
            const average = averagePerItem(product.price, quantity);
            return (
              <>
                <p className="mt-1 text-xs text-slate-700">
                  共 {items.length} 项 · {new Set(items.map((i) => i.category)).size} 类 / {quantity} 件 · 整套总价 {formatPrice(product.price)}
                  {average ? ` · 平均每件约 ¥${average}（仅供参考，不能按件购买）` : ''}
                </p>
                <table className="mt-2 w-full text-left text-xs">
                  <caption className="sr-only">整套包含的物品</caption>
                  <thead>
                    <tr className="text-slate-600"><th scope="col">物品</th><th scope="col">分类</th><th scope="col">成色</th><th scope="col">数量</th><th scope="col">备注</th></tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.itemCode} className="border-t border-slate-100">
                        <td className="py-1">{i.name}</td><td>{i.category}</td><td>{i.condition}</td><td>{i.quantity}</td><td>{i.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-600">面交验货时逐项核对；任何一项与描述不符，都可以在订单里标记不一致。</p>
              </>
            );
          })()}
        </section>
      )}

      <SellerDeclarationCard disclosure={disclosure} />

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
                ? `回复 @${getUser(comments.find((c) => c.id === replyTo)?.userId)?.nickname ?? ""}`
                : "想问点什么？例如：还在吗？能小刀吗？"
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
              <Button
                color="inherit"
                onClick={() => setReplyTo(null)}
                sx={{ flex: 1 }}
              >
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
                        {author?.nickname ?? "匿名用户"}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(comment.createdAt)}
                      </span>
                    </div>
                    {comment.moderationHidden ? (
                      <p className="mt-1 text-sm leading-6 text-slate-500" role="note">
                        {comment.hiddenForAuthor
                          ? "你的这条留言已被平台隐藏，其他同学看不到内容；原文保留，没有删除。可以在「我的限制」里查看并申诉一次。"
                          : "该留言已被平台隐藏。"}
                      </p>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {comment.content}
                      </p>
                    )}
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
                    {comment.userId !== currentUser?.id && !comment.moderationHidden && (
                      <button type="button" className="ml-3 mt-1 text-xs font-medium text-slate-600"
                        onClick={() => { if (requireLogin()) return; setReporting({ type: 'COMMENT', id: comment.id, label: `${author?.nickname ?? '同学'}的留言` }) }}>
                        举报留言
                      </button>
                    )}
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
                                {replyAuthor?.nickname ?? "匿名用户"}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatRelativeTime(reply.createdAt)}
                              </span>
                            </div>
                            {reply.moderationHidden ? (
                              <p className="mt-0.5 text-sm leading-6 text-slate-500" role="note">
                                {reply.hiddenForAuthor ? "你的这条回复已被平台隐藏；原文保留，可以在「我的限制」里申诉。" : "该回复已被平台隐藏。"}
                              </p>
                            ) : (
                              <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                                {reply.content}
                              </p>
                            )}
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
          <h2 className="mb-3 text-base font-bold text-slate-700">
            你可能还喜欢
          </h2>
          <ProductGrid products={related} />
        </div>
      )}
      {reporting && (
        <ReportDialog open targetType={reporting.type} targetId={reporting.id} targetLabel={reporting.label} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}
