import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { OwnTradeHistory } from '../../api/contracts';
import { formatDateTime } from '../../utils/format';
import { orderStatusLabel } from '../../utils/trustedFlow';

/**
 * 本人交易履历：可解释的计数 + 最近订单入口。只有本人可见。
 * 不计算任何「信用分」；公开页只展示聚合数字（见 PublicTradeSummaryCard）。
 */
export default function TradeHistoryPage() {
  const [history, setHistory] = useState<OwnTradeHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getApiClient()
      .getOwnTradeHistory()
      .then((h) => { if (active) setHistory(h) })
      .catch((e) => { if (active) setError(toUserMessage(e)) });
    return () => { active = false };
  }, []);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!history) return <p className="text-sm text-slate-600" role="status">正在读取交易履历…</p>;

  const counts: Array<[string, number]> = [
    ['已完成', history.completed],
    ['作为买家完成', history.completedAsBuyer],
    ['作为卖家完成', history.completedAsSeller],
    ['进行中', history.active],
    ['已取消', history.cancelled],
    ['已超时', history.expired],
    ['验货不一致', history.disputed],
  ];
  return (
    <div className="space-y-4">
      <section aria-labelledby="own-history-title" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
        <h2 id="own-history-title" className="text-base font-bold text-slate-800">我的交易履历</h2>
        <p className="text-xs text-slate-600">
          只统计真实发生的订单事实，不计算信用分。其他同学在商品页只能看到你的完成次数、加入时间和评价汇总。
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3 text-center">
              <dt className="text-xs text-slate-600">{label}</dt>
              <dd className="text-lg font-bold text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="recent-orders-title" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
        <h2 id="recent-orders-title" className="text-base font-bold text-slate-800">最近的订单</h2>
        {history.recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">还没有订单。</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {history.recent.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-semibold text-slate-800">{o.productTitle || '商品'}</span>
                  <span className="ml-2 text-xs text-slate-600">
                    {o.role === 'BUYER' ? '我买' : '我卖'} · {orderStatusLabel(o.status)} · {formatDateTime(o.updatedAt)}
                  </span>
                </span>
                <Link className="text-brand-700 underline" to={`/orders/${encodeURIComponent(o.orderId)}`}>
                  查看进展
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
