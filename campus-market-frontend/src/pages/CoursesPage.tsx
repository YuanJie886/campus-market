import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { CoursePage, Term } from '../api/contracts';
import { CAMPUSES, type Campus } from '../types';
import { DEMO_CATALOG_NOTE, TERM_OPTIONS, termLabel } from '../utils/catalog';

const PAGE_SIZE = 20;

/**
 * 课程教材入口：按课程名 / 课程代码搜索本校课程目录（学校由服务端从登录用户推导）。
 * 不读取、不导入任何个人选课信息。
 */
export default function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const term = (params.get('term') ?? '') as Term | '';
  const campus = (params.get('campus') ?? '') as Campus | '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState<CoursePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getApiClient()
      .listCourses({ q: q || undefined, term: term || undefined, campus: campus || undefined, page, pageSize: PAGE_SIZE })
      .then((r) => { if (active) setResult(r) })
      .catch((e) => { if (active) setError(toUserMessage(e)) })
      .finally(() => { if (active) setLoading(false) });
    return () => { active = false };
  }, [q, term, campus, page]);

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v); else merged.delete(k);
    }
    if (!('page' in next)) merged.delete('page');
    setParams(merged);
  };

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">课程教材</h1>
        <p className="text-sm text-slate-600">按课程找到指定的教材版本，再看本校有没有同版本在卖。</p>
      </div>
      <Alert severity="info" role="note">{DEMO_CATALOG_NOTE}</Alert>

      <form
        role="search"
        aria-label="搜索课程"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); update({ q: draft.trim() }); }}
      >
        <TextField size="small" label="课程名称或代码" value={draft} onChange={(e) => setDraft(e.target.value)}
          inputProps={{ maxLength: 80 }} sx={{ minWidth: 220 }} />
        <TextField size="small" select label="学期" value={term} onChange={(e) => update({ term: e.target.value })} sx={{ minWidth: 130 }}>
          <MenuItem value="">全部学期</MenuItem>
          {TERM_OPTIONS.map((t) => <MenuItem key={t} value={t}>{termLabel(t)}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="校区" value={campus} onChange={(e) => update({ campus: e.target.value })} sx={{ minWidth: 120 }}>
          <MenuItem value="">全部校区</MenuItem>
          {CAMPUSES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <Button type="submit" variant="contained">搜索</Button>
      </form>

      {/* 加载 / 结果数用 status：非关键变化，不打断读屏 */}
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {loading ? '正在搜索…' : result ? `共 ${result.total} 门课程` : ''}
      </p>
      {error && <Alert severity="error">{error}</Alert>}

      {result && result.items.length === 0 && !loading && (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-600">没有找到课程，换个关键词试试。</p>
      )}
      {result && result.items.length > 0 && (
        <ul aria-label="课程列表" className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-card">
          {result.items.map((c) => (
            <li key={c.id} className="p-4">
              <Link to={`/courses/${encodeURIComponent(c.id)}`} className="text-base font-bold text-slate-800 underline-offset-2 hover:underline">
                {c.name}
              </Link>
              <p className="text-xs text-slate-600">
                {c.courseCode ? `${c.courseCode} · ` : ''}{c.department ?? '开课单位未注明'}
                {` · ${c.offeringCount ?? 0} 个开课学期 · ${c.textbookCount ?? 0} 本指定 / 推荐教材`}
                {c.isDemo && ' · 演示'}
              </p>
            </li>
          ))}
        </ul>
      )}
      {result && totalPages > 1 && (
        <nav aria-label="课程分页" className="flex items-center justify-center gap-2">
          <Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>上一页</Button>
          <span className="text-sm text-slate-700">第 {page} / {totalPages} 页</span>
          <Button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>下一页</Button>
        </nav>
      )}
    </div>
  );
}
