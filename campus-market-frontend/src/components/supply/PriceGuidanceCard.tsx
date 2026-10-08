import { useEffect, useId, useState } from 'react';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import { PRICE_GUIDANCE_NOTE, type PriceGuidance } from '../../api/contracts';
import { CATEGORIES, CONDITIONS, type Category, type Condition } from '../../types';

interface Props {
  category: string;
  condition?: string;
  textbookEditionId?: string | null;
}

/**
 * 校内历史成交价格参考（5.6）。只展示聚合统计：样本不足时连样本数都不显示。
 * 这不是估价，也不是建议定价——卖家自己决定价格。
 */
export default function PriceGuidanceCard({ category, condition, textbookEditionId }: Props) {
  const [data, setData] = useState<PriceGuidance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const validCategory = (CATEGORIES as string[]).includes(category);
  const validCondition = condition && (CONDITIONS as string[]).includes(condition) ? (condition as Condition) : undefined;

  useEffect(() => {
    if (!validCategory) { setData(null); return }
    let active = true;
    setError(null);
    getApiClient().getPriceGuidance({
      category: category as Category,
      ...(validCondition ? { condition: validCondition } : {}),
      ...(textbookEditionId && category === '教材书籍' ? { textbookEditionId } : {}),
    })
      .then((g) => { if (active) setData(g) })
      .catch((e) => { if (active) { setData(null); setError(toUserMessage(e)) } });
    return () => { active = false };
  }, [category, validCategory, validCondition, textbookEditionId]);

  if (!validCategory) return null;
  return (
    <aside aria-labelledby={headingId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <h4 id={headingId} className="text-xs font-bold text-slate-700">校内历史成交参考</h4>
      <div role="status" aria-live="polite" className="mt-1 text-slate-800">
        {error ? `暂时无法读取参考：${error}`
          : !data ? '正在读取…'
            : data.sufficient
              ? `同类${data.basis.condition ? `、${data.basis.condition}` : ''}商品的成交价中位数约 ¥${data.median}，`
                + `中间一半在 ¥${data.lowerQuartile}～¥${data.upperQuartile} 之间`
                + `（至少 ${data.sampleCount} 笔已完成交易，${data.periodStart}～${data.periodEnd}）。`
              : `校内已完成交易不足 ${data.minimumSample} 笔，暂不提供参考区间。`}
      </div>
      <p className="mt-1 text-xs text-slate-600">{data?.note ?? PRICE_GUIDANCE_NOTE}</p>
    </aside>
  );
}
