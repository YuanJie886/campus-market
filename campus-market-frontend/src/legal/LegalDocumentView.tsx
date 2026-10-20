import { useId, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { PRIVACY_POLICY, PRIVACY_ROUTE, TERMS_ROUTE, USER_AGREEMENT, type LegalDocument } from './legalText';

export type LegalKind = 'terms' | 'privacy';
export const LEGAL_DOCUMENTS: Record<LegalKind, LegalDocument> = { terms: USER_AGREEMENT, privacy: PRIVACY_POLICY };
export const LEGAL_ROUTES: Record<LegalKind, string> = { terms: TERMS_ROUTE, privacy: PRIVACY_ROUTE };
export const LEGAL_LINK_TEXT: Record<LegalKind, string> = { terms: '《用户协议》', privacy: '《隐私政策》' };

/** 正文：草案横幅、运营者信息（【…】占位原样显示）与逐条章节。页面里标题是 h1；弹窗里标题放在 DialogTitle，正文不再重复 */
export function LegalDocumentBody({ doc, titleId, showTitle = true }: { doc: LegalDocument; titleId?: string; showTitle?: boolean }) {
  return (
    <article aria-labelledby={titleId} className="space-y-4 text-sm leading-6 text-slate-700">
      {showTitle && <h1 id={titleId} className="text-xl font-extrabold text-slate-800">{doc.title}</h1>}
      <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-900">{doc.draft}</p>
      <ul aria-label="运营者信息" className="space-y-0.5 text-xs text-slate-600">
        {doc.meta.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {doc.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-base font-bold text-slate-800">{section.heading}</h2>
          {section.paragraphs.map((p) => <p key={p}>{p}</p>)}
        </section>
      ))}
    </article>
  );
}

/** 公开页 /terms、/privacy（无需登录） */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const titleId = useId();
  const other: LegalKind = kind === 'terms' ? 'privacy' : 'terms';
  return (
    <div className="mx-auto max-w-3xl py-2 md:py-6">
      <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-card md:p-8">
        <LegalDocumentBody doc={LEGAL_DOCUMENTS[kind]} titleId={titleId} />
        <p className="mt-6 text-sm">
          另见 <Link to={LEGAL_ROUTES[other]} className="font-semibold text-brand-600">{LEGAL_LINK_TEXT[other]}</Link>
        </p>
      </div>
    </div>
  );
}

/** 协议与政策的两个链接（登录页、个人中心、注册页共用）。onOpen 存在时在当前页的弹窗里打开（保留正在填写的表单），否则跳到对应页面 */
export function LegalLinks({ onOpen, className = '' }: { onOpen?: (kind: LegalKind) => void; className?: string }) {
  const click = (kind: LegalKind) => (e: MouseEvent<HTMLAnchorElement>) => {
    // 带修饰键（新标签页打开）时交给浏览器
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(kind);
  };
  return (
    <span className={className}>
      {(['terms', 'privacy'] as const).map((kind) => (
        <Link key={kind} to={LEGAL_ROUTES[kind]} onClick={click(kind)} className="font-semibold text-brand-600 underline-offset-2 hover:underline">
          {LEGAL_LINK_TEXT[kind]}
        </Link>
      ))}
    </span>
  );
}

/** 在当前页的弹窗里阅读协议（注册页用：不离开页面，已填写的内容保留） */
export function LegalDialog({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  const titleId = useId();
  const doc = kind ? LEGAL_DOCUMENTS[kind] : null;
  return (
    <Dialog open={!!doc} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="md" scroll="paper">
      {doc && (
        <>
          <DialogTitle id={titleId}>{doc.title}</DialogTitle>
          <DialogContent dividers>
            <LegalDocumentBody doc={doc} showTitle={false} />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>关闭</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
