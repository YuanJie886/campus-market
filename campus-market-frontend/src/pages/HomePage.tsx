import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ProductGrid from '../components/ProductGrid';
import FilterBar from '../components/FilterBar';
import { ScopeNotice, ScopeSwitch } from '../components/BuildingScopeBar';
import DemandEmptyStateCta from '../components/demand/DemandEmptyStateCta';
import EmptyState from '../components/EmptyState';
import { useBuildingFeed } from '../hooks/useBuildingFeed';
import { useCampusHasBuildings, useSchools } from '../hooks/useSchools';
import { getApiClient } from '../api/client';
import { CONTACT_REQUEST_PAGE_MAX, type ContactRequestStatus } from '../api/contracts';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_FILTER, SORT_OPTIONS } from '../types';
import type { FilterState, Product } from '../types';
import {
  EMPTY_DESCRIPTION,
  EMPTY_TITLE,
  MARKET_SCOPES,
  availableScopes,
  demandPrefillFor,
  effectiveScope,
  feedQueryFrom,
  readStoredScope,
  storeScope,
  usesFeed,
  type MarketScope,
} from '../utils/marketScope';

/**
 * 首页。未登录：说明产品是什么、怎么用的落地页；已登录：与小程序集市页相同的信息结构——
 * 紧凑标题 → 搜索 → 工具条（范围 / 分类 / 筛选与排序）→ 范围提示 → 结果。
 */
export default function HomePage() {
  const { isAuthenticated, authInitializing } = useAuth();
  if (isAuthenticated) return <MarketHome />;
  // 会话恢复期间不闪现落地页：登录用户刷新页面时，不应先看到「请登录」
  if (authInitializing) {
    return (
      <div className="cm-home" aria-busy="true">
        <p role="status" className="cm-visually-hidden">正在加载…</p>
      </div>
    );
  }
  return <Landing />;
}

/* ---------------------------------- 落地页 ---------------------------------- */

const STEPS: readonly { title: string; body: string }[] = [
  { title: '登录，看看本校在出什么', body: '按本楼、本校区或全校浏览，搜索教材、数码和生活好物。' },
  { title: '看中了，申请联系方式', body: '在商品页点「我想要」。卖家同意后，你才能看到对方留下的联系方式。' },
  { title: '自行联系，当面交易', body: '价格、时间和地点由你们自己约定，当面看货再决定。平台不经手任何钱款。' },
];

function Landing() {
  const navigate = useNavigate();
  return (
    <div className="cm-home cm-landing">
      <section className="cm-landing-hero" aria-labelledby="landing-title">
        <div className="cm-landing-copy">
          <p className="cm-eyebrow">校园集市 · 同校闲置</p>
          <h1 id="landing-title">同校同学的闲置，在这里展示和找到</h1>
          <p className="cm-landing-lead">
            卖家发布闲置，买家看中后申请联系方式，卖家同意后才会展示。之后双方自行沟通、线下当面交易。
          </p>
          <ul className="cm-landing-facts">
            <li>
              <strong>只展示同校商品</strong>
              <span>登录后看到的都是你所在学校的闲置。</span>
            </li>
            <li>
              <strong>联系方式默认不公开</strong>
              <span>卖家同意你的申请后才展示，同意可以撤回。</span>
            </li>
            <li>
              <strong>平台不交易、不支付</strong>
              <span>不建订单、不收款、不担保交易，价格与交易由双方自行约定。</span>
            </li>
          </ul>
        </div>

        <div className="cm-landing-cta">
          <h2>登录后查看本校在售好物</h2>
          <p>浏览、搜索、发布和申请联系方式都需要登录。</p>
          <button
            type="button"
            className="cm-button-primary cm-button-block"
            onClick={() => navigate('/login', { state: { from: '/' } })}
          >
            登录 / 注册
          </button>
          <p className="cm-landing-cta-note">
            还没有账号？<Link to="/register" className="cm-link">注册新账号</Link>
          </p>
          <p className="cm-landing-legal">
            使用前请阅读<Link to="/terms" className="cm-link">《用户协议》</Link>和<Link to="/privacy" className="cm-link">《隐私政策》</Link>
          </p>
        </div>
      </section>

      <section className="cm-landing-steps" aria-labelledby="landing-steps-title">
        <h2 id="landing-steps-title">三步用起来</h2>
        <ol>
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="cm-step-num" aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="cm-landing-footnote">学校信息由用户填写，平台目前不核验学籍或身份。</p>
      </section>
    </div>
  );
}

/* --------------------------------- 已登录集市 --------------------------------- */

function filterLocally(products: Product[], filter: FilterState): Product[] {
  const kw = filter.keyword.trim().toLowerCase();
  let list = products.filter((p) => p.status !== '已下架');
  const matchLevel = new Map<string, number>();

  if (kw) {
    list = list.filter((p) => {
      const titleHit = p.title.toLowerCase().includes(kw);
      const descHit = p.description.toLowerCase().includes(kw);
      if (!titleHit && !descHit) return false;
      matchLevel.set(p.id, titleHit ? 2 : 1);
      return true;
    });
  }
  if (filter.category !== '全部') list = list.filter((p) => p.category === filter.category);
  if (filter.campus !== '全部') list = list.filter((p) => p.campus === filter.campus);
  if (filter.condition !== '全部') list = list.filter((p) => p.condition === filter.condition);
  if (filter.minPrice !== '') list = list.filter((p) => p.price >= Number(filter.minPrice));
  if (filter.maxPrice !== '') list = list.filter((p) => p.price <= Number(filter.maxPrice));

  const sorted = [...list];
  switch (filter.sort) {
    case 'priceAsc':
      sorted.sort((a, b) => a.price - b.price);
      break;
    case 'priceDesc':
      sorted.sort((a, b) => b.price - a.price);
      break;
    case 'views':
      sorted.sort((a, b) => b.views - a.views);
      break;
    default:
      sorted.sort((a, b) => {
        if (kw) {
          const levelDiff = (matchLevel.get(b.id) ?? 0) - (matchLevel.get(a.id) ?? 0);
          if (levelDiff !== 0) return levelDiff;
        }
        return b.createdAt - a.createdAt;
      });
  }
  return sorted;
}

/** 本人发出的联系申请（最近 50 条）：卡片上标出「已申请联系 / 卖家已同意」。拿不到就不显示，不影响浏览 */
function useSentContactStatuses(userId: string | undefined): ReadonlyMap<string, ContactRequestStatus> {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ContactRequestStatus>>(new Map());
  useEffect(() => {
    let active = true;
    setStatuses(new Map());
    if (!userId) return;
    getApiClient()
      .listContactRequests({ role: 'sent', size: CONTACT_REQUEST_PAGE_MAX })
      .then((page) => {
        if (!active) return;
        const map = new Map<string, ContactRequestStatus>();
        // 列表按更新时间倒序：同一件商品只取最新的一条
        for (const request of page.items) if (!map.has(request.productId)) map.set(request.productId, request.status);
        setStatuses(map);
      })
      .catch(() => undefined);
    return () => { active = false };
  }, [userId]);
  return statuses;
}

function MarketHome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { products, loading } = useMarket();
  const { currentUser } = useAuth();
  const { campusLabel, campusChoicesFor } = useSchools();
  // 本人校区还没有楼栋时不提供「本楼」（本校区 / 全校照常）
  const buildingsAvailable = useCampusHasBuildings(currentUser?.campus);
  const scopes = availableScopes(buildingsAvailable);

  const keywordParam = searchParams.get('keyword') ?? '';
  const [filter, setFilter] = useState<FilterState>({ ...DEFAULT_FILTER, keyword: keywordParam });
  const [draft, setDraft] = useState(keywordParam);

  useEffect(() => {
    setFilter((prev) => (prev.keyword === keywordParam ? prev : { ...prev, keyword: keywordParam }));
    setDraft(keywordParam);
  }, [keywordParam]);

  // ---- 范围：本楼 / 本校区 / 全校（默认全校 = 原来的普通浏览） ----
  const [storedScope, setScopeState] = useState<MarketScope>(readStoredScope);
  const scope = effectiveScope(storedScope, scopes);
  const setScope = (next: MarketScope) => {
    setScopeState(next);
    storeScope(next);
  };
  const scopeFeed = usesFeed(scope);

  const priceInvalid =
    filter.minPrice !== '' && filter.maxPrice !== '' && Number(filter.minPrice) > Number(filter.maxPrice);

  // 「全校」完全走原来的本地筛选流；「本楼 / 本校区」才请求 feed 端点
  const filtered = useMemo(() => filterLocally(products, filter), [products, filter]);
  const feedQuery = useMemo(
    () => (scopeFeed && !priceInvalid ? feedQueryFrom(filter, scope, 1) : null),
    [scopeFeed, priceInvalid, filter, scope],
  );
  const feed = useBuildingFeed(feedQuery);
  const contactStatuses = useSentContactStatuses(currentUser?.id);

  const displayed: Product[] = scopeFeed ? feed.items : filtered;
  const total = scopeFeed ? (feed.page?.total ?? 0) : filtered.length;
  const listLoading = scopeFeed ? feed.status === 'loading' || (feed.status === 'idle' && !priceInvalid) : loading;
  const action = scopeFeed ? feed.action : null;
  const loadError = scopeFeed && feed.status === 'error' && !feed.action;
  const isEmpty = !listLoading && !action && !loadError && displayed.length === 0;

  const demandPrefill = useMemo(
    () => demandPrefillFor(filter, scope, currentUser?.campus ?? ''),
    [filter, scope, currentUser?.campus],
  );

  const keyword = filter.keyword.trim();
  const hasFilter =
    !!keyword ||
    filter.category !== '全部' ||
    (!scopeFeed && filter.campus !== '全部') ||
    filter.condition !== '全部' ||
    filter.minPrice !== '' ||
    filter.maxPrice !== '' ||
    filter.sort !== DEFAULT_FILTER.sort;
  const sortLabel = SORT_OPTIONS.find((option) => option.value === filter.sort)?.label;
  // 「本楼」放宽后，结果条写实际展示的范围（提示里已说明放宽的原因）
  const scopeLabel = scopeFeed && feed.page?.fallbackApplied
    ? feed.page.effectiveScopeLabel
    : MARKET_SCOPES.find((s) => s.key === scope)?.label;
  const onSaleCount = products.filter((p) => p.status === '在售').length;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const kw = draft.trim();
    navigate(kw ? `/?keyword=${encodeURIComponent(kw)}` : '/');
  };
  const clearSearch = () => {
    setDraft('');
    navigate('/');
  };
  const handleReset = () => {
    setFilter({ ...DEFAULT_FILTER });
    setDraft('');
    navigate('/');
  };

  return (
    <div className="cm-home">
      <header className="cm-home-head">
        <div className="cm-home-title">
          <h1>校园集市</h1>
          <p>
            {currentUser?.campus ? campusLabel(currentUser.campus) : '本校'}
            {!loading && <> · 本校在售 {onSaleCount} 件</>}
          </p>
        </div>
        <form role="search" className="cm-search" onSubmit={submitSearch}>
          <SearchIcon sx={{ fontSize: 20 }} className="cm-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="搜索你想要的闲置好物…"
            aria-label="搜索商品"
            enterKeyHint="search"
            className="cm-search-input"
          />
          {draft && (
            <button type="button" className="cm-search-clear" aria-label="清空搜索" onClick={clearSearch}>
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </button>
          )}
          <button type="submit" className="cm-search-submit">搜索</button>
        </form>
      </header>

      <FilterBar
        value={filter}
        onChange={setFilter}
        hideCampus={scopeFeed}
        campusOptions={campusChoicesFor(currentUser?.campus)}
        leading={<ScopeSwitch value={scope} onChange={setScope} scopes={scopes} />}
      />

      {scopeFeed && <ScopeNotice feed={feed} />}

      {/* 「去登录 / 去设置宿舍楼」时只给引导，不给结果区、空态或订阅入口（与小程序一致） */}
      {!action && (
        <section className="cm-results" aria-labelledby="results-title">
          <div className="cm-results-bar">
            <h2 id="results-title" className="cm-results-title">
              {keyword ? `「${keyword}」的搜索结果` : '商品列表'}
            </h2>
            <p className="cm-results-meta">
              {listLoading ? '加载中' : `共 ${total} 件`}
              <span aria-hidden="true"> · </span>
              {scopeLabel}
              {filter.category !== '全部' && <> · {filter.category}</>}
              <span aria-hidden="true"> · </span>
              {sortLabel}
            </p>
            {hasFilter && (
              <button type="button" className="cm-text-button cm-results-reset" onClick={handleReset}>
                清空筛选
              </button>
            )}
          </div>

          {loadError ? (
            <EmptyState
              title="暂时无法加载"
              description={feed.errorMessage ?? '加载失败'}
              action={<button type="button" className="cm-button-secondary" onClick={feed.reload}>重新加载</button>}
            />
          ) : priceInvalid ? (
            <EmptyState
              title="价格区间设置有误"
              description="最低价不能高于最高价，请调整后再试。"
              action={<button type="button" className="cm-button-secondary" onClick={handleReset}>重置筛选</button>}
            />
          ) : (
            <ProductGrid
              products={displayed}
              loading={listLoading}
              contactStatuses={contactStatuses}
              emptyTitle={EMPTY_TITLE}
              emptyDescription={EMPTY_DESCRIPTION}
              emptyAction={hasFilter ? <button type="button" className="cm-button-secondary" onClick={handleReset}>重置筛选</button> : undefined}
            />
          )}

          {scopeFeed && feed.status === 'ready' && displayed.length > 0 && (
            <div className="cm-load-more">
              {feed.errorMessage ? (
                <>
                  <span>{feed.errorMessage}</span>
                  <button type="button" className="cm-button-secondary" onClick={feed.loadMore}>重试加载</button>
                </>
              ) : feed.hasMore ? (
                <button type="button" className="cm-button-secondary" onClick={feed.loadMore} disabled={feed.loadingMore}>
                  {feed.loadingMore ? '正在加载…' : '加载更多'}
                </button>
              ) : (
                <span>已经看到全部好物了</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* 搜索空态的订阅入口：用户刚表达了一个没被满足的需求，这时问一句最自然（组件常驻，以便登录回来恢复草稿） */}
      <DemandEmptyStateCta prefill={demandPrefill} showCta={isEmpty && !priceInvalid} />
    </div>
  );
}
