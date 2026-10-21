import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { AssistInvite, AssistInviteStatus } from '../../api/contracts';

const STATUS_LABEL: Record<AssistInviteStatus, string> = {
  PENDING: '等待对方兑换', ACTIVE: '协助中', REVOKED: '已撤销', EXPIRED: '已过期',
};

/** 所有者查看与撤销自己发出的协助邀请（不含邀请码）。 */
export default function AssistInviteList({ refreshKey, filter }: { refreshKey: number; filter?: (i: AssistInvite) => boolean }) {
  const [invites, setInvites] = useState<AssistInvite[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getApiClient().listAssistInvites()
      .then((list) => setInvites(filter ? list.filter(filter) : list))
      .catch((e) => setError(toUserMessage(e)));
  }, [filter]);
  useEffect(load, [load, refreshKey]);

  const revoke = async (invite: AssistInvite) => {
    try {
      await getApiClient().revokeAssistInvite(invite.id);
      setStatus('邀请已撤销，对方将无法再查看或修改这些草稿');
      load();
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  if (!invites || invites.length === 0) return <p role="status" className="sr-only">{status}</p>;
  return (
    <section aria-labelledby="assist-invites-title" className="space-y-2">
      <h3 id="assist-invites-title" className="text-sm font-bold text-slate-800">协助邀请</h3>
      <ul className="space-y-1 text-sm">
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <span>
              {STATUS_LABEL[i.status]}
              {i.assistantNickname ? ` · 协助人：${i.assistantNickname}` : ''}
              <span className="text-xs text-slate-600"> · 有效期至 {new Date(i.expiresAt).toLocaleString('zh-CN')}</span>
            </span>
            {(i.status === 'PENDING' || i.status === 'ACTIVE') && (
              <Button size="small" color="inherit" onClick={() => revoke(i)}>撤销邀请</Button>
            )}
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="text-xs text-emerald-800">{status}</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
