import { useEffect, useState } from 'react';
import { getApiClient } from '../../api/client';
import type { PublicTradeSummary } from '../../api/contracts';

/**
 * 公共交易履历：只有后端白名单投影给出的聚合事实。
 * 没有交易对象、商品列表、订单时间或宿舍楼；评价不足 3 条时不显示平均分，也不计算任何「信用分」。
 */
export default function PublicTradeSummaryCard({ userId }: { userId: string | undefined }) {
  const [summary, setSummary] = useState<PublicTradeSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setSummary(null);
    setFailed(false);
    getApiClient()
      .getPublicTradeSummary(userId)
      .then((s) => { if (active) setSummary(s) })
      .catch(() => { if (active) setFailed(true) });
    return () => { active = false };
  }, [userId]);

  if (!userId || failed) return null;   // 履历只是补充信息，读取失败不影响浏览
  const joined = summary ? new Date(summary.joinedAt) : null;
  return (
    <section aria-labelledby="public-trade-summary-title" className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
      <h3 id="public-trade-summary-title" className="text-xs font-bold text-slate-700">交易履历</h3>
      {!summary ? (
        <p className="text-xs text-slate-600">读取中…</p>
      ) : (
        <dl className="mt-1 grid grid-cols-3 gap-2 text-center text-xs text-slate-700">
          <div>
            <dt>完成交易</dt>
            <dd className="text-sm font-bold text-slate-800">{summary.completedCount} 次</dd>
          </div>
          <div>
            <dt>公开评价</dt>
            <dd className="text-sm font-bold text-slate-800">
              {summary.reviewCount} 条
              <span className="block text-xs font-normal text-slate-600">
                {summary.averageRating !== null ? `平均 ${summary.averageRating.toFixed(1)} 星` : '不足 3 条，暂不显示平均'}
              </span>
            </dd>
          </div>
          <div>
            <dt>加入</dt>
            <dd className="text-sm font-bold text-slate-800">
              {joined ? `${joined.getFullYear()} 年 ${joined.getMonth() + 1} 月` : '—'}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
