import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { Button, Input, ScrollView, Text, View } from '@tarojs/components';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { CATEGORIES, CATEGORY_EMOJI, CONDITIONS, type Category, type Condition, type DemandConditions, type FeedPage, type Product, type Query, type Sort } from '../../model';
import { ErrorState, LoginGate, ProductGrid, Empty } from '../../components';
import { demandUnread, goLogin, notify, useMarket, useSchools, useUnread } from '../../state';
import { badgeText } from '../../contacts';
import { DORM_NEEDED, LOGIN_NEEDED, effectiveScope, marketScopes, feedAction, feedNotice, feedQueryFrom, usesFeed, type MarketScope } from '../../feed';
import { EMPTY_CTA, demandPrefill, subscribeResultText } from '../../demand';
import { DEMAND_PAGES, PAGES } from '../../menu';
import { DemandForm } from '../../widgets/DemandForm';

type SortKey = 'latest' | 'price' | 'views';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'price', label: '价格' },
  { key: 'views', label: '浏览' },
];
const isPriceSort = (sort: Sort) => sort === 'priceAsc' || sort === 'priceDesc';

export default function MarketPage() {
  const { user, ready } = useMarket(), { catalog } = useSchools();
  // 本人校区还没有启用的楼栋时不显示「本楼」；校区筛选只列本校的校区
  const campusHasBuildings = catalog.hasBuildings(user?.campus), scopes = marketScopes(campusHasBuildings), campuses = catalog.campusOptions(user?.campus);
  const [keyword, setKeyword] = useState(''), [category, setCategory] = useState<Category | ''>('');
  const [query, setQuery] = useState<Query>({ sort: 'latest', page: 1, pageSize: 12 });
  const [products, setProducts] = useState<Product[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const [min, setMin] = useState(''), [max, setMax] = useState('');
  // 范围：本楼 / 本校区 / 全校（默认全校 = 原来的普通浏览）
  const [scope, setScope] = useState<MarketScope>('SCHOOL'), [feedPage, setFeedPage] = useState<FeedPage | null>(null), [action, setAction] = useState<'login' | 'set-dorm-building' | null>(null);
  const [subscribing, setSubscribing] = useState(false), [subscribeBusy, setSubscribeBusy] = useState(false), [subscribeError, setSubscribeError] = useState('');
  const pending = badgeText(useUnread().total);
  useEffect(() => { const next = effectiveScope(scope, campusHasBuildings); if (next !== scope) setScope(next); }, [scope, campusHasBuildings]);
  const generation = useRef(0), busy = useRef(false), identity = useRef(user?.id);
  identity.current = user?.id;

  const load = async (reset = true) => {
    if (!user || !ready || (!reset && busy.current)) return;
    const request = ++generation.current, uid = user.id;
    busy.current = true; setLoading(true); setError(''); setAction(null);
    try {
      const nextPage = reset ? 1 : page + 1;
      const feed = usesFeed(scope) ? await api.feed(feedQueryFrom(query, category, scope, nextPage)) : null;
      const batch = feed ?? await api.list({ ...query, category: category || undefined, page: nextPage });
      if (request !== generation.current || uid !== identity.current) return;
      setFeedPage(feed);
      setProducts((previous) => reset ? batch.items.filter((p) => p.status !== '已下架') : [...previous, ...batch.items.filter((p) => !previous.some((old) => old.id === p.id) && p.status !== '已下架')]);
      setTotal(batch.total); setPage(batch.page);
    } catch (e) {
      if (request !== generation.current || uid !== identity.current) return;
      // 401 / 409 不是「出错了」，而是「还差一步」：给出可执行的引导
      const next = usesFeed(scope) ? feedAction(e) : null;
      if (next) { setAction(next); setProducts([]); setTotal(0); setFeedPage(null); } else setError(e instanceof Error ? e.message : '加载失败');
    }
    finally { if (request === generation.current) { busy.current = false; setLoading(false); } }
  };

  useEffect(() => { generation.current++; busy.current = false; setProducts([]); setTotal(0); setPage(0); setFeedPage(null); void load(); }, [user?.id, ready, query, category, scope]);
  useDidShow(() => { void load(); });
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
  const filterCount = [usesFeed(scope) ? undefined : query.campus, query.condition, query.minPrice, query.maxPrice].filter((v) => v !== undefined).length;
  const notice = feedNotice(feedPage);
  const prefill = useMemo<DemandConditions>(() => demandPrefill({ keyword: query.keyword, category, minPrice: query.minPrice, maxPrice: query.maxPrice, campus: query.campus }, scope, user?.campus ?? ''), [query, category, scope, user?.campus]);
  const subscribe = async (conditions: DemandConditions) => {
    setSubscribeBusy(true); setSubscribeError('');
    try {
      const result = await api.createSubscription(conditions);
      setSubscribing(false);
      const answer = await Taro.showModal({ title: '需求订阅', content: subscribeResultText(result), confirmText: '管理订阅', cancelText: '知道了', confirmColor: '#194e41' });
      void demandUnread.refresh();
      if (answer.confirm) void Taro.navigateTo({ url: `${DEMAND_PAGES.inbox}?tab=subscriptions` });
    } catch (e) { setSubscribeError(e instanceof Error ? e.message : '订阅失败，请重试'); }
    finally { setSubscribeBusy(false); }
  };
  const hasFilter = Boolean(query.keyword || category || filterCount);

  return <View className='page market-page'>
    <View className='topbar'>
      <Text className='topbar-title'>校园集市</Text>
      <View className='topbar-right'>
        <View className='campus-pill'><Text>{user ? catalog.campusLabel(user.campus) : '本校'}</Text><View className='i-chevron' /></View>
        <View className='bell' onClick={() => void Taro.switchTab({ url: '/pages/notifications/index' })}>
          <View className='i-bell' />
          {pending ? <Text className='badge'>{pending}</Text> : null}
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
      <View className='segmented scope-switch'>
        {scopes.map((s) => <Text key={s.key} className={scope === s.key ? 'selected' : ''} onClick={() => setScope(s.key)}>{s.label}</Text>)}
      </View>
      {action === 'login' ? <View className='notice'><Text>{LOGIN_NEEDED}</Text><Text className='text-action' onClick={() => goLogin('/pages/market/index')}>去登录</Text></View> : null}
      {action === 'set-dorm-building' ? <View className='notice'><Text>{DORM_NEEDED}</Text><Text className='text-action' onClick={() => void Taro.navigateTo({ url: PAGES.profileEdit })}>去设置</Text></View> : null}
      {notice ? <View className='notice'><Text>{notice}</Text></View> : null}
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
        {!usesFeed(scope) && <View className='filter-group'>
          <Text className='filter-label'>校区</Text>
          <View className='filter-chips'>
            <Text className={`filter-chip ${!query.campus ? 'active' : ''}`} onClick={() => patchQuery({ campus: undefined })}>全部</Text>
            {campuses.map((c) => <Text key={c.id} className={`filter-chip ${query.campus === c.id ? 'active' : ''}`} onClick={() => patchQuery({ campus: c.id })}>{c.name}</Text>)}
          </View>
        </View>}
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
        <Text className='count-text'>{query.keyword ? `「${query.keyword}」` : ''}{category ? ` ${category}` : ''}{query.campus ? ` · ${catalog.campusLabel(query.campus)}` : ''}{query.condition ? ` · ${query.condition}` : ''}</Text>
        <Text className='text-action' onClick={reset}>清空筛选</Text>
      </View>}

      {error && products.length === 0 ? <ErrorState message={error} retry={() => void load()} /> : <>
        {loading && !products.length ? <View className='product-grid'>{[0, 1, 2, 3].map((i) => <View key={i} className='skeleton' />)}</View> : !products.length ? <>
          {!action && <Empty title='暂时没有找到合适的好物' description='换个关键词，或者放宽筛选条件试试。' action={<Button className='secondary' onClick={reset}>重置筛选</Button>} />}
          {/* 搜索空态的订阅入口：用户刚表达了一个没被满足的需求，这时问一句最自然 */}
          {!action && (subscribing
            ? <DemandForm title='订阅这个需求' submitLabel='确认订阅' initial={prefill} userCampus={user?.campus ?? ''} busy={subscribeBusy} errorMessage={subscribeError} onCancel={() => setSubscribing(false)} onSubmit={(c) => void subscribe(c)} />
            : <View className='demand-cta'><Text className='muted'>{EMPTY_CTA}</Text><Button className='primary small' onClick={() => { setSubscribeError(''); setSubscribing(true); }}>订阅这个需求</Button></View>)}
        </> : <ProductGrid products={products} />}
        {error && <View className='load-more'><Text>{error}</Text><Button className='secondary small' onClick={() => void load(false)}>重试加载</Button></View>}
        {products.length > 0 && !error && <View className='load-more'>{loading ? '正在加载…' : page * query.pageSize >= total ? '已经看到全部好物了' : '上拉加载更多'}</View>}
      </>}
    </LoginGate>
  </View>;
}
