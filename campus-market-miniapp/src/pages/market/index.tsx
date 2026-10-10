import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { Button, Input, Picker, ScrollView, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import { CAMPUSES, CATEGORIES, CONDITIONS, type Campus, type Category, type Condition, type Product, type Query, type Sort } from '../../model';
import { ErrorState, LoginGate, ProductGrid, Empty } from '../../components';
import { useMarket } from '../../state';

const SORTS: { value: Sort; label: string }[] = [{ value: 'latest', label: '最新发布' }, { value: 'priceAsc', label: '价格从低到高' }, { value: 'priceDesc', label: '价格从高到低' }, { value: 'views', label: '最多浏览' }];
export default function MarketPage() {
  const { user, ready } = useMarket();
  const [keyword, setKeyword] = useState(''), [category, setCategory] = useState<Category | ''>('');
  const [query, setQuery] = useState<Query>({ sort: 'latest', page: 1, pageSize: 12 });
  const [products, setProducts] = useState<Product[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const [campus, setCampus] = useState(''), [condition, setCondition] = useState(''), [min, setMin] = useState(''), [max, setMax] = useState('');
  const generation = useRef(0), busy = useRef(false), identity = useRef(user?.id);
  identity.current = user?.id;
  const load = async (reset = true) => {
    if (!user || !ready || (!reset && busy.current)) return;
    const request = ++generation.current, uid = user.id;
    busy.current = true; setLoading(true); setError('');
    try {
      const batch = await api.list({ ...query, category: category || undefined, page: reset ? 1 : page + 1 });
      if (request !== generation.current || uid !== identity.current) return;
      setProducts((previous) => reset ? batch.items.filter((p) => p.status !== '已下架') : [...previous, ...batch.items.filter((p) => !previous.some((old) => old.id === p.id) && p.status !== '已下架')]);
      setTotal(batch.total); setPage(batch.page);
    } catch (e) { if (request === generation.current && uid === identity.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (request === generation.current) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => { generation.current++; busy.current = false; setProducts([]); setTotal(0); setPage(0); void load(); }, [user?.id, ready, query, category]);
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useReachBottom(() => { if (page * query.pageSize < total) void load(false); });
  const reset = () => { setKeyword(''); setCategory(''); setCampus(''); setCondition(''); setMin(''); setMax(''); setQuery({ sort: 'latest', page: 1, pageSize: 12 }); };
  const apply = () => {
    const minPrice = min === '' ? undefined : Number(min), maxPrice = max === '' ? undefined : Number(max);
    if ((minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) { void Taro.showToast({ title: '请填写有效的价格区间', icon: 'none' }); return; }
    setQuery({ ...query, campus: campus as Campus || undefined, condition: condition as Condition || undefined, minPrice, maxPrice }); setExpanded(false);
  };
  return <View className='page market-page'>
    <View className='intro'><Text className='intro-title'>发现本校同学的闲置好物</Text><Text className='intro-description'>闲置就在身边，当面看看再决定。</Text><Text className='intro-badge'>{isDemo ? '演示版 · 商品图片为示意插画' : '校园闲置 · 就近面交'}</Text></View>
    <LoginGate returnTo='/pages/market/index'>
      <View className='search'><Text className='search-symbol'>⌕</Text><Input className='search-input' value={keyword} placeholder='搜索教材、数码、生活好物' confirmType='search' onInput={(e) => setKeyword(e.detail.value)} onConfirm={() => setQuery({ ...query, keyword: keyword.trim() })} /><Button className='search-button' onClick={() => setQuery({ ...query, keyword: keyword.trim() })}>搜索</Button></View>
      <View className='market-heading'><View><Text className='section-title'>校园集市</Text><Text className='subtitle'>{user?.campus} · {SORTS.find((s) => s.value === query.sort)?.label}</Text></View><Text className='text-action' onClick={() => setExpanded(!expanded)}>{expanded ? '收起筛选' : '筛选与排序'} ⌄</Text></View>
      <ScrollView scrollX className='category-scroll'><View className='category-tabs'>{(['', ...CATEGORIES] as const).map((cat) => <Text key={cat} className={`category-tab ${category === cat ? 'selected' : ''}`} onClick={() => setCategory(cat)}>{cat || '全部'}</Text>)}</View></ScrollView>
      {expanded && <View className='filter-panel'>
        <Picker range={['全部校区', ...CAMPUSES]} onChange={(e) => setCampus(Number(e.detail.value) === 0 ? '' : CAMPUSES[Number(e.detail.value) - 1])}><View className='picker'>{campus || '全部校区'} ⌄</View></Picker>
        <Picker range={['全部成色', ...CONDITIONS]} onChange={(e) => setCondition(Number(e.detail.value) === 0 ? '' : CONDITIONS[Number(e.detail.value) - 1])}><View className='picker'>{condition || '全部成色'} ⌄</View></Picker>
        <Picker range={SORTS.map((s) => s.label)} onChange={(e) => setQuery({ ...query, sort: SORTS[Number(e.detail.value)].value })}><View className='picker'>{SORTS.find((s) => s.value === query.sort)?.label} ⌄</View></Picker>
        <View className='price-inputs'><Input type='digit' value={min} placeholder='最低价' onInput={(e) => setMin(e.detail.value)} /><Text>—</Text><Input type='digit' value={max} placeholder='最高价' onInput={(e) => setMax(e.detail.value)} /></View>
        <View className='button-row'><Button className='secondary' onClick={reset}>重置</Button><Button className='primary' onClick={apply}>应用筛选</Button></View>
      </View>}
      <View className='result-line'><Text>{query.keyword ? `「${query.keyword}」 · ` : ''}{category || '全部好物'} · {loading && page === 0 ? '加载中' : `${total} 件商品`}</Text>{(query.keyword || category || query.campus || query.condition || query.minPrice !== undefined || query.maxPrice !== undefined) && <Text className='text-action' onClick={reset}>清空筛选</Text>}</View>
      {error && products.length === 0 ? <ErrorState message={error} retry={() => void load()} /> : <>
        {loading && !products.length ? <View className='product-grid'>{[0, 1, 2, 3].map((i) => <View key={i} className='skeleton' />)}</View> : !products.length ? <Empty title='暂时没有找到合适的好物' description='试试其他关键词或放宽筛选条件。' action={<Button className='secondary' onClick={reset}>重置筛选</Button>} /> : <ProductGrid products={products} />}
        {error && <View className='load-more'><Text>{error}</Text><Button className='secondary' onClick={() => void load(false)}>重试加载</Button></View>}
        {products.length > 0 && !error && <View className='load-more'>{loading ? '正在加载…' : page * query.pageSize >= total ? '已经看到全部好物了' : <Text onClick={() => void load(false)}>继续加载好物 ↓</Text>}</View>}
      </>}
    </LoginGate>
  </View>;
}
