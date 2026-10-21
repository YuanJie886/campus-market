import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClient } from '../api/client';
import { toUserMessage, type ApiError } from '../api/errors';
import type { FeedPage, FeedProduct, FeedQuery } from '../api/contracts';

/**
 * 首页「本楼 / 本校区」范围的数据获取（GET /v1/products/feed）。「全校」不走这里，query 传 null 即停用。
 *
 * <p>切换范围后用户往往紧接着改分类、改价格——请求会重叠。这里用递增的请求序号丢弃过期响应：
 * 慢的旧请求回来时，它的序号已经不是最新，直接忽略。否则用户会看到筛选条件与结果对不上的画面。
 *
 * <p>四种状态严格区分：loading / error / empty / fallback。
 * 「降级到园区且有结果」不是错误，也不是空——它需要自己的提示。
 * 范围在第一页就由服务端确定（分页前选定），之后的「加载更多」只翻页，不会改变范围。
 */
export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BuildingFeedState {
  status: FeedStatus;
  /** 第一页的元数据（requestedScope / effectiveScope / fallbackApplied / total） */
  page: FeedPage | null;
  /** 已加载的全部商品（第一页 + 加载更多） */
  items: FeedProduct[];
  /** 给用户看的错误提示，已包含 requestId */
  errorMessage: string | null;
  /** 需要引导用户去做的事：登录，或去资料页设置宿舍楼 */
  action: 'login' | 'set-dorm-building' | null;
  /** 还有下一页 */
  hasMore: boolean;
  /** 正在加载下一页 */
  loadingMore: boolean;
  reload: () => void;
  loadMore: () => void;
}

export function useBuildingFeed(query: FeedQuery | null): BuildingFeedState {
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [page, setPage] = useState<FeedPage | null>(null);
  const [items, setItems] = useState<FeedProduct[]>([]);
  const [lastPage, setLastPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [action, setAction] = useState<'login' | 'set-dorm-building' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const sequence = useRef(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  // 以序列化后的查询做依赖：内容相同就不重新请求，避免每次渲染新建对象触发死循环
  const key = query === null ? null : JSON.stringify(query);

  useEffect(() => {
    if (key === null) {
      sequence.current += 1;
      setStatus('idle');
      setPage(null);
      setItems([]);
      setLastPage(0);
      setLoadingMore(false);
      setErrorMessage(null);
      setAction(null);
      return;
    }
    const current = ++sequence.current;
    setStatus('loading');
    setItems([]);
    setPage(null);
    setLoadingMore(false);
    setErrorMessage(null);
    setAction(null);

    getApiClient()
      .feedProducts(JSON.parse(key) as FeedQuery)
      .then((result) => {
        if (current !== sequence.current) return;   // 已被更新的请求取代
        setPage(result);
        setItems(result.items);
        setLastPage(result.page);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (current !== sequence.current) return;
        const apiError = error as ApiError;
        // 401 / 409 不是「出错了」，而是「还差一步」：给出可执行的引导
        if (apiError?.code === 401) setAction('login');
        else if (apiError?.code === 409) setAction('set-dorm-building');
        setPage(null);
        setErrorMessage(toUserMessage(error));
        setStatus('error');
      });
  }, [key, reloadToken]);

  const hasMore = status === 'ready' && page !== null && items.length < page.total;

  const loadMore = useCallback(() => {
    if (key === null || !hasMore || loadingMore) return;
    const current = sequence.current;
    const next = { ...(JSON.parse(key) as FeedQuery), page: lastPage + 1 };
    setLoadingMore(true);
    setErrorMessage(null);
    getApiClient()
      .feedProducts(next)
      .then((result) => {
        if (current !== sequence.current) return;
        setItems((previous) => [...previous, ...result.items.filter((item) => !previous.some((old) => old.id === item.id))]);
        setLastPage(result.page);
        setLoadingMore(false);
      })
      .catch((error: unknown) => {
        if (current !== sequence.current) return;
        setLoadingMore(false);
        setErrorMessage(toUserMessage(error));
      });
  }, [key, hasMore, loadingMore, lastPage]);

  return { status, page, items, errorMessage, action, hasMore, loadingMore, reload, loadMore };
}
