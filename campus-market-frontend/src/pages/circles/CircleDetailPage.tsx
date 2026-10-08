import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { Circle, DemandConditions, DiscoverableCircle } from '../../api/contracts';
import DemandSubscribeDialog from '../../components/demand/DemandSubscribeDialog';
import ReportDialog from '../../components/governance/ReportDialog';
import { useAuth } from '../../context/AuthContext';
import { useDemandUnreadCount } from '../../context/DemandUnreadContext';
import { CIRCLE_ROLE_LABEL, CIRCLE_TYPE_LABEL, LEAVE_CONSEQUENCES, USER_CREATED_NOTE, USER_CREATED_TEXT } from '../../utils/circle';

function isMember(c: Circle | DiscoverableCircle): c is Circle {
  return (c as Circle).myRole !== undefined && c.joined === true;
}

/**
 * 圈子详情。无权查看与不存在一律显示同一句「圈子不存在或你没有权限查看」，不区分两者。
 * 非成员只能看到「可发现」圈子的名称与简介。
 */
export default function CircleDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { refresh: refreshUnread } = useDemandUnreadCount();
  const [circle, setCircle] = useState<Circle | DiscoverableCircle | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const subscribeButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setCircle(await getApiClient().getCircle(id));
    } catch (e) {
      if (e instanceof ApiError && e.code === 404) setCircle(null);
      else setError(toUserMessage(e));
    }
  }, [id]);
  useEffect(() => { void load() }, [load]);

  const leave = async () => {
    if (!currentUser) return;
    setBusy(true);
    try {
      await getApiClient().removeCircleMember(id, currentUser.id);
      setLeaveOpen(false);
      refreshUnread();
      navigate('/circles');
    } catch (e) {
      setError(toUserMessage(e));
      setLeaveOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async (conditions: DemandConditions) => {
    setBusy(true);
    setSubscribeError(null);
    try {
      const result = await getApiClient().createDemandSubscription({ ...conditions, circleId: id });
      setSubscribeOpen(false);
      setStatus(result.outcome === 'EXISTING' ? '已有相同的圈子订阅' : '已订阅这个圈子的新商品，可在「需求匹配」里查看');
    } catch (e) {
      setSubscribeError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (circle === undefined && !error) return <p role="status" className="text-sm text-slate-600">正在读取圈子…</p>;
  if (circle === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">圈子不存在或你没有权限查看</h1>
        <p className="text-sm text-slate-700">如果你收到了邀请码，可以<Link to="/circles/join" className="text-indigo-800 underline">用邀请码加入</Link>。</p>
      </div>
    );
  }
  if (!circle) return <Alert severity="error">{error}</Alert>;

  const member = isMember(circle) ? circle : null;
  const manager = member && member.status === 'ACTIVE' && (member.myRole === 'OWNER' || member.myRole === 'MODERATOR');
  const archived = member?.status === 'ARCHIVED';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">{circle.name}</h1>
        <p className="text-xs text-slate-700">
          {CIRCLE_TYPE_LABEL[circle.type]} · {USER_CREATED_TEXT}
          {member ? ` · 我是${CIRCLE_ROLE_LABEL[member.myRole]}` : ''}{archived ? ' · 已归档' : ''}
        </p>
        {circle.description && <p className="mt-2 text-sm text-slate-700">{circle.description}</p>}
        <p className="mt-2 text-xs text-slate-600">{USER_CREATED_NOTE}</p>
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>

      {!member ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">你还不是这个圈子的成员。加入需要成员给你的邀请码。</p>
      ) : archived ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">这个圈子已归档：不能再发布、订阅或邀请新成员。已经成立的订单不受影响。</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button component={Link} to={`/circles/${encodeURIComponent(circle.id)}/products`} variant="contained" size="small">圈子商品</Button>
          <Button ref={subscribeButton} variant="outlined" size="small" onClick={() => { setSubscribeError(null); setSubscribeOpen(true) }}>订阅圈子新商品</Button>
          {manager && <Button component={Link} to={`/circles/${encodeURIComponent(circle.id)}/manage`} variant="outlined" size="small">管理圈子</Button>}
          {member.myRole !== 'OWNER'
            ? <Button ref={leaveButton} color="error" variant="outlined" size="small" onClick={() => setLeaveOpen(true)}>退出圈子</Button>
            : <p className="text-xs text-slate-600">所有者需要先在「管理圈子」里转让所有权，才能退出。</p>}
        </div>
      )}

      {member?.myRole !== 'OWNER' && (
        <Button size="small" color="inherit" onClick={() => setReporting(true)}>举报这个圈子</Button>
      )}
      {reporting && <ReportDialog open targetType="CIRCLE" targetId={circle.id} targetLabel={circle.name} onClose={() => setReporting(false)} />}

      <Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} aria-labelledby="leave-circle-title" aria-describedby="leave-circle-body"
        TransitionProps={{ onExited: () => leaveButton.current?.focus() }}>
        <DialogTitle id="leave-circle-title">退出「{circle.name}」？</DialogTitle>
        <DialogContent id="leave-circle-body">
          <p className="text-sm text-slate-700">退出后：</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
            {LEAVE_CONSEQUENCES.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-600">之后想回来，需要重新拿到邀请码。</p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLeaveOpen(false)} autoFocus>取消</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void leave()}>确认退出</Button>
        </DialogActions>
      </Dialog>

      {member && !archived && (
        <DemandSubscribeDialog
          open={subscribeOpen}
          title="订阅圈子新商品"
          submitLabel="订阅"
          initial={{}}
          userCampus={currentUser?.campus ?? '东校区'}
          busy={busy}
          errorMessage={subscribeError}
          onCancel={() => { setSubscribeOpen(false); window.setTimeout(() => subscribeButton.current?.focus(), 0) }}
          onSubmit={(c) => void subscribe(c)}
          circleScope={{ name: circle.name }}
        />
      )}
    </div>
  );
}
