import Taro, { useDidShow, usePullDownRefresh, useReachBottom, useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api } from '../../../api';
import { ApiError } from '../../../api/transport';
import { Empty, LoginGate, PageTitle, ProductGrid } from '../../../components';
import type { Circle, Product } from '../../../model';
import { CIRCLE_PRODUCTS_NOTE, NOT_FOUND_TITLE, isMember } from '../../../circles';
import { CIRCLE_PAGES } from '../../../menu';
import { useMarket } from '../../../state';

/** 圈子商品流：只有在籍成员能打开；只包含发布时选择了这个圈子的商品。 */
export default function CircleProductsPage() {
  const { user } = useMarket(), id = useRouter().params.id ?? '';
  const [circle, setCircle] = useState<Circle | null>(null), [items, setItems] = useState<Product[] | null>(null), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [denied, setDenied] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = async (reset = true) => {
    if (!user || (!reset && loading)) return;
    const gen = ++sequence.current; setLoading(true); setError('');
    try {
      if (reset) { const c = await api.circle(id); setCircle(isMember(c) ? c : null); if (!isMember(c)) { setDenied(true); return; } }
      const next = await api.circleProducts(id, reset ? 1 : page + 1);
      if (gen !== sequence.current) return;
      setItems((prev) => reset ? next.items : [...(prev ?? []), ...next.items.filter((p) => !(prev ?? []).some((o) => o.id === p.id))]); setTotal(next.total); setPage(next.page);
    } catch (e) { if (e instanceof ApiError && e.code === 404) setDenied(true); else setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useReachBottom(() => { if ((items?.length ?? 0) < total) void load(false); });
  return <View className='page'>
    <LoginGate returnTo={`${CIRCLE_PAGES.products}?id=${encodeURIComponent(id)}`}>
      {denied ? <PageTitle title={NOT_FOUND_TITLE} /> : <>
        <PageTitle title={circle ? `${circle.name} · 圈子商品` : '圈子商品'} subtitle={CIRCLE_PRODUCTS_NOTE} />
        {error ? <Text className='error-text'>{error}</Text> : null}
        {items === null ? <Empty title='正在加载…' /> : !items.length ? <Empty title='这个圈子还没有在售商品' /> : <ProductGrid products={items} />}
        {items && items.length > 0 && <View className='load-more'>{loading ? '正在加载…' : items.length >= total ? '已经看到全部好物了' : '上拉加载更多'}</View>}
      </>}
    </LoginGate>
  </View>;
}
