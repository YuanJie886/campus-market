import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { InspectionResultInput, MeetingProposalInput, OrderFlow } from '../api/contracts';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import ProposeMeetingDialog from '../components/trust/ProposeMeetingDialog';
import InspectionPanel from '../components/trust/InspectionPanel';
import PresencePanel from '../components/trust/PresencePanel';
import FlowTimeline from '../components/trust/FlowTimeline';
import NoShowPanel from '../components/governance/NoShowPanel';
import { CANCEL_PHASE_LABEL, CANCEL_REASON_LABEL } from '../utils/governance';
import { formatDateTime } from '../utils/format';
import {
  MISMATCH_NOTE, blockedReasonLabel, formatSlot, orderStatusLabel, proposalStatusLabel,
} from '../utils/trustedFlow';


/**
 * 订单的面交与验货页：档期握手、出发/到达、验货凭证、进展时间线。
 * 只有订单双方能打开；页面不显示确认码与联系方式（这些仍只在「我的订单」里给需要的一方）。
 */
export default function OrderFlowPage() {
  const { orderId = '' } = useParams();
  const { meetingPoints, refresh, getProduct, getBuyOrders, getSellOrders } = useMarket();
  const { currentUser } = useAuth();
  const uid = currentUser?.id ?? '';
  const [flow, setFlow] = useState<OrderFlow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setFlow(await getApiClient().getOrderFlow(orderId));
    } catch (e) {
      setLoadError(toUserMessage(e));
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 所有写操作走这里：同一时刻只有一个请求在途，结果以服务端返回的流程视图为准。 */
  const run = async (action: () => Promise<OrderFlow>, success: string, onError?: (message: string) => void) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      setFlow(await action());
      setStatusMessage(success);
      void refresh().catch(() => undefined);   // 同步「我的订单」列表里的状态
      return true;
    } catch (e) {
      const message = toUserMessage(e);
      if (onError) onError(message);
      else setActionError(message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const campus = useMemo(() => {
    if (!flow) return undefined;
    const point = meetingPoints.find((p) => p.id === flow.agreement.meetingPointId);
    if (point) return point.campus;
    const order = [...getBuyOrders(uid), ...getSellOrders(uid)].find((o) => o.id === flow.orderId);
    return order ? getProduct(order.productId)?.campus : undefined;
  }, [flow, meetingPoints, getBuyOrders, getSellOrders, getProduct, uid]);
  const proposablePoints = meetingPoints.filter((p) => p.campus === campus && p.active !== false);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Alert severity="error">{loadError}</Alert>
        <Button component={Link} to="/profile/orders">返回我的订单</Button>
      </div>
    );
  }
  if (!flow) return <p className="mx-auto max-w-3xl text-sm text-slate-600" role="status">正在读取订单…</p>;

  const api = getApiClient();
  const pending = flow.proposals.find((p) => p.status === 'PENDING');
  const history = flow.proposals.filter((p) => p.status !== 'PENDING');
  // 是否能约时间由服务端的 currentMeetingStatus 给出，前端不复制状态集合
  const schedulable = flow.currentMeetingStatus === 'CONFIRMED' || flow.currentMeetingStatus === 'RESCHEDULE_PENDING';
  const blocked = blockedReasonLabel(flow.buyerConfirmBlockReason);

  const submitProposal = async (input: MeetingProposalInput) => {
    setProposeError(null);
    const ok = await run(() => api.proposeMeeting(flow.orderId, input), '已发送档期提议，等待对方回应', setProposeError);
    if (ok) setProposeOpen(false);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">面交与验货</h1>
          <p className="text-xs text-slate-600">我是{flow.role === 'BUYER' ? '买家' : '卖家'} · 平台不代收货款，也不对商品做鉴定或担保</p>
        </div>
        <Chip label={orderStatusLabel(flow.status)} data-status={flow.status} />
      </div>

      {/* 非关键的成功提示用 status，不打断读屏 */}
      <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>
      {statusMessage && <p className="text-sm text-emerald-800" aria-hidden="true">{statusMessage}</p>}
      {actionError && <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>}

      {flow.status === 'DISPUTED' && (
        <Alert severity="warning" role="note">
          验货不一致：不能确认面交或核销。你可以在「我的订单」中取消交易（商品会恢复在售）、在下方查看验货记录，
          或等待订单到期自动关闭。{MISMATCH_NOTE}
        </Alert>
      )}
      {flow.status === 'PENDING_MEETING' && flow.role === 'BUYER' && !flow.buyerConfirmAllowed && blocked && (
        <Alert severity="info" role="note">{blocked}</Alert>
      )}

      <section aria-labelledby="agreement-title" className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
        <h2 id="agreement-title" className="text-base font-bold text-slate-800">面交安排</h2>
        <div className="rounded-xl bg-slate-50 p-3 text-sm" data-agreement-revision={flow.agreement.revision}>
          <p className="text-xs text-slate-600">
            {flow.agreement.revision > 0 ? `当前档期（第 ${flow.agreement.revision} 次确认）` : '下单时预约的档期'}
            {!flow.agreement.confirmed && '，等待卖家接受预约'}
          </p>
          <p className="font-semibold text-slate-800">
            {flow.agreement.meetingPointName ?? '面交点'} · {formatSlot(flow.agreement.startsAtIso, flow.agreement.endsAtIso)}
          </p>
          {pending && <p className="mt-1 text-xs text-slate-700">改约提议待回应期间，上面的档期仍然有效。</p>}
          {flow.agreement.confirmed && flow.agreement.explicitSlot === false && (
            <p className="mt-1 text-xs text-slate-700" role="note" data-legacy-slot>
              这张订单的原始预约没有明确的结束时间：平台不会据此推测爽约。如需一个可以核对的完整时段，可以在下方提出改约，由对方确认。
            </p>
          )}
        </div>

        {pending && (
          <div className="rounded-xl border-2 border-brand-500 p-3" data-proposal-id={pending.id} data-proposal-status={pending.status}>
            <p className="text-xs text-slate-600">
              {pending.mine ? '我' : pending.proposedBy === 'BUYER' ? '买家' : '卖家'}提议 · {proposalStatusLabel(pending.status)}
            </p>
            <p className="font-semibold text-slate-800">{pending.meetingPointName} · {formatSlot(pending.startsAtIso, pending.endsAtIso)}</p>
            {pending.note && <p className="text-xs text-slate-700">备注：{pending.note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {pending.mine ? (
                <Button size="small" color="inherit" disabled={busy}
                  onClick={() => run(() => api.withdrawMeeting(flow.orderId, pending.id), '已撤回提议')}>
                  撤回提议
                </Button>
              ) : (
                <>
                  <Button size="small" variant="contained" disabled={busy}
                    onClick={() => run(() => api.acceptMeeting(flow.orderId, pending.id), '已接受，新档期生效')}>
                    接受
                  </Button>
                  <Button size="small" color="inherit" disabled={busy}
                    onClick={() => run(() => api.rejectMeeting(flow.orderId, pending.id), '已拒绝，原档期不变')}>
                    拒绝
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {schedulable ? (
          <Button variant="outlined" disabled={busy || Boolean(pending)} onClick={() => { setProposeError(null); setProposeOpen(true); }}>
            提议改约
          </Button>
        ) : flow.currentMeetingStatus === 'AWAITING_SELLER' ? (
          // 3.8B：卖家接受之前没有正式档期，不提供提议入口
          <p className="text-xs text-slate-600">卖家接受预约后，双方才能约定或调整正式面交档期。</p>
        ) : (
          <p className="text-xs text-slate-600">当前订单状态不能再约时间。</p>
        )}
        {pending && schedulable && <p className="text-xs text-slate-600">每个订单同一时间只能有一个待回应的提议。</p>}

        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm text-slate-700">档期历史（{history.length}）</summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-700">
              {history.map((p) => (
                <li key={p.id} data-proposal-status={p.status}>
                  {formatSlot(p.startsAtIso, p.endsAtIso)} · {p.meetingPointName} · {proposalStatusLabel(p.status)}
                  {p.respondedAtIso && ` · ${formatDateTime(Date.parse(p.respondedAtIso))}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <PresencePanel
        flow={flow}
        busy={busy}
        onAction={(action) =>
          run(() => api.updatePresence(flow.orderId, action), action === 'DEPART' ? '已标记「我已出发」' : '已标记「我已到达」')
        }
      />

      <InspectionPanel
        flow={flow}
        busy={busy}
        onSaveDraft={(items: InspectionResultInput[]) => run(() => api.saveInspectionDraft(flow.orderId, items), '草稿已保存')}
        onSubmit={(items: InspectionResultInput[]) => run(() => api.submitInspection(flow.orderId, items), '验货结果已提交')}
      />

      <FlowTimeline flow={flow} />

      {flow.cancellation && (
        <section aria-labelledby="cancellation-title" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h2 id="cancellation-title" className="text-base font-bold text-slate-800">取消记录</h2>
          <p className="text-slate-700">
            {flow.cancellation.byMe ? '由我取消' : '由对方取消'} · {CANCEL_PHASE_LABEL[flow.cancellation.phase]}
            {flow.cancellation.reasonCode ? ` · ${CANCEL_REASON_LABEL[flow.cancellation.reasonCode]}` : ''}
          </p>
          {flow.cancellation.note && <p className="text-slate-600">说明：{flow.cancellation.note}</p>}
          <p className="text-xs text-slate-600">取消记录只有订单双方看得到，不出现在公开资料里。</p>
        </section>
      )}

      <NoShowPanel key={`${flow.orderId}:${flow.status}:${flow.agreement.revision}`} orderId={flow.orderId} />

      <p className="text-xs text-slate-600">
        确认面交、核销确认码与取消订单请在 <Link className="underline" to="/profile/orders">我的订单</Link> 中操作。
      </p>

      <ProposeMeetingDialog
        open={proposeOpen}
        points={proposablePoints}
        busy={busy}
        errorMessage={proposeError}
        onCancel={() => setProposeOpen(false)}
        onSubmit={submitProposal}
      />
    </div>
  );
}
