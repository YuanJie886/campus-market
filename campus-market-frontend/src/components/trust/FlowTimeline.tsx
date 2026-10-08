import type { OrderFlow } from '../../api/contracts';
import { formatDateTime } from '../../utils/format';
import { actorLabel, eventLabel } from '../../utils/trustedFlow';

/** 订单时间线：服务端给出稳定排序的机器码，这里只做中文映射。 */
export default function FlowTimeline({ flow }: { flow: OrderFlow }) {
  return (
    <section aria-labelledby="timeline-title" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <h2 id="timeline-title" className="mb-2 text-base font-bold text-slate-800">订单进展</h2>
      {flow.timeline.length === 0 ? (
        <p className="text-sm text-slate-600">暂无记录。</p>
      ) : (
        <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
          {flow.timeline.map((event, index) => (
            <li key={`${event.code}-${event.atIso}-${index}`} data-code={event.code} className="text-sm">
              <span className="font-semibold text-slate-800">{eventLabel(event.code)}</span>
              <span className="ml-2 text-xs text-slate-600">
                {actorLabel(event.actor, flow.role)} ·{' '}
                <time dateTime={event.atIso}>{formatDateTime(Date.parse(event.atIso))}</time>
                {event.meetingRevision ? ` · 第 ${event.meetingRevision} 次约定` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
