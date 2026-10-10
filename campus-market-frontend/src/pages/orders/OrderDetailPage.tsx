import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import EmptyState from "../../components/EmptyState";
import ReviewDialog from "../../components/ReviewDialog";
import ImageWithFallback from "../../components/ImageWithFallback";
import { useAuth } from "../../context/AuthContext";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import { CATEGORY_EMOJI, CATEGORY_GRADIENT } from "../../utils/constants";
import { formatDateTime, formatPrice } from "../../utils/format";
import type { CanonicalOrderStatus } from "../../types";

const labels: Record<string, string> = {
  PENDING_SELLER_CONFIRM: "待卖家确认",
  PENDING_MEETING: "待面交",
  BUYER_CONFIRMED: "待卖家核验",
  SELLER_CONFIRMED: "待完成",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "已超时",
  DISPUTED: "申诉中",
};

const waiting: Record<string, string> = {
  PENDING_SELLER_CONFIRM: "等待卖家确认预约",
  PENDING_MEETING: "等待双方到达面交点",
  BUYER_CONFIRMED: "等待卖家核验确认码",
  SELLER_CONFIRMED: "等待订单完成",
  COMPLETED: "交易已完成",
  CANCELLED: "订单已取消，商品已回到在售",
  EXPIRED: "预约已超时，商品已回到在售",
  DISPUTED: "等待平台介入处理",
};

const timeline = [
  ["PENDING_SELLER_CONFIRM", "提交预约"],
  ["PENDING_MEETING", "卖家接单"],
  ["BUYER_CONFIRMED", "面交验货"],
  ["COMPLETED", "交易完成"],
] as const;

function canonicalStatus(status?: CanonicalOrderStatus, legacy?: string): CanonicalOrderStatus {
  if (status) return status;
  return ({ 待确认: "PENDING_SELLER_CONFIRM", 交易中: "PENDING_MEETING", 已完成: "COMPLETED", 已取消: "CANCELLED" } as Record<string, CanonicalOrderStatus>)[legacy ?? ""] ?? "PENDING_SELLER_CONFIRM";
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, getUser } = useAuth();
  const { getOrder, getProduct, meetingPoints, updateOrderStatus, addReview, getOrCreateConversation } = useMarket();
  const { success, error } = useNotify();
  const order = id ? getOrder(id) : undefined;
  const product = order ? getProduct(order.productId) : undefined;
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  if (!order || !product || !currentUser) {
    return (
      <EmptyState
        title="找不到这笔订单"
        description="订单可能已被清理，或你没有查看权限。"
        action={<Button variant="contained" onClick={() => navigate("/orders")}>返回订单列表</Button>}
      />
    );
  }

  const status = canonicalStatus(order.canonicalStatus, order.status);
  const isBuyer = order.buyerId === currentUser.id;
  const counterpart = getUser(isBuyer ? order.sellerId : order.buyerId);
  const point = meetingPoints.find((item) => item.id === order.meetingPointId);
  const myReview = isBuyer ? order.buyerReview : order.sellerReview;
  const activeStep = status === "PENDING_SELLER_CONFIRM" ? 0 : status === "PENDING_MEETING" ? 1 : status === "BUYER_CONFIRMED" || status === "SELLER_CONFIRMED" ? 2 : 3;

  const change = async (to: CanonicalOrderStatus, confirmationCode?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateOrderStatus(order.id, to, confirmationCode);
      success(to === "COMPLETED" ? "核验成功，交易已完成" : to === "CANCELLED" ? "预约已取消" : "订单状态已更新");
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openConversation = async () => {
    try {
      const conversation = await getOrCreateConversation(order.productId, currentUser.id, order.sellerId);
      navigate(`/messages/${conversation.id}`);
    } catch (e) {
      error((e as Error).message);
    }
  };

  const submitReview = async (rating: number, comment: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await addReview(order.id, currentUser.id, { rating, comment: comment || "交易顺利", createdAt: Date.now() });
      setReviewOpen(false);
      success("评价已提交");
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" className="text-sm text-slate-500 hover:text-brand-600" onClick={() => navigate("/orders")}>← 返回订单列表</button>
          <h1 className="mt-3 text-2xl font-extrabold text-slate-900">订单详情</h1>
        </div>
        <Chip label={labels[status]} color={status === "COMPLETED" ? "success" : status === "CANCELLED" || status === "EXPIRED" ? "default" : "warning"} />
      </div>

      <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">订单号 {order.id.slice(-10)} · {formatDateTime(order.createdAt)}</p>
            <p className="mt-2 text-lg font-extrabold text-slate-800">当前等待：{waiting[status]}</p>
          </div>
          <p className="text-2xl font-extrabold text-brand-600">{formatPrice(order.price)}</p>
        </div>
        <div className="mt-7 grid grid-cols-4 gap-2">
          {timeline.map(([step, label], index) => {
            const done = index < activeStep || status === "COMPLETED";
            const current = index === activeStep && !["CANCELLED", "EXPIRED"].includes(status);
            return (
              <div key={step} className="relative text-center">
                {index > 0 && <span className={`absolute -left-1/2 top-3 h-0.5 w-full ${done ? "bg-brand-500" : "bg-slate-200"}`} />}
                <span className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${done || current ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                  {done ? "✓" : index + 1}
                </span>
                <span className={`mt-2 block text-[11px] ${current ? "font-bold text-brand-700" : "text-slate-400"}`}>{label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex gap-3">
            <ImageWithFallback src={product.images[0]} alt={product.title} emoji={CATEGORY_EMOJI[product.category]} gradient={CATEGORY_GRADIENT[product.category]} className="h-24 w-24 shrink-0 rounded-2xl" />
            <div className="min-w-0">
              <p className="text-xs text-slate-400">{product.category} · {product.campus}</p>
              <h2 className="mt-1 line-clamp-2 font-bold text-slate-800">{product.title}</h2>
              <p className="mt-2 text-lg font-extrabold text-brand-600">{formatPrice(order.price)}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">{counterpart?.nickname?.slice(0, 1) ?? "同"}</div>
            <div><p className="text-sm font-semibold text-slate-800">{isBuyer ? "卖家" : "买家"} · {counterpart?.nickname ?? "校园同学"}</p><p className="text-xs text-slate-400">{counterpart?.campus ?? product.campus}</p></div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card">
          <h2 className="font-extrabold text-slate-800">面交信息</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <p className="flex gap-2"><LocationOnOutlinedIcon fontSize="small" className="text-brand-600" />{point?.campus ?? product.campus} · {point?.name ?? order.meetingPointId ?? "待确认"}</p>
            <p>面交时间：{order.meetingAtIso ? formatDateTime(Date.parse(order.meetingAtIso)) : "待确认"}</p>
            <p>联系方式：{order.contact || "未填写"}</p>
          </div>
          {isBuyer && ["PENDING_MEETING", "BUYER_CONFIRMED"].includes(status) && (
            <Alert severity="warning" icon={<LockOutlinedIcon />} sx={{ mt: 4, borderRadius: 3 }}>
              <strong>确认码：{order.confirmationCode ?? "******"}</strong>
              <br />面交验货、付款完成后，再告知卖家。
            </Alert>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card md:p-6">
        <h2 className="font-extrabold text-slate-800">下一步</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {status === "PENDING_SELLER_CONFIRM" && !isBuyer && <Button variant="contained" disabled={busy} onClick={() => change("PENDING_MEETING")}>接受预约</Button>}
          {status === "PENDING_SELLER_CONFIRM" && isBuyer && <Button variant="outlined" disabled={busy} onClick={openConversation}>催一下卖家</Button>}
          {status === "PENDING_MEETING" && isBuyer && <Button variant="contained" disabled={busy} onClick={() => change("BUYER_CONFIRMED")}>已验货付款，确认面交</Button>}
          {status === "PENDING_MEETING" && !isBuyer && <span className="text-sm text-slate-500">请按约定时间到达面交点，等待买家确认。</span>}
          {status === "BUYER_CONFIRMED" && !isBuyer && <>
            <TextField size="small" label="六位确认码" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            <Button variant="contained" disabled={busy || !/^\d{6}$/.test(code)} onClick={() => change("COMPLETED", code)}>核验并完成交易</Button>
          </>}
          {status === "BUYER_CONFIRMED" && isBuyer && <span className="text-sm text-slate-500">已通知卖家核验，请不要离开面交现场。</span>}
          {status === "COMPLETED" && !myReview && <Button variant="contained" disabled={busy} onClick={() => setReviewOpen(true)}>评价{isBuyer ? "卖家" : "买家"}</Button>}
          {status === "COMPLETED" && myReview && <span className="text-sm text-slate-500">感谢你的评价，继续去逛逛吧。</span>}
          {["PENDING_SELLER_CONFIRM", "PENDING_MEETING"].includes(status) && <Button color="inherit" disabled={busy} onClick={() => change("CANCELLED")}>取消预约</Button>}
          {["CANCELLED", "EXPIRED"].includes(status) && <Button variant="contained" onClick={() => navigate(`/product/${product.id}`)}>重新预约</Button>}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <Button variant="text" startIcon={<ChatBubbleOutlineIcon />} onClick={openConversation}>打开和对方的会话</Button>
          <Button variant="text" startIcon={<CheckCircleOutlineIcon />} onClick={() => navigate(`/product/${product.id}`)}>查看商品</Button>
        </div>
      </section>

      <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} onSubmit={submitReview} />
    </div>
  );
}
