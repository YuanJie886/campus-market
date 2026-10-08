import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { Circle, DiscoverableCircle } from '../../api/contracts';
import { CIRCLE_ROLE_LABEL, CIRCLE_TYPE_LABEL, USER_CREATED_NOTE, USER_CREATED_TEXT } from '../../utils/circle';

/**
 * 我的圈子。圈子只能通过邀请加入：「可发现」的圈子在这里只显示名称和简介，没有「申请加入」按钮。
 * 搜索词只放在页面状态里，不写进地址栏。
 */
export default function CirclesPage() {
  const [mine, setMine] = useState<Circle[] | null>(null);
  const [found, setFound] = useState<DiscoverableCircle[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();

  useEffect(() => {
    let active = true;
    getApiClient().listMyCircles()
      .then((list) => { if (active) setMine(list) })
      .catch((e) => { if (active) { setMine([]); setError(toUserMessage(e)) } });
    return () => { active = false };
  }, []);

  const search = useCallback(async (q: string) => {
    try {
      setFound(await getApiClient().discoverCircles(q.trim() || undefined));
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, []);
  useEffect(() => { void search('') }, [search]);

  const active = (mine ?? []).filter((c) => c.status === 'ACTIVE');
  const archived = (mine ?? []).filter((c) => c.status !== 'ACTIVE');
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">我的圈子</h1>
        <p className="mt-1 text-sm text-slate-700">{USER_CREATED_NOTE}加入圈子需要成员给你的邀请码。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button component={Link} to="/circles/new" variant="contained" size="small">创建圈子</Button>
          <Button component={Link} to="/circles/join" variant="outlined" size="small">用邀请码加入</Button>
        </div>
      </div>
      {error && <Alert severity="error">{error}</Alert>}

      <section aria-labelledby="my-circles-title" className="space-y-2">
        <h2 id="my-circles-title" className="text-base font-bold text-slate-800">已加入</h2>
        {mine === null ? <p role="status" className="text-sm text-slate-600">正在读取…</p>
          : active.length === 0 ? <p className="text-sm text-slate-600">你还没有加入任何圈子。</p>
            : (
              <ul className="space-y-2">
                {active.map((c) => (
                  <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <Link to={`/circles/${encodeURIComponent(c.id)}`} className="font-semibold text-indigo-800 underline">{c.name}</Link>
                    <p className="text-xs text-slate-700">
                      {CIRCLE_TYPE_LABEL[c.type]} · {USER_CREATED_TEXT} · 我是{CIRCLE_ROLE_LABEL[c.myRole]} · {c.visibility === 'PRIVATE' ? '私密' : '可发现'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
        {archived.length > 0 && (
          <details className="text-sm text-slate-700">
            <summary>已归档的圈子（{archived.length}）</summary>
            <ul className="mt-1 list-disc pl-5">
              {archived.map((c) => <li key={c.id}><Link to={`/circles/${encodeURIComponent(c.id)}`} className="underline">{c.name}</Link>（已归档，只读）</li>)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="discover-title" className="space-y-2">
        <h2 id="discover-title" className="text-base font-bold text-slate-800">本校可发现的圈子</h2>
        <p className="text-xs text-slate-700">这里只列出创建者设为「可发现」的圈子。想加入，请向圈子成员要邀请码。</p>
        <form role="search" aria-labelledby={searchId} className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); void search(query) }}>
          <span id={searchId} className="sr-only">搜索可发现的圈子</span>
          <TextField size="small" label="圈子名称" value={query} onChange={(e) => setQuery(e.target.value)} inputProps={{ maxLength: 30, autoComplete: 'off' }} />
          <Button type="submit" variant="outlined">搜索</Button>
        </form>
        {found === null ? <p role="status" className="text-sm text-slate-600">正在读取…</p>
          : found.length === 0 ? <p className="text-sm text-slate-600">没有找到可发现的圈子。</p>
            : (
              <ul className="space-y-2" aria-label="可发现的圈子">
                {found.map((c) => (
                  <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-800">
                      {c.joined ? <Link to={`/circles/${encodeURIComponent(c.id)}`} className="text-indigo-800 underline">{c.name}</Link> : c.name}
                    </p>
                    <p className="text-xs text-slate-700">{CIRCLE_TYPE_LABEL[c.type]} · {USER_CREATED_TEXT}{c.joined ? ' · 已加入' : ' · 需要邀请码加入'}</p>
                    {c.description && <p className="mt-1 text-sm text-slate-700">{c.description}</p>}
                  </li>
                ))}
              </ul>
            )}
      </section>
    </div>
  );
}
