import { useEffect, useState } from 'react';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { MyModerationReport } from '../../api/contracts';
import { MY_REPORT_OUTCOME_LABEL, MY_REPORT_STATUS_LABEL, REPORT_REASON_LABEL, TARGET_LABEL } from '../../utils/governance';

/**
 * 我的举报：只有状态摘要（已收到 / 处理中 / 已结束，以及平台是否采取了措施）。
 * 不显示处理细节、工作人员身份或被举报人的处罚。
 */
export default function MyReportsPage() {
  const [items, setItems] = useState<MyModerationReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getApiClient().listMyModerationReports()
      .then((list) => { if (active) setItems(list) })
      .catch((e) => { if (active) { setItems([]); setError(toUserMessage(e)) } });
    return () => { active = false };
  }, []);

  return (
    <section aria-labelledby="my-reports-title" className="space-y-3">
      <h2 id="my-reports-title" className="text-lg font-bold text-slate-800">我的举报</h2>
      <p className="text-sm text-slate-700">为了保护双方，这里只显示处理进度；被举报的人不会知道是谁举报的。</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {items === null ? <p role="status" className="text-sm text-slate-600">正在读取…</p>
        : items.length === 0 ? <p className="text-sm text-slate-600">你还没有提交过举报。</p>
          : (
            <ul className="space-y-2" aria-label="举报记录">
              {items.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-semibold text-slate-800">{TARGET_LABEL[r.targetType]} · {REPORT_REASON_LABEL[r.reasonCode]}</p>
                  <p className="text-slate-700">
                    状态：{MY_REPORT_STATUS_LABEL[r.status]}
                    {r.outcome ? `（${MY_REPORT_OUTCOME_LABEL[r.outcome]}）` : ''}
                  </p>
                  {r.awaitingEligibleStaff && (
                    <p className="text-xs text-amber-900" role="note">
                      本校暂时没有可以回避利益冲突的工作人员，这份举报保持待处理，不会被自动驳回；有合适的工作人员后会继续处理。
                    </p>
                  )}
                  <p className="text-xs text-slate-600">提交于 {new Date(r.createdAt).toLocaleString('zh-CN')}</p>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}
