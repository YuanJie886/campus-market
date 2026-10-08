import Button from '@mui/material/Button';
import type { OrderFlow, PresenceState } from '../../api/contracts';
import { formatRelativeTime } from '../../utils/format';
import { PRESENCE_NOTE, presenceLabel } from '../../utils/trustedFlow';

/** 允许同步到达状态的订单状态，与服务端 PRESENCE_ALLOWED 一致 */
const PRESENCE_ALLOWED = ['PENDING_MEETING', 'BUYER_CONFIRMED'];

function describe(state: PresenceState): string {
  const at = state.arrivedAtIso ?? state.departedAtIso;
  const when = at ? `（${formatRelativeTime(Date.parse(at))}）` : '';
  return `${presenceLabel(state.status)}${when}`;
}

interface Props {
  flow: OrderFlow;
  busy: boolean;
  onAction: (action: 'DEPART' | 'ARRIVE') => void;
}

/**
 * 「我已出发 / 我已到达」。只能改自己的状态；时间由服务端记录。
 * 到达不会完成订单、不会提交验货、也不会显示任何联系方式。
 */
export default function PresencePanel({ flow, busy, onAction }: Props) {
  const allowed = PRESENCE_ALLOWED.includes(flow.status);
  const me = flow.presence.me;
  const counterpartLabel = flow.role === 'BUYER' ? '卖家' : '买家';
  return (
    <section aria-labelledby="presence-title" className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <h2 id="presence-title" className="text-base font-bold text-slate-800">出发与到达</h2>
      <p id="presence-note" className="text-xs text-slate-600">{PRESENCE_NOTE}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">我</dt>
          <dd className="font-semibold text-slate-800" data-presence="me" data-status={me.status}>{describe(me)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">{counterpartLabel}</dt>
          <dd className="font-semibold text-slate-800" data-presence="counterpart" data-status={flow.presence.counterpart.status}>
            {describe(flow.presence.counterpart)}
          </dd>
        </div>
      </dl>
      {allowed ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outlined"
            disabled={busy || me.status !== 'NOT_STARTED'}
            aria-describedby="presence-note"
            onClick={() => onAction('DEPART')}
          >
            我已出发
          </Button>
          <Button
            variant="contained"
            disabled={busy || me.status === 'ARRIVED'}
            aria-describedby="presence-note"
            onClick={() => onAction('ARRIVE')}
          >
            我已到达
          </Button>
        </div>
      ) : (
        <p className="text-xs text-slate-600">卖家接单后、订单结束前才能同步到达状态。</p>
      )}
      {flow.presence.revision > 0 && (
        <p className="text-xs text-slate-600">当前为第 {flow.presence.revision} 次确认的档期；改约后到达状态会重新开始。</p>
      )}
    </section>
  );
}
