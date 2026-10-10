import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import TextField from "@mui/material/TextField";
import EmptyState from "../components/EmptyState";
import ImageWithFallback from "../components/ImageWithFallback";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { useNotify } from "../context/NotificationContext";
import { CATEGORY_EMOJI, CATEGORY_GRADIENT } from "../utils/constants";
import { formatPrice } from "../utils/format";

function localDateTime(hoursFromNow = 2) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function CheckoutPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { currentUser, getUser } = useAuth();
  const {
    getProduct,
    loadProduct,
    loading,
    meetingPoints,
    createOrder,
  } = useMarket();
  const { error } = useNotify();
  const product = productId ? getProduct(productId) : undefined;
  const seller = getUser(product?.sellerId);
  const campusPoints = useMemo(
    () => meetingPoints.filter((point) => point.campus === product?.campus),
    [meetingPoints, product?.campus],
  );
  const [meetingPointId, setMeetingPointId] = useState("");
  const [meetingAt, setMeetingAt] = useState(localDateTime());
  const [contact, setContact] = useState(currentUser?.contact ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (productId && !product) void loadProduct(productId).catch((e) => error(e.message));
  }, [error, loadProduct, product, productId]);

  useEffect(() => {
    if (!meetingPointId && campusPoints[0]) setMeetingPointId(campusPoints[0].id);
  }, [campusPoints, meetingPointId]);

  useEffect(() => {
    if (currentUser?.contact && !contact) setContact(currentUser.contact);
  }, [contact, currentUser?.contact]);

  if (!product && loading) return <p className="p-8 text-slate-500">正在准备预约信息…</p>;
  if (!product || !currentUser) {
    return (
      <EmptyState
        title="商品不存在或已被删除"
        description="这件商品可能已经被下架，去集市看看其他好物吧。"
        action={<Button variant="contained" onClick={() => navigate("/")}>返回集市</Button>}
      />
    );
  }

  const submit = async () => {
    if (busy) return;
    if (!meetingPointId || !meetingAt || !contact.trim()) {
      error("请补全面交地点、时间和联系方式");
      return;
    }
    if (new Date(meetingAt).getTime() <= Date.now() + 60_000) {
      error("面交时间至少需要提前一分钟");
      return;
    }
    setBusy(true);
    try {
      const order = await createOrder(product.id, currentUser.id, {
        meetingPointId,
        meetingAtIso: new Date(meetingAt).toISOString(),
        contact: contact.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      navigate(`/checkout/${product.id}/success`, {
        state: { orderId: order.id, conversationId: order.conversationId },
      });
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <button type="button" className="text-sm text-slate-500 hover:text-brand-600" onClick={() => navigate(-1)}>
          ← 返回商品详情
        </button>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">确认预约</h1>
        <p className="mt-1 text-sm text-slate-500">下单前确认商品、金额和面交条件，预约提交后等待卖家确认。</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-card md:p-6">
          <div className="flex gap-4 rounded-2xl bg-slate-50 p-3">
            <ImageWithFallback
              src={product.images[0]}
              alt={product.title}
              emoji={CATEGORY_EMOJI[product.category]}
              gradient={CATEGORY_GRADIENT[product.category]}
              className="h-24 w-24 shrink-0 rounded-2xl"
            />
            <div className="min-w-0 py-1">
              <p className="text-xs text-slate-400">{product.category} · {product.campus}</p>
              <h2 className="mt-1 line-clamp-2 font-bold text-slate-800">{product.title}</h2>
              <p className="mt-2 text-xl font-extrabold text-brand-600">{formatPrice(product.price)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <Avatar src={seller?.avatar} sx={{ width: 42, height: 42 }}>{seller?.nickname?.slice(0, 1) ?? "卖"}</Avatar>
              <div>
                <p className="font-bold text-slate-800">{seller?.nickname ?? "校园同学"}</p>
                <p className="text-xs text-slate-500">{seller?.campus ?? product.campus} · 校园实名用户</p>
              </div>
              <span className="ml-auto rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">已认证</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
              <span><strong className="block text-base text-slate-800">—</strong>已完成交易</span>
              <span><strong className="block text-base text-slate-800">—</strong>好评率</span>
              <span><strong className="block text-base text-slate-800">校内</strong>交易范围</span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 font-bold text-slate-800">
              <LocationOnOutlinedIcon fontSize="small" className="text-brand-600" />
              选择面交点
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {campusPoints.map((point) => (
                <button
                  key={point.id}
                  type="button"
                  onClick={() => setMeetingPointId(point.id)}
                  className={`rounded-2xl border p-3 text-left transition ${meetingPointId === point.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-300"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {meetingPointId === point.id && <CheckCircleOutlineIcon fontSize="small" className="text-brand-600" />}
                    {point.name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{point.campus} · 公共区域</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="面交时间"
              type="datetime-local"
              value={meetingAt}
              onChange={(event) => setMeetingAt(event.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: localDateTime(0.02) }}
              fullWidth
            />
            <TextField
              label="联系方式（仅双方可见）"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="手机号 / 微信号"
              fullWidth
            />
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card md:p-6">
            <h2 className="text-lg font-extrabold text-slate-800">预约前请确认</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <p className="flex gap-2"><EventAvailableOutlinedIcon fontSize="small" className="mt-1 text-brand-600" />预约提交后，卖家会收到通知，通常在 2 小时内回复。</p>
              <p className="flex gap-2"><SecurityOutlinedIcon fontSize="small" className="mt-1 text-brand-600" />平台不代收货款，请在公共场所验货后自行付款。</p>
              <p className="flex gap-2"><CheckCircleOutlineIcon fontSize="small" className="mt-1 text-brand-600" />面交付款完成后，再将六位确认码告知卖家。</p>
            </div>
            <Alert severity="info" sx={{ mt: 3, borderRadius: 3 }}>
              下单即建立与卖家的会话，地点或时间有变化可以直接协商。
            </Alert>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="contained" size="large" onClick={submit} disabled={busy || !campusPoints.length}>
                {busy ? "提交中…" : `确认预约 · ${formatPrice(product.price)}`}
              </Button>
              <Button variant="text" startIcon={<ChatBubbleOutlineIcon />} onClick={() => navigate(`/product/${product.id}`)}>
                先回商品页聊聊
              </Button>
            </div>
          </section>
          <p className="px-2 text-xs leading-5 text-slate-400">提交预约代表你已阅读面交安全提示。请使用校园公共区域交易，不要提前支付定金。</p>
        </aside>
      </div>
    </div>
  );
}
