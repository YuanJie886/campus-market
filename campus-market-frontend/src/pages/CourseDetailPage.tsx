import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { CourseDetail, TextbookEdition } from '../api/contracts';
import { useAuth } from '../context/AuthContext';
import { DEMO_CATALOG_NOTE, offeringLabel, usageLabel } from '../utils/catalog';
import TextbookEditionSummary from '../components/textbook/TextbookEditionSummary';
import TextbookSubscribeDialog from '../components/textbook/TextbookSubscribeDialog';
import TextbookSuggestionDialog from '../components/textbook/TextbookSuggestionDialog';

/**
 * 课程详情：各学期开课的指定教材版本（只有已验证的关系），每本附本校在售数量。
 * 有货直达该版本的商品流；无货可以订阅这个版本。
 */
export default function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const { currentUser } = useAuth();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribeFor, setSubscribeFor] = useState<TextbookEdition | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    setCourse(null);
    setError(null);
    getApiClient().getCourse(courseId)
      .then((c) => { if (active) setCourse(c) })
      .catch((e) => { if (active) setError(toUserMessage(e)) });
    return () => { active = false };
  }, [courseId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Alert severity="error">{error}</Alert>
        <Button component={Link} to="/courses">返回课程教材</Button>
      </div>
    );
  }
  if (!course) return <p role="status" className="mx-auto max-w-3xl text-sm text-slate-600">正在读取课程…</p>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Link to="/courses" className="text-sm text-teal-800 underline">← 课程教材</Link>
        <h1 className="mt-1 text-xl font-extrabold text-slate-800">{course.name}</h1>
        <p className="text-sm text-slate-600">{course.courseCode ? `${course.courseCode} · ` : ''}{course.department ?? '开课单位未注明'}</p>
      </div>
      {course.isDemo && <Alert severity="info" role="note">{DEMO_CATALOG_NOTE}</Alert>}
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
      {status && <p aria-hidden="true" className="text-sm text-emerald-800">{status}</p>}

      {course.offerings.length === 0 && <p className="text-sm text-slate-600">这门课暂时没有开课记录。</p>}
      {course.offerings.map((o) => (
        <section key={o.id} aria-labelledby={`offering-${o.id}`} className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <h2 id={`offering-${o.id}`} className="text-base font-bold text-slate-800">
            {offeringLabel(o)}{o.campusId ? ` · ${o.campusId}` : ''}
          </h2>
          {o.textbooks.length === 0 ? (
            <p className="text-sm text-slate-600">本学期还没有已验证的教材信息。</p>
          ) : (
            <ul className="space-y-3">
              {o.textbooks.map(({ usageType, edition }) => (
                <li key={edition.id} className="rounded-xl bg-slate-50 p-3" data-edition-id={edition.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Chip size="small" label={usageLabel(usageType)} color={usageType === 'REQUIRED' ? 'primary' : 'default'} />
                    <span className="text-xs text-slate-700">本校在售 {edition.onSaleCount} 件</span>
                  </div>
                  <TextbookEditionSummary edition={edition} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="small" variant={edition.onSaleCount > 0 ? 'contained' : 'outlined'} component={Link}
                      to={`/textbooks/${encodeURIComponent(edition.id)}`}>
                      {edition.onSaleCount > 0 ? `查看这个版本的在售商品（${edition.onSaleCount}）` : '查看版本详情'}
                    </Button>
                    {edition.onSaleCount === 0 && (
                      <Button size="small" onClick={() => setSubscribeFor(edition)}>订阅这个教材版本</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section aria-labelledby="suggest-heading" className="rounded-2xl border border-dashed border-slate-300 p-4">
        <h2 id="suggest-heading" className="text-sm font-bold text-slate-800">教材信息不对或缺了？</h2>
        <p className="text-xs text-slate-600">你可以提交建议。建议不会公开，也不会自动变成正式教材。</p>
        <Button size="small" sx={{ mt: 1 }} onClick={() => setSuggestOpen(true)} disabled={course.offerings.length === 0}>
          为这门课建议教材
        </Button>
        <Link to="/profile/textbook-suggestions" className="ml-2 text-xs text-teal-800 underline">我的教材建议</Link>
      </section>

      <TextbookSubscribeDialog
        open={Boolean(subscribeFor)}
        edition={subscribeFor}
        hasDorm={Boolean(currentUser?.dormBuildingId)}
        onClose={() => setSubscribeFor(null)}
        onDone={(message) => { setSubscribeFor(null); setStatus(message); }}
      />
      <TextbookSuggestionDialog
        open={suggestOpen}
        offerings={course.offerings}
        onClose={() => setSuggestOpen(false)}
        onDone={(message) => { setSuggestOpen(false); setStatus(message); }}
      />
    </div>
  );
}
