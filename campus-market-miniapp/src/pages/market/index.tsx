import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { Button, Input, ScrollView, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { CAMPUSES, CATEGORIES, CATEGORY_EMOJI, CONDITIONS, type Campus, type Category, type Condition, type Product, type Query, type Sort } from '../../model';
import { ErrorState, LoginGate, ProductGrid, Empty } from '../../components';
import { notify, useMarket } from '../../state';

type SortKey = 'latest' | 'price' | 'views';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'price', label: '价格' },
  { key: 'views', label: '浏览' },
];
const isPriceSort = (sort: Sort) => sort === 'priceAsc' || sort === 'priceDesc';

export default function MarketPage() {
  const { user, ready } = useMarket();
  const [keyword, setKeyword] = useState(''), [category, setCategory] = useState<Category | ''>('');
  const [query, setQuery] = useState<Query>({ sort: 'latest', page: 1, pageSize: 12 });
  const [products, setProducts] = useState<Product[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const [min, setMin] = useState(''), [max, setMax] = useState(''), [pending, setPending] = useState(0);
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

  const loadPending = async () => {
    if (!user) { setPending(0); return; }
    try {
      const values = await api.contacts();
      const count = values.filter((r) => r.sellerId === user.id && r.status === 'PENDING').length;
      setPending(count);
      if (process.env.TARO_ENV === 'weapp') {
        if (count > 0) void Taro.setTabBarBadge({ index: 2, text: String(count) }).catch(() => undefined);
        else void Taro.removeTabBarBadge({ index: 2 }).catch(() => undefined);
      }
    } catch { /* 未读数失败不影响主流程 */ }
  };

  useEffect(() => { generation.current++; busy.current = false; setProducts([]); setTotal(0); setPage(0); void load(); }, [user?.id, ready, query, category]);
  useDidShow(() => { void load(); void loadPending(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useReachBottom(() => { if (page * query.pageSize < total) void load(false); });

  const patchQuery = (part: Partial<Query>) => setQuery((previous) => ({ ...previous, ...part, page: 1 }));
  const reset = () => { setKeyword(''); setCategory(''); setMin(''); setMax(''); setQuery({ sort: 'latest', page: 1, pageSize: 12 }); };
  const applyPrice = () => {
    const minPrice = min === '' ? undefined : Number(min), maxPrice = max === '' ? undefined : Number(max);
    if ((minPrice !== undefined && (!Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) { notify('请填写有效的价格区间'); return; }
    patchQuery({ minPrice, maxPrice });
  };
  const sortKey: SortKey = isPriceSort(query.sort) ? 'price' : query.sort === 'views' ? 'views' : 'latest';
  const filterCount = [query.campus, query.condition, query.minPrice, query.maxPrice].filter((v) => v !== undefined).length;
  const hasFilter = Boolean(query.keyword || category || filterCount);

  return <View className='page market-page'>
    <View className='topbar'>
      <Text className='topbar-title'>校园集市</Text>
      <View className='topbar-right'>
        <View className='campus-pill'><Text>{user?.campus ?? '本校'}</Text><View className='i-chevron' /></View>
        <View className='bell' onClick={() => void Taro.switchTab({ url: '/pages/notifications/index' })}>
          <View className='i-bell' />
          {pending > 0 && <Text className='badge'>{pending > 99 ? '99+' : pending}</Text>}
        </View>
      </View>
    </View>

    <View className='search-row'>
      <View className='search-bar'>
        <View className='i-search' />
        <Input className='search-input' value={keyword} placeholder='搜索教材、数码、生活好物' placeholderClass='search-input-placeholder' confirmType='search' onInput={(e) => setKeyword(e.detail.value)} onConfirm={() => patchQuery({ keyword: keyword.trim() || undefined })} />
      </View>
      <View className={`filter-btn ${expanded || filterCount ? 'active' : ''}`} onClick={() => setExpanded(!expanded)}>
        <View className='i-filter' />
        {filterCount > 0 && <Text className='filter-count'>{filterCount}</Text>}
      </View>
    </View>

    <LoginGate returnTo='/pages/market/index'>
      <ScrollView scrollX className='chips-scroll'>
        <View className='chips'>
          {(['', ...CATEGORIES] as const).map((cat) => <Text key={cat || 'all'} className={`chip ${category === cat ? 'active' : ''}`} onClick={() => setCategory(cat)}>
            {cat ? <Text className='chip-emoji'>{CATEGORY_EMOJI[cat as Category]}</Text> : null}{cat || '全部'}
          </Text>)}
        </View>
      </ScrollView>

      <View className='sort-row'>
        <View className='sort-tabs'>
          {SORTS.map((s) => <Text key={s.key} className={`sort-tab ${sortKey === s.key ? 'active' : ''}`} onClick={() => {
            if (s.key === 'price') patchQuery({ sort: isPriceSort(query.sort) ? (query.sort === 'priceAsc' ? 'priceDesc' : 'priceAsc') : 'priceAsc' });
            else patchQuery({ sort: s.key as Sort });
          }}>
            {s.label}{s.key === 'price' && <Text className='sort-arrow'>{isPriceSort(query.sort) ? (query.sort === 'priceAsc' ? '↑' : '↓') : '⇅'}</Text>}
          </Text>)}
        </View>
        <Text className='count-text'>{loading && page === 0 ? '加载中' : `共 ${total} 件`}</Text>
      </View>

      {expanded && <View className='filter-panel'>
        <View className='filter-group'>
          <Text className='filter-label'>校区</Text>
          <View className='filter-chips'>
            <Text className={`filter-chip ${!query.campus ? 'active' : ''}`} onClick={() => patchQuery({ campus: undefined })}>全部</Text>
            {CAMPUSES.map((c) => <Text key={c} className={`filter-chip ${query.campus === c ? 'active' : ''}`} onClick={() => patchQuery({ campus: c as Campus })}>{c}</Text>)}
          </View>
        </View>
        <View className='filter-group'>
          <Text className='filter-label'>成色</Text>
          <View className='filter-chips'>
            <Text className={`filter-chip ${!query.condition ? 'active' : ''}`} onClick={() => patchQuery({ condition: undefined })}>不限</Text>
            {CONDITIONS.map((c) => <Text key={c} className={`filter-chip ${query.condition === c ? 'active' : ''}`} onClick={() => patchQuery({ condition: c as Condition })}>{c}</Text>)}
          </View>
        </View>
        <View className='filter-group'>
          <Text className='filter-label'>价格区间</Text>
          <View className='price-inputs'>
            <Input type='digit' value={min} placeholder='最低价' onInput={(e) => setMin(e.detail.value)} onBlur={applyPrice} onConfirm={applyPrice} />
            <Text className='price-sep'>—</Text>
            <Input type='digit' value={max} placeholder='最高价' onInput={(e) => setMax(e.detail.value)} onBlur={applyPrice} onConfirm={applyPrice} />
          </View>
        </View>
        <View className='button-row'><Button className='secondary' onClick={reset}>重置全部</Button><Button className='primary' onClick={() => setExpanded(false)}>收起</Button></View>
      </View>}

      {hasFilter && <View className='sort-row filter-summary'>
        <Text className='count-text'>{query.keyword ? `「${query.keyword}」` : ''}{category ? ` ${category}` : ''}{query.campus ? ` · ${query.campus}` : ''}{query.condition ? ` · ${query.condition}` : ''}</Text>
        <Text className='text-action' onClick={reset}>清空筛选</Text>
      </View>}

      {error && products.length === 0 ? <ErrorState message={error} retry={() => void load()} /> : <>
        {loading && !products.length ? <View className='product-grid'>{[0, 1, 2, 3].map((i) => <View key={i} className='skeleton' />)}</View> : !products.length ? <Empty title='暂时没有找到合适的好物' description='换个关键词，或者放宽筛选条件试试。' action={<Button className='secondary' onClick={reset}>重置筛选</Button>} /> : <ProductGrid products={products} />}
        {error && <View className='load-more'><Text>{error}</Text><Button className='secondary small' onClick={() => void load(false)}>重试加载</Button></View>}
        {products.length > 0 && !error && <View className='load-more'>{loading ? '正在加载…' : page * query.pageSize >= total ? '已经看到全部好物了' : '上拉加载更多'}</View>}
      </>}
    </LoginGate>
  </View>;
}
