import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiClient } from '../api/client';
import { toUserMessage, type ApiError } from '../api/errors';
import type { FeedPage, FeedQuery } from '../api/contracts';

/**
 * 「只看本楼」的数据获取。
 *
 * <p>开关一打开，用户往往会紧接着改分类、改价格——请求会重叠。
 * 这里用递增的请求序号丢弃过期响应：慢的旧请求回来时，它的序号已经不是最新，
 * 直接忽略。否则用户会看到筛选条件与结果对不上的画面，还以为是筛选坏了。
 *
 * <p>四种状态严格区分：loading / error / empty / fallback。
 * 「降级到园区且有结果」不是错误，也不是空——它需要自己的提示。
 */
export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BuildingFeedState {
  status: FeedStatus;
  page: FeedPage | null;
  /** 给用户看的错误提示，已包含 requestId */
  errorMessage: string | null;
  /** 需要引导用户去做的事：登录，或去资料页设置宿舍楼 */
  action: 'login' | 'set-dorm-building' | null;
  reload: () => void;
}

export function useBuildingFeed(query: FeedQuery | null): BuildingFeedState {
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [page, setPage] = useState<FeedPage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [action, setAction] = useState<'login' | 'set-dorm-building' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const sequence = useRef(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  // 以序列化后的查询做依赖：内容相同就不重新请求，避免每次渲染新建对象触发死循环
  const key = query === null ? null : JSON.stringify(query);

  useEffect(() => {
    if (key === null) {
      setStatus('idle');
      setPage(null);
      setErrorMessage(null);
      setAction(null);
      return;
    }
    const current = ++sequence.current;
    setStatus('loading');
    setErrorMessage(null);
    setAction(null);

    getApiClient()
      .feedProducts(JSON.parse(key) as FeedQuery)
      .then((result) => {
        if (current !== sequence.current) return;   // 已被更新的请求取代
        setPage(result);
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

  return { status, page, errorMessage, action, reload };
}
