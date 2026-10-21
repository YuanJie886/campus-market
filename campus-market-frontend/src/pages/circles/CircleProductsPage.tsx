import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { Circle, FeedPage } from '../../api/contracts';
import ProductGrid from '../../components/ProductGrid';

/**
 * 圈子商品流：只有在籍成员能打开；只包含发布时选择了这个圈子的商品。
 * 页码只在页面状态里，不写入地址栏。
 */
export default function CircleProductsPage() {
  const { id = '' } = useParams();
  const [circle, setCircle] = useState<Circle | null | undefined>(undefined);
  const [feed, setFeed] = useState<FeedPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let active = true;
    getApiClient().getCircle(id)
      .then((c) => { if (active) setCircle('myRole' in c ? c : null) })
      .catch(() => { if (active) setCircle(null) });
    return () => { active = false };
  }, [id]);

  useEffect(() => {
    let active = true;
    setFeed(null);
    getApiClient().listCircleProducts(id, page)
      .then((f) => { if (active) setFeed(f) })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && e.code === 404) setDenied(true);
        else setError(toUserMessage(e));
      });
    return () => { active = false };
  }, [id, page]);

  if (denied || circle === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">圈子不存在或你没有权限查看</h1>
        <Link to="/circles" className="text-sm text-indigo-800 underline">返回我的圈子</Link>
      </div>
    );
  }
  const pages = feed ? Math.max(1, Math.ceil(feed.total / feed.pageSize)) : 1;
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">{circle ? `${circle.name} · 圈子商品` : '圈子商品'}</h1>
        <p className="text-xs text-slate-700">只包括成员发布时选择了这个圈子的「圈子可见」商品，只有圈子在籍成员能看到。</p>
        {circle && <Link to={`/circles/${encodeURIComponent(circle.id)}`} className="text-sm text-indigo-800 underline">返回圈子</Link>}
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      <ProductGrid products={feed?.items ?? []} loading={!feed && !error} emptyTitle="这个圈子还没有在售商品" />
      {feed && pages > 1 && (
        <nav aria-label="圈子商品分页" className="flex items-center justify-center gap-2">
          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span className="text-sm text-slate-700">第 {page} / {pages} 页</span>
          <Button size="small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </nav>
      )}
    </div>
  );
}
