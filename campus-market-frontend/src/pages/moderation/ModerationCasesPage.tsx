import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { ModerationCasePage, ModerationCaseStatus, ModerationTargetType } from '../../api/contracts';
import { CASE_STATUS_LABEL, TARGET_LABEL } from '../../utils/governance';

const STATUSES: ModerationCaseStatus[] = ['OPEN', 'UNDER_REVIEW', 'APPEALED', 'RESOLVED', 'DISMISSED'];
const TYPES: ModerationTargetType[] = ['PRODUCT', 'USER', 'CIRCLE', 'COMMENT', 'MESSAGE', 'ORDER', 'NO_SHOW'];
const SIZE = 20;

/**
 * 平台工作人员：本校的治理案件。权限每次由服务端从数据库确认；非工作人员直接访问也会得到 403。
 * 筛选条件只在页面状态里，不写进地址栏。
 */
export default function ModerationCasesPage() {
  const [status, setStatus] = useState<ModerationCaseStatus | ''>('OPEN');
  const [type, setType] = useState<ModerationTargetType | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ModerationCasePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getApiClient().listModerationCases({ ...(status ? { status } : {}), ...(type ? { targetType: type } : {}), page, size: SIZE }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 403) setForbidden(true);
      else setError(toUserMessage(e));
    }
  }, [status, type, page]);
  useEffect(() => { void load() }, [load]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">需要平台工作人员权限</h1>
        <p className="text-sm text-slate-700">这个页面只对本校的平台工作人员开放。</p>
      </div>
    );
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">治理工作台 · 案件</h1>
        <Link to="/moderation/appeals" className="text-sm text-indigo-800 underline">待处理的申诉</Link>
      </div>
      <p className="text-xs text-slate-700">只显示本校的案件。平台治理不等于交易仲裁或赔付，也不对商品真伪下结论。</p>
      <div className="flex flex-wrap gap-3">
        <TextField select size="small" label="状态" value={status} onChange={(e) => { setStatus(e.target.value as ModerationCaseStatus | ''); setPage(1) }} sx={{ minWidth: 140 }}>
          <MenuItem value="">全部状态</MenuItem>
          {STATUSES.map((s) => <MenuItem key={s} value={s}>{CASE_STATUS_LABEL[s]}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="对象类型" value={type} onChange={(e) => { setType(e.target.value as ModerationTargetType | ''); setPage(1) }} sx={{ minWidth: 140 }}>
          <MenuItem value="">全部类型</MenuItem>
          {TYPES.map((t) => <MenuItem key={t} value={t}>{TARGET_LABEL[t]}</MenuItem>)}
        </TextField>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data ? <p role="status" className="text-sm text-slate-600">正在读取…</p> : data.items.length === 0 ? (
        <p className="text-sm text-slate-600">没有符合条件的案件。</p>
      ) : (
        <ul className="space-y-2" aria-label="案件列表">
          {data.items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <span>
                <Link to={`/moderation/cases/${encodeURIComponent(c.id)}`} className="font-semibold text-indigo-800 underline">
                  {TARGET_LABEL[c.targetType]}案件
                </Link>
                <span className="ml-2 text-slate-700">{CASE_STATUS_LABEL[c.status]} · 举报 {c.reportCount} 次{c.assignedToMe ? ' · 由我处理' : c.assigned ? ' · 他人处理中' : ''}</span>
              </span>
              <span className="text-xs text-slate-600">创建于 {new Date(c.createdAt).toLocaleString('zh-CN')}</span>
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <nav aria-label="案件分页" className="flex items-center gap-2">
          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span className="text-sm text-slate-700" aria-live="polite">第 {page} / {pages} 页（共 {data.total} 件）</span>
          <Button size="small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </nav>
      )}
    </div>
  );
}
