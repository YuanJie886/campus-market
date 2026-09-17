import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import StorefrontIcon from '@mui/icons-material/Storefront';
import FilterBar from '../components/FilterBar';
import ProductGrid from '../components/ProductGrid';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_FILTER } from '../types';
import type { FilterState } from '../types';

/** 首页：Hero 横幅 + 筛选工具条 + 商品网格 */
export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { products } = useMarket();
  const { isAuthenticated } = useAuth();

  const keywordParam = searchParams.get('keyword') ?? '';

  const [filter, setFilter] = useState<FilterState>({
    ...DEFAULT_FILTER,
    keyword: keywordParam,
  });
  const [loading, setLoading] = useState(true);

  // URL 关键词变化时同步到筛选条件（支持顶部搜索框）
  useEffect(() => {
    setFilter((prev) =>
      prev.keyword === keywordParam ? prev : { ...prev, keyword: keywordParam },
    );
  }, [keywordParam]);

  // 首次加载模拟骨架屏
  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 420);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    const kw = filter.keyword.trim().toLowerCase();
    let list = products.filter((p) => p.status !== '已下架');

    // 关键词命中等级：2 = 标题命中，1 = 仅描述命中（无关键词时不参与排序）
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
    if (filter.category !== '全部') {
      list = list.filter((p) => p.category === filter.category);
    }
    if (filter.campus !== '全部') {
      list = list.filter((p) => p.campus === filter.campus);
    }
    if (filter.condition !== '全部') {
      list = list.filter((p) => p.condition === filter.condition);
    }
    if (filter.minPrice !== '') {
      list = list.filter((p) => p.price >= Number(filter.minPrice));
    }
    if (filter.maxPrice !== '') {
      list = list.filter((p) => p.price <= Number(filter.maxPrice));
    }

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
        // 默认「最新发布」：有关键词时优先展示标题命中的商品，同级再按发布时间降序；
        // 用户显式选择其它排序（priceAsc / priceDesc / views）时不做相关性加权干预。
        sorted.sort((a, b) => {
          if (kw) {
            const levelDiff =
              (matchLevel.get(b.id) ?? 0) - (matchLevel.get(a.id) ?? 0);
            if (levelDiff !== 0) return levelDiff;
          }
          return b.createdAt - a.createdAt;
        });
    }
    return sorted;
  }, [products, filter]);

  const onSaleCount = useMemo(
    () => products.filter((p) => p.status === '在售').length,
    [products],
  );

  // 价格区间校验：最低价与最高价均已填写且最低价高于最高价
  const priceInvalid = useMemo(
    () =>
      filter.minPrice !== '' &&
      filter.maxPrice !== '' &&
      Number(filter.minPrice) > Number(filter.maxPrice),
    [filter.minPrice, filter.maxPrice],
  );

  const handleReset = () => {
    setFilter({ ...DEFAULT_FILTER });
    navigate('/');
  };

  return (
    <div className="flex flex-col gap-5 md:gap-7">
      {/* Hero */}
      <section className="cm-hero relative overflow-hidden rounded-[28px] px-5 py-7 text-white shadow-[0_18px_44px_rgba(7,93,88,0.2)] md:px-10 md:py-10">
        <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-64 w-64 rounded-full bg-teal-200/10 blur-3xl" />
        <div className="relative grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-wide text-white/90 backdrop-blur">
              <StorefrontIcon sx={{ fontSize: 15 }} />
              校内闲置 · 当面交易 · 更安心
            </span>
            <h1 className="mt-4 text-[28px] font-black leading-tight tracking-tight md:text-[42px]">
              让闲置流动起来，
              <br className="hidden sm:block" />
              在校园里遇见新的主人
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/80 md:text-[15px]">
              教材、数码、生活好物……同校同学一键发布，毕业季清仓、开学季淘货都在这儿。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                variant="contained"
                size="large"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => navigate(isAuthenticated ? '/publish' : '/login')}
                sx={{
                  bgcolor: '#ffffff',
                  color: '#0d8a84',
                  '&:hover': { bgcolor: '#f0fdfa' },
                  borderRadius: 3,
                  px: 2.5,
                }}
              >
                发布我的闲置
              </Button>
              <span className="rounded-full border border-white/20 bg-black/10 px-3 py-2 text-sm text-white/80 backdrop-blur">
                当前在售 <b className="text-white">{onSaleCount}</b> 件好物
              </span>
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="rounded-[22px] border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                <span>Market pulse</span>
                <span className="rounded-full bg-emerald-300/20 px-2 py-1 text-emerald-100">实时更新</span>
              </div>
              <p className="mt-5 text-sm font-medium leading-6 text-white/75">
                今天也有新同学在校园里交换好物
              </p>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-black tracking-tight">{onSaleCount}</span>
                <span className="pb-1 text-xs text-white/60">件在售</span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                <span className="text-white/60">同校交易</span>
                <span className="font-bold text-emerald-100">优先匹配</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 筛选工具条 */}
      <FilterBar value={filter} onChange={setFilter} resultCount={filtered.length} />

      {/* 商品网格 */}
      <ProductGrid
        products={filtered}
        loading={loading}
        emptyTitle={priceInvalid ? '价格区间设置有误' : '没有找到相关闲置'}
        emptyDescription={
          priceInvalid
            ? '最低价不能高于最高价，请调整价格区间后再试～'
            : '试试更换关键词、切换分类，或放宽价格与成色条件～'
        }
        emptyAction={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outlined" onClick={handleReset}>
              重置筛选
            </Button>
            <Button
              variant="contained"
              onClick={() => navigate(isAuthenticated ? '/publish' : '/login')}
            >
              我要发布
            </Button>
          </div>
        }
      />
    </div>
  );
}
