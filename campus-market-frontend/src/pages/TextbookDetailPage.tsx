import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { TextbookDetail } from '../api/contracts';
import { useAuth } from '../context/AuthContext';
import { DEMO_CATALOG_NOTE, offeringLabel, usageLabel } from '../utils/catalog';
import ProductCard from '../components/ProductCard';
import TextbookEditionSummary from '../components/textbook/TextbookEditionSummary';
import TextbookSubscribeDialog from '../components/textbook/TextbookSubscribeDialog';

/**
 * 教材版本详情：关联课程、精确版本的在售商品（沿用楼栋 / 距离排序），
 * 以及单独分区、明确标注的「其他版本」。两组从不混在一起排序。
 */
export default function TextbookDetailPage() {
  const { editionId = '' } = useParams();
  const { currentUser } = useAuth();
  const [detail, setDetail] = useState<TextbookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    getApiClient().getTextbook(editionId)
      .then((d) => { if (active) setDetail(d) })
      .catch((e) => { if (active) setError(toUserMessage(e)) });
    return () => { active = false };
  }, [editionId]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Alert severity="error">{error}</Alert>
        <Button component={Link} to="/courses">返回课程教材</Button>
      </div>
    );
  }
  if (!detail) return <p role="status" className="mx-auto max-w-4xl text-sm text-slate-600">正在读取教材…</p>;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link to="/courses" className="text-sm text-teal-800 underline">← 课程教材</Link>
      <section aria-labelledby="edition-heading" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
        <h1 id="edition-heading" className="sr-only">教材版本：{detail.title} {detail.editionLabel}</h1>
        <TextbookEditionSummary edition={detail} headingLevel={2} />
        {detail.isDemo && <p className="mt-2 text-xs text-amber-800">{DEMO_CATALOG_NOTE}</p>}
        {currentUser && (
          <p className="mt-2 text-sm">
            {/* 无 ISBN 的版本（讲义、演示教材）无法按 ISBN 查找，从这里进入发布页；关联前仍需卖家确认 */}
            <Link to={`/publish?textbookEditionId=${encodeURIComponent(detail.id)}`} className="text-teal-800 underline">
              我有这一版，去发布
            </Link>
          </p>
        )}
        {detail.courses.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-bold text-slate-700">用于这些课程</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {detail.courses.map((c) => (
                <li key={`${c.offeringId}`}>
                  <Link to={`/courses/${encodeURIComponent(c.courseId)}`} className="text-teal-800 underline">{c.courseName}</Link>
                  <span className="text-xs text-slate-600"> · {offeringLabel(c)} · {usageLabel(c.usageType)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div role="status" aria-live="polite" className="sr-only">{status}</div>
      {status && <p aria-hidden="true" className="text-sm text-emerald-800">{status}</p>}

      <section aria-labelledby="exact-heading" className="space-y-3">
        <h2 id="exact-heading" className="text-base font-bold text-slate-800">
          正是这个版本的在售商品（{detail.listings.length}）
        </h2>
        <p className="text-xs text-slate-600">
          {detail.listingSort === 'nearest' ? '按离你的宿舍楼由近到远排列（直线估算）。' : '按最新发布排列。设置宿舍楼后可按距离排序。'}
        </p>
        {detail.listings.length === 0 ? (
          <div className="rounded-2xl bg-white p-4 text-sm text-slate-700">
            本校暂时没有这个版本在卖。
            <Button size="small" variant="contained" sx={{ ml: 1 }} onClick={() => setSubscribeOpen(true)}>订阅这个教材版本</Button>
          </div>
        ) : (
          <ul aria-label="这个版本的在售商品" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {detail.listings.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
          </ul>
        )}
      </section>

      {detail.otherEditions.length > 0 && (
        <section aria-labelledby="other-heading" className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <h2 id="other-heading" className="text-base font-bold text-amber-900">其他版本（不是这个版本）</h2>
          <p className="text-xs text-amber-900">
            以下是同一部教材的其他版次，内容与页码可能不同。请先确认课程是否接受这些版本再购买。
          </p>
          <ul className="space-y-1 text-sm text-slate-800">
            {detail.otherEditions.map((e) => (
              <li key={e.id}>
                <Link to={`/textbooks/${encodeURIComponent(e.id)}`} className="underline">{e.title} {e.editionLabel}</Link>
                <span className="text-xs text-slate-700"> · 在售 {e.onSaleCount} 件</span>
              </li>
            ))}
          </ul>
          {detail.otherEditionListings.length > 0 && (
            <ul aria-label="其他版本的在售商品" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {detail.otherEditionListings.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
            </ul>
          )}
        </section>
      )}

      <TextbookSubscribeDialog
        open={subscribeOpen}
        edition={detail}
        hasDorm={Boolean(currentUser?.dormBuildingId)}
        onClose={() => setSubscribeOpen(false)}
        onDone={(message) => { setSubscribeOpen(false); setStatus(message); }}
      />
    </div>
  );
}
