import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Chip, Tabs, Tab, TextField } from "@mui/material";
import { useAuth } from "../../context/AuthContext";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import ReviewDialog from "../../components/ReviewDialog";
import CancelOrderDialog from "../../components/governance/CancelOrderDialog";
import { formatDateTime, formatPrice } from "../../utils/format";
import type { CanonicalOrderStatus, Order } from "../../types";
import { toUserMessage } from '../../api/errors';
import { formatSlotRange } from '../../utils/governance';
import {
  MISMATCH_NOTE,
  blockedReasonLabel,
  inspectionStatusLabel,
  meetingStatusLabel,
  orderStatusLabel,
  presenceLabel,
} from "../../utils/trustedFlow";
export default function OrdersPage() {
  const { currentUser, getUser } = useAuth();
  const {
    getBuyOrders,
    getSellOrders,
    getProduct,
    updateOrderStatus,
    addReview,
    meetingPoints,
  } = useMarket();
  const { success, error } = useNotify();
  const [tab, setTab] = useState("buy"),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<string | null>(null),
    [codes, setCodes] = useState<Record<string, string>>({}),
    [cancelling, setCancelling] = useState<Order | null>(null),
    [cancelError, setCancelError] = useState<string | null>(null);
  if (!currentUser) return null;
  const orders =
    tab === "buy"
      ? getBuyOrders(currentUser.id)
      : getSellOrders(currentUser.id);
  const change = async (o: Order, to: CanonicalOrderStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateOrderStatus(o.id, to, codes[o.id]);
      success(to === "COMPLETED" ? "双方已确认，交易完成" : "订单已更新");
    } catch (e) {
      error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmCancel = async (input: { reasonCode?: import("../../api/contracts").CancellationReason; note?: string }) => {
    if (!cancelling || busy) return;
    setBusy(true);
    setCancelError(null);
    try {
      await updateOrderStatus(cancelling.id, "CANCELLED", undefined, input);
      setCancelling(null);
      success("订单已取消");
    } catch (e) {
      setCancelError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Alert severity="info">
        线上预约，线下面交付款。平台不代收商品款；验货并完成付款后，再确认交易。
      </Alert>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab value="buy" label="我买到的" />
        <Tab value="sell" label="我卖出的" />
      </Tabs>
      {!orders.length && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-500">
          暂无预约记录
        </p>
      )}
      {orders.map((o) => {
        const buyer = o.buyerId === currentUser.id,
          p = getProduct(o.productId),
          // canonical status 是唯一真值。旧数据在装载时已由 Mock 迁移固化（0.9E），
          // 这里不再从中文文案反推——「交易中」对应 4 个 canonical 值，反推必然出错。
          status = o.canonicalStatus ?? "PENDING_SELLER_CONFIRM",
          myReview = buyer ? o.buyerReview : o.sellerReview;
        return (
          <article
            key={o.id}
            className="space-y-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                订单 {o.id.slice(-8)} · {formatDateTime(o.createdAt)}
              </span>
              <Chip
                size="small"
                label={orderStatusLabel(status)}
                color={status === "COMPLETED" ? "success" : "default"}
              />
            </div>
            {o.legacyStatusAmbiguous && (
              <Alert severity="info" sx={{ py: 0 }}>
                该订单的状态由旧版数据推断而来。旧版只记录「交易中」，无法区分是待面交还是买家已确认，
                这里按最保守的「待面交」显示，请与对方核对后再操作。
              </Alert>
            )}
            <Link
              to={`/product/${o.productId}`}
              className="font-bold text-slate-800"
            >
              {p?.title ?? "商品"}
            </Link>
            <p className="text-xl font-bold text-brand-600">
              {formatPrice(o.price)}
            </p>
            <p className="text-sm text-slate-500">
              {buyer ? "卖家" : "买家"}：
              {getUser(buyer ? o.sellerId : o.buyerId)?.nickname ?? "同学"}
            </p>
            {o.meetingAtIso && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm leading-7">
                <p>
                  面交地点：
                  {meetingPoints.find((x) => x.id === o.meetingPointId)?.name ??
                    o.meetingPointId}{" "}
                  · {p?.campus}
                </p>
                <p>
                  面交时间：
                  {o.meetingEndsAtIso
                    ? formatSlotRange(Date.parse(o.meetingAtIso), Date.parse(o.meetingEndsAtIso))
                    : `${formatDateTime(Date.parse(o.meetingAtIso))}（原始预约没有明确的结束时间）`}
                </p>
                <p>买家联系方式：{o.contact}</p>
                {o.expiresAtIso &&
                  ["PENDING_SELLER_CONFIRM", "PENDING_MEETING"].includes(
                    status,
                  ) && (
                    <p>
                      预约有效至：{formatDateTime(Date.parse(o.expiresAtIso))}
                    </p>
                  )}
              </div>
            )}
            {status === "DISPUTED" && (
              <Alert severity="warning" role="note" sx={{ py: 0 }}>
                验货不一致：不能确认面交或核销。可以取消交易（商品恢复在售）、查看验货记录，或等待订单到期。
                {MISMATCH_NOTE}
              </Alert>
            )}
            {/* 流程摘要全部来自服务端（订单列表同一次请求返回），前端不复制确认条件 */}
            {o.flow && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(status) && (
              <p className="text-xs text-slate-600" data-flow-summary>
                {meetingStatusLabel(o.flow.currentMeetingStatus)}
                {o.flow.inspectionRequired && ` · 验货：${inspectionStatusLabel(o.flow.inspectionStatus)}`}
                {o.flow.currentMeetingStatus !== "AWAITING_SELLER" &&
                  ` · 我：${presenceLabel(o.flow.myPresenceStatus)} · 对方：${presenceLabel(o.flow.counterpartyPresenceStatus)}`}
              </p>
            )}
            {buyer &&
              ["PENDING_MEETING", "BUYER_CONFIRMED"].includes(status) && (
                <Alert severity="warning">
                  交易确认码：<strong>{o.confirmationCode}</strong>
                  。仅在面交验货、付款完成后告知卖家。
                </Alert>
              )}
            <div className="flex flex-wrap items-center gap-2">
              {!buyer && status === "PENDING_SELLER_CONFIRM" && (
                <>
                  {o.meetingEndsAtIso && o.meetingAtIso && (
                    <p id={`accept-slot-${o.id}`} className="w-full text-sm text-slate-700">
                      接受即确认完整时段：{formatSlotRange(Date.parse(o.meetingAtIso), Date.parse(o.meetingEndsAtIso))}。之后改时间需要双方通过改约确认。
                    </p>
                  )}
                  <Button
                    disabled={busy}
                    variant="contained"
                    aria-describedby={o.meetingEndsAtIso ? `accept-slot-${o.id}` : undefined}
                    onClick={() => change(o, "PENDING_MEETING")}
                  >
                    接受预约
                  </Button>
                </>
              )}
              {buyer && status === "PENDING_MEETING" && (
                <>
                  <Button
                    // 可操作性由服务端计算；缺少摘要时保守禁用（后端 409 仍是最终防线）
                    disabled={busy || o.flow?.buyerConfirmAllowed !== true}
                    variant="contained"
                    aria-describedby={o.flow?.buyerConfirmAllowed ? undefined : `confirm-block-${o.id}`}
                    onClick={() => change(o, "BUYER_CONFIRMED")}
                  >
                    已验货付款，确认面交
                  </Button>
                  {o.flow?.buyerConfirmAllowed !== true && (
                    <span id={`confirm-block-${o.id}`} className="text-xs text-slate-700" data-block-reason={o.flow?.buyerConfirmBlockReason ?? ""}>
                      {blockedReasonLabel(o.flow?.buyerConfirmBlockReason) ?? "正在读取订单状态…"}
                    </span>
                  )}
                </>
              )}
              {!buyer && status === "BUYER_CONFIRMED" && (
                <>
                  <TextField
                    size="small"
                    label="买家提供的六位确认码"
                    value={codes[o.id] ?? ""}
                    onChange={(e) =>
                      setCodes({
                        ...codes,
                        [o.id]: e.target.value.replace(/\D/g, "").slice(0, 6),
                      })
                    }
                  />
                  <Button
                    disabled={busy || !/^\d{6}$/.test(codes[o.id] ?? "")}
                    variant="contained"
                    onClick={() => change(o, "COMPLETED")}
                  >
                    核验并完成交易
                  </Button>
                </>
              )}
              {["PENDING_SELLER_CONFIRM", "PENDING_MEETING", "DISPUTED"].includes(
                status,
              ) && (
                <Button
                  disabled={busy}
                  color="inherit"
                  onClick={() => { setCancelError(null); setCancelling(o) }}
                >
                  {status === "DISPUTED" ? "取消交易" : "取消预约"}
                </Button>
              )}
              <Button component={Link} to={`/orders/${encodeURIComponent(o.id)}`} size="small">
                面交与验货
              </Button>
              {status === "COMPLETED" && !myReview && (
                <Button onClick={() => setReview(o.id)}>
                  评价{buyer ? "卖家" : "买家"}
                </Button>
              )}
            </div>
            {o.buyerReview && (
              <p className="text-sm">
                买家评价 · {o.buyerReview.rating} 星 · {o.buyerReview.comment}
              </p>
            )}
            {o.sellerReview && (
              <p className="text-sm">
                卖家评价 · {o.sellerReview.rating} 星 · {o.sellerReview.comment}
              </p>
            )}
          </article>
        );
      })}
      <CancelOrderDialog
        open={!!cancelling}
        status={(cancelling?.canonicalStatus ?? "PENDING_SELLER_CONFIRM") as CanonicalOrderStatus}
        busy={busy}
        error={cancelError}
        onCancel={() => setCancelling(null)}
        onConfirm={(input) => void confirmCancel(input)}
      />
      <ReviewDialog
        open={!!review}
        onClose={() => setReview(null)}
        onSubmit={async (rating, comment) => {
          if (!review || busy) return;
          setBusy(true);
          try {
            await addReview(review, currentUser.id, {
              rating,
              comment: comment || "交易顺利",
              createdAt: Date.now(),
            });
            setReview(null);
            success("评价已提交");
          } catch (e) {
            error(toUserMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
