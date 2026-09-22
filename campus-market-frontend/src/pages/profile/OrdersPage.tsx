import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Chip, Tabs, Tab, TextField } from "@mui/material";
import { useAuth } from "../../context/AuthContext";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import ReviewDialog from "../../components/ReviewDialog";
import { formatDateTime, formatPrice } from "../../utils/format";
import type { CanonicalOrderStatus, Order } from "../../types";
const labels: Record<string, string> = {
  PENDING_SELLER_CONFIRM: "待卖家确认",
  PENDING_MEETING: "待面交",
  BUYER_CONFIRMED: "买家已确认，待卖家核验",
  SELLER_CONFIRMED: "卖家已确认",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "已超时",
  DISPUTED: "申诉中",
};
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
    [codes, setCodes] = useState<Record<string, string>>({});
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
      error((e as Error).message);
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
          status =
            o.canonicalStatus ??
            {
              待确认: "PENDING_SELLER_CONFIRM",
              交易中: "PENDING_MEETING",
              已完成: "COMPLETED",
              已取消: "CANCELLED",
            }[o.status],
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
                label={labels[status]}
                color={status === "COMPLETED" ? "success" : "default"}
              />
            </div>
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
                <p>面交时间：{formatDateTime(Date.parse(o.meetingAtIso))}</p>
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
            {buyer &&
              ["PENDING_MEETING", "BUYER_CONFIRMED"].includes(status) && (
                <Alert severity="warning">
                  交易确认码：<strong>{o.confirmationCode}</strong>
                  。仅在面交验货、付款完成后告知卖家。
                </Alert>
              )}
            <div className="flex flex-wrap items-center gap-2">
              {!buyer && status === "PENDING_SELLER_CONFIRM" && (
                <Button
                  disabled={busy}
                  variant="contained"
                  onClick={() => change(o, "PENDING_MEETING")}
                >
                  接受预约
                </Button>
              )}
              {buyer && status === "PENDING_MEETING" && (
                <Button
                  disabled={busy}
                  variant="contained"
                  onClick={() => change(o, "BUYER_CONFIRMED")}
                >
                  已验货付款，确认面交
                </Button>
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
              {["PENDING_SELLER_CONFIRM", "PENDING_MEETING"].includes(
                status,
              ) && (
                <Button
                  disabled={busy}
                  color="inherit"
                  onClick={() => change(o, "CANCELLED")}
                >
                  取消预约
                </Button>
              )}
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
            error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
