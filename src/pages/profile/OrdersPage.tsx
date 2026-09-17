import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Divider from '@mui/material/Divider';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import EmptyState from '../../components/EmptyState';
import ImageWithFallback from '../../components/ImageWithFallback';
import RatingStars from '../../components/RatingStars';
import ReviewDialog from '../../components/ReviewDialog';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';
import { useNotify } from '../../context/NotificationContext';
import { CATEGORY_EMOJI, CATEGORY_GRADIENT, ORDER_STATUS_COLOR } from '../../utils/constants';
import { formatDateTime, formatPrice } from '../../utils/format';
import type { Order, OrderStatus } from '../../types';

interface ReviewTarget {
  orderId: string;
}

/** 我的订单：我买到的 / 我卖出的，含状态流转与互评 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const { currentUser, getUser } = useAuth();
  const { getBuyOrders, getSellOrders, updateOrderStatus, addReview, getProduct } =
    useMarket();
  const { success, info } = useNotify();

  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);

  if (!currentUser) {
    return null;
  }

  const buyOrders = getBuyOrders(currentUser.id);
  const sellOrders = getSellOrders(currentUser.id);
  const orders = tab === 'buy' ? buyOrders : sellOrders;

  const handleStatus = (order: Order, status: OrderStatus, message: string) => {
    updateOrderStatus(order.id, status);
    success(message);
  };

  const handleReviewSubmit = (rating: number, comment: string) => {
    if (!reviewTarget) return;
    addReview(reviewTarget.orderId, currentUser.id, {
      rating,
      comment: comment || '交易顺利，好评！',
      createdAt: Date.now(),
    });
    setReviewTarget(null);
    success('评价已提交，感谢你的反馈');
  };

  const renderActions = (order: Order) => {
    const isBuyer = order.buyerId === currentUser.id;
    const myReview = isBuyer ? order.buyerReview : order.sellerReview;
    const buttons: ReactNode[] = [];

    if (order.status === '待确认') {
      if (isBuyer) {
        buttons.push(
          <Button
            key="cancel"
            size="small"
            color="inherit"
            variant="outlined"
            onClick={() => handleStatus(order, '已取消', '订单已取消')}
          >
            取消订单
          </Button>,
        );
      } else {
        buttons.push(
          <Button
            key="confirm"
            size="small"
            variant="contained"
            onClick={() => handleStatus(order, '交易中', '已确认，交易进行中')}
          >
            确认交易
          </Button>,
          <Button
            key="cancel"
            size="small"
            color="inherit"
            variant="outlined"
            onClick={() => handleStatus(order, '已取消', '订单已取消')}
          >
            拒绝 / 取消
          </Button>,
        );
      }
    }

    if (order.status === '交易中') {
      buttons.push(
        <Button
          key="finish"
          size="small"
          variant="contained"
          color="success"
          onClick={() => handleStatus(order, '已完成', '交易已完成，记得互相评价哦')}
        >
          {isBuyer ? '确认收货' : '完成交易'}
        </Button>,
        <Button
          key="cancel"
          size="small"
          color="inherit"
          variant="outlined"
          onClick={() => handleStatus(order, '已取消', '订单已取消')}
        >
          取消订单
        </Button>,
      );
    }

    if (order.status === '已完成') {
      if (!myReview) {
        buttons.push(
          <Button
            key="review"
            size="small"
            variant="contained"
            onClick={() => setReviewTarget({ orderId: order.id })}
          >
            {isBuyer ? '评价卖家' : '评价买家'}
          </Button>,
        );
      } else {
        buttons.push(
          <Button key="reviewed" size="small" disabled>
            已评价
          </Button>,
        );
      }
    }

    return buttons;
  };

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={tab}
        onChange={(_e, value) => setTab(value as 'buy' | 'sell')}
        sx={{ minHeight: 42 }}
      >
        <Tab value="buy" label={`我买到的 (${buyOrders.length})`} sx={{ minHeight: 42, fontWeight: 600 }} />
        <Tab value="sell" label={`我卖出的 (${sellOrders.length})`} sx={{ minHeight: 42, fontWeight: 600 }} />
      </Tabs>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ReceiptLongOutlinedIcon sx={{ fontSize: 34 }} />}
          title={tab === 'buy' ? '还没有购买记录' : '还没有卖出记录'}
          description={
            tab === 'buy'
              ? '在商品详情页点击「我想要」即可下单，下单记录会显示在这里。'
              : '发布商品后，买家下单就会出现在这里，记得及时确认交易哦～'
          }
          action={
            <Button variant="contained" onClick={() => navigate('/')}>
              去逛逛
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const product = getProduct(order.productId);
            const isBuyer = order.buyerId === currentUser.id;
            const counterpart = getUser(isBuyer ? order.sellerId : order.buyerId);
            return (
              <div
                key={order.id}
                className="rounded-2xl border border-slate-100 bg-white p-3 shadow-card md:p-4"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <span className="text-xs text-slate-400">
                    订单号 {order.id.slice(-8).toUpperCase()} ·{' '}
                    {formatDateTime(order.createdAt)}
                  </span>
                  <Chip
                    size="small"
                    label={order.status}
                    color={ORDER_STATUS_COLOR[order.status]}
                  />
                </div>

                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      product ? navigate(`/product/${product.id}`) : undefined
                    }
                    className="shrink-0"
                    aria-label="查看商品"
                  >
                    <ImageWithFallback
                      src={product?.images[0]}
                      alt={product?.title ?? '商品'}
                      emoji={product ? CATEGORY_EMOJI[product.category] : '📦'}
                      gradient={
                        product
                          ? CATEGORY_GRADIENT[product.category]
                          : 'linear-gradient(135deg,#e2e8f0,#cbd5e1)'
                      }
                      className="h-20 w-20 rounded-xl"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-800">
                      {product?.title ?? '商品已删除'}
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-brand-600">
                      {formatPrice(order.price)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
                      <Avatar
                        src={counterpart?.avatar}
                        sx={{ width: 20, height: 20 }}
                      >
                        {counterpart?.nickname?.slice(0, 1)}
                      </Avatar>
                      <span>
                        {isBuyer ? '卖家' : '买家'}：{counterpart?.nickname ?? '用户'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 评价展示 */}
                {(order.buyerReview || order.sellerReview) && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <div className="flex flex-col gap-2 text-xs">
                      {order.buyerReview && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-600">
                              买家评价
                            </span>
                            <RatingStars value={order.buyerReview.rating} />
                          </div>
                          <p className="mt-1 text-slate-500">
                            {order.buyerReview.comment}
                          </p>
                        </div>
                      )}
                      {order.sellerReview && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-600">
                              卖家评价
                            </span>
                            <RatingStars value={order.sellerReview.rating} />
                          </div>
                          <p className="mt-1 text-slate-500">
                            {order.sellerReview.comment}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {renderActions(order)}
                  {order.status === '已完成' && (
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => info('如需帮助，可在商品详情页联系对方')}
                    >
                      联系对方
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReviewDialog
        open={Boolean(reviewTarget)}
        title={tab === 'buy' ? '评价卖家' : '评价买家'}
        onClose={() => setReviewTarget(null)}
        onSubmit={handleReviewSubmit}
      />
    </div>
  );
}
