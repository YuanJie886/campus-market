import type { ProductDisclosure } from '../../api/contracts';
import { conditionLabel } from '../../utils/trustedFlow';

/**
 * 商品页上的卖家当前声明。这是卖家本人的陈述，不代表平台鉴定或担保；
 * 卖家编辑商品时可以更新声明，商品页始终展示当前版本。
 */
export default function SellerDeclarationCard({ disclosure }: { disclosure: ProductDisclosure | null | undefined }) {
  if (disclosure === undefined) return null;   // 尚未读到详情，不猜
  return (
    <section
      aria-labelledby="seller-declaration-title"
      className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-5"
    >
      <h2 id="seller-declaration-title" className="mb-2 text-sm font-bold text-slate-700">
        卖家验货声明
      </h2>
      {disclosure === null ? (
        <p className="text-sm text-slate-600">
          该商品未提供结构化验货声明（该分类暂无清单，或商品发布于清单上线之前）。面交时请当面仔细确认。
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-600">
            {disclosure.title} · 第 {disclosure.version} 版。以下为卖家本人声明，不代表平台鉴定或担保。
          </p>
          <dl className="divide-y divide-slate-100 text-sm">
            {disclosure.items.map((item) => (
              <div key={item.code} className="flex flex-wrap justify-between gap-2 py-2" data-item-code={item.code}>
                <dt className="text-slate-700">{item.label}</dt>
                <dd className="text-right">
                  <span className={item.condition === 'DEFECT' ? 'font-semibold text-amber-800' : 'text-slate-800'}>
                    {conditionLabel(item.condition)}
                  </span>
                  {item.note && <span className="block text-xs text-slate-600">{item.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
