import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Button from "@mui/material/Button";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import ImageWithFallback from "../components/ImageWithFallback";
import EmptyState from "../components/EmptyState";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { useNotify } from "../context/NotificationContext";
import { CATEGORY_EMOJI, CATEGORY_GRADIENT } from "../utils/constants";
import { formatDateTime, formatPrice } from "../utils/format";

interface SuccessState { orderId?: string; conversationId?: string }

export default function CheckoutSuccessPage() {
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getProduct, getOrder, getBuyOrders, meetingPoints, conversations } = useMarket();
  const { error } = useNotify();
  const state = location.state as SuccessState | null;
  const product = productId ? getProduct(productId) : undefined;
  const order = useMemo(() => {
    if (state?.orderId) return getOrder(state.orderId);
    if (!productId || !currentUser) return undefined;
    return getBuyOrders(currentUser.id).find((item) => item.productId === productId);
  }, [currentUser, getBuyOrders, getOrder, productId, state?.orderId]);
  const conversationId = state?.conversationId ?? order?.conversationId ??
    conversations.find((item) => item.productId === productId && item.buyerId === currentUser?.id)?.id;

  if (!product || !order) {
    return (
      <EmptyState
        title="预约记录暂时不可见"
        description="你可以去订单列表查看最近的预约。"
        action={<Button variant="contained" onClick={() => navigate("/orders")}>查看订单</Button>}
      />
    );
  }

  const point = meetingPoints.find((item) => item.id === order.meetingPointId);
  const openChat = () => {
    if (conversationId) navigate(`/messages/${conversationId}`);
    else error("暂时无法找到本次预约的会话，请从消息列表重试");
  };

  return (
    <div className="mx-auto max-w-2xl py-4 md:py-10">
      <div className="rounded-[32px] border border-slate-100 bg-white p-6 text-center shadow-card md:p-10">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CheckCircleRoundedIcon sx={{ fontSize: 42 }} />
        </span>
        <h1 className="mt-5 text-2xl font-extrabold text-slate-900">预约已提交，等卖家确认</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">我们已经通知卖家，并为这次预约建立了专属会话。你可以在订单详情里跟进进度。</p>

        <div className="mt-7 flex gap-3 rounded-2xl bg-slate-50 p-3 text-left">
          <ImageWithFallback
            src={product.images[0]}
            alt={product.title}
            emoji={CATEGORY_EMOJI[product.category]}
            gradient={CATEGORY_GRADIENT[product.category]}
            className="h-20 w-20 shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-bold text-slate-800">{product.title}</h2>
            <p className="mt-1 text-lg font-extrabold text-brand-600">{formatPrice(order.price)}</p>
            <p className="mt-1 text-xs text-slate-500">{point?.name ?? order.meetingPointId} · {order.meetingAtIso ? formatDateTime(Date.parse(order.meetingAtIso)) : "待确认"}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-left text-sm leading-6 text-amber-900">
          卖家超时未确认时，预约会自动释放，商品重新回到在售状态。期间如需调整时间或地点，可以直接在会话中沟通。
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button variant="contained" size="large" endIcon={<ArrowForwardRoundedIcon />} onClick={() => navigate(`/orders/${order.id}`)}>
            查看订单详情
          </Button>
          <Button variant="outlined" size="large" startIcon={<ChatBubbleOutlineIcon />} onClick={openChat} disabled={!conversationId}>
            和卖家聊聊
          </Button>
        </div>
      </div>
    </div>
  );
}
