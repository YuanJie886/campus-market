import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowOutwardRoundedIcon from '@mui/icons-material/ArrowOutwardRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import VerifiedIcon from '@mui/icons-material/Verified';
import NearMeOutlinedIcon from '@mui/icons-material/NearMeOutlined';
import RecyclingOutlinedIcon from '@mui/icons-material/RecyclingOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ProductGrid from '../components/ProductGrid';
import FilterBar from '../components/FilterBar';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_FILTER } from '../types';
import type { FilterState, Product } from '../types';

const HERO_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=88',
  'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=1200&q=88',
  'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=88',
];

const STORY_STEPS = [
  {
    index: '01',
    eyebrow: 'PROXIMITY · 校园同心圆',
    title: '好东西，\n不必走远。',
    copy: '15 分钟步行生活圈。从同学的书桌、衣柜和宿舍里，找到正在等待下一段生活的闲置物品，无需快递包装，校内当面完成验货与交接。',
    tag: '零包装浪费 · 步行即达',
  },
  {
    index: '02',
    eyebrow: 'AUTHENTICITY · 真实成色与学子背书',
    title: '少一点搜索，\n多一点笃定。',
    copy: '全量通过校园统一身份认证。真实学号与邮箱背书，实物原貌诚实呈现，电池健康度、划痕瑕疵透明披露，告别网络交易的信息不对称。',
    tag: '实名学子 · 原图实拍',
  },
  {
    index: '03',
    eyebrow: 'CIRCULATION · 绿色可持续循环',
    title: '一件闲置，\n重新被需要。',
    copy: '每一次在校内的循环交接，平均减少 1.8kg 生产与运输碳足迹，累计帮助同学节省 65% 生活预算。让美好物品在不同年级间温暖接力。',
    tag: '年级接力 · 减碳生活',
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { products, loading } = useMarket();
  const { isAuthenticated } = useAuth();

  // 节点引用
  const heroRef = useRef<HTMLElement | null>(null);
  const storyRef = useRef<HTMLElement | null>(null);
  const storyStepRefs = useRef<(HTMLElement | null)[]>([]);
  const heroWashRef = useRef<HTMLDivElement | null>(null);
  const heroCopyRef = useRef<HTMLDivElement | null>(null);
  const heroProductRef = useRef<HTMLDivElement | null>(null);
  const scrollLineRef = useRef<HTMLElement | null>(null);

  // 动效插值状态
  const targetProgressRef = useRef(0);
  const renderedProgressRef = useRef(0);
  const motionFrameRef = useRef<number | null>(null);

  // 当前叙事步骤与 Hero 展台选中的高光展品
  const [activeStory, setActiveStory] = useState(0);
  const [heroSpotlightIndex, setHeroSpotlightIndex] = useState(0);

  const keywordParam = searchParams.get('keyword') ?? '';
  const [filter, setFilter] = useState<FilterState>({
    ...DEFAULT_FILTER,
    keyword: keywordParam,
  });

  useEffect(() => {
    setFilter((prev) =>
      prev.keyword === keywordParam ? prev : { ...prev, keyword: keywordParam },
    );
  }, [keywordParam]);

  // 平滑滚动驱动引擎 (Apple-Grade RequestAnimationFrame Smooth Lerp)
  useEffect(() => {
    const clamp = (val: number) => Math.min(1, Math.max(0, val));

    const updateTargetProgress = () => {
      const section = heroRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(section.offsetHeight - window.innerHeight, 1);
      targetProgressRef.current = clamp(-rect.top / travel);

      if (motionFrameRef.current === null) {
        motionFrameRef.current = requestAnimationFrame(renderMotion);
      }
    };

    const renderMotion = () => {
      const target = targetProgressRef.current;
      const current = renderedProgressRef.current;
      const next = current + (target - current) * 0.12;
      const progress = Math.abs(target - next) < 0.001 ? target : next;
      renderedProgressRef.current = progress;

      // Hero 背景光照漫反射缩放与位移
      if (heroWashRef.current) {
        heroWashRef.current.style.setProperty(
          'transform',
          `translate3d(0, ${progress * 14}%, 0) scale(${1 + progress * 0.12})`,
        );
      }

      // Hero 文字区域：深度向内推进与平滑淡出
      if (heroCopyRef.current) {
        heroCopyRef.current.style.setProperty('opacity', `${Math.max(0, 1 - progress * 1.25)}`);
        heroCopyRef.current.style.setProperty(
          'transform',
          `translate3d(0, ${progress * -50}px, ${progress * -80}px) scale(${1 - progress * 0.06})`,
        );
      }

      // Hero 展台卡片：带轻微 3D 俯仰与空间退后
      if (heroProductRef.current) {
        heroProductRef.current.style.setProperty(
          'transform',
          `translate3d(${progress * -30}px, ${progress * -36}px, ${progress * -60}px) scale(${1 - progress * 0.08}) rotateX(${progress * 6}deg) rotateY(${progress * -4}deg)`,
        );
      }

      // 滚动指示进度条
      if (scrollLineRef.current) {
        scrollLineRef.current.style.setProperty(
          'transform',
          `scaleX(${Math.max(0.18, progress)})`,
        );
      }

      if (Math.abs(target - progress) >= 0.001) {
        motionFrameRef.current = requestAnimationFrame(renderMotion);
      } else {
        motionFrameRef.current = null;
      }
    };

    updateTargetProgress();
    window.addEventListener('scroll', updateTargetProgress, { passive: true });
    window.addEventListener('resize', updateTargetProgress);

    return () => {
      if (motionFrameRef.current !== null) {
        cancelAnimationFrame(motionFrameRef.current);
      }
      window.removeEventListener('scroll', updateTargetProgress);
      window.removeEventListener('resize', updateTargetProgress);
    };
  }, []);

  // 叙事模块观察器：滚动到达步骤时同步激活展示台
  useEffect(() => {
    const stepEls = storyStepRefs.current.filter(Boolean);
    if (!stepEls.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-step-index') ?? 0);
            setActiveStory(index);
          }
        });
      },
      {
        root: null,
        rootMargin: '-30% 0px -40% 0px',
        threshold: 0.2,
      },
    );

    stepEls.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // 筛选与排序
  const filtered = useMemo(() => {
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
  }, [products, filter]);

  // 从真实商品中提取 3 件代表性旗舰好物作为 Hero 展台
  const spotlightItems: Product[] = useMemo(() => {
    const onSale = products.filter((p) => p.status === '在售');
    const tech = onSale.find((p) => p.category === '数码电子') ?? onSale[0];
    const sportsOrLife = onSale.find((p) => p.category === '运动户外' || p.category === '生活用品') ?? onSale[1];
    const bookOrCloth = onSale.find((p) => p.category === '教材书籍' || p.category === '服饰鞋包') ?? onSale[2];
    return [tech, sportsOrLife, bookOrCloth].filter(Boolean) as Product[];
  }, [products]);

  const currentHeroItem = spotlightItems[heroSpotlightIndex] ?? spotlightItems[0] ?? products[0];
  const heroImages = currentHeroItem?.images?.length ? currentHeroItem.images : HERO_FALLBACK_IMAGES;
  const onSaleCount = products.filter((p) => p.status === '在售').length;

  const priceInvalid =
    filter.minPrice !== '' &&
    filter.maxPrice !== '' &&
    Number(filter.minPrice) > Number(filter.maxPrice);

  const goToPublish = () => navigate(isAuthenticated ? '/publish' : '/login');
  const handleReset = () => {
    setFilter({ ...DEFAULT_FILTER });
    navigate('/');
  };

  const scrollToStep = (index: number) => {
    const targetEl = storyStepRefs.current[index];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="cm-apple-home-root">
      {/* =========================================================================
          MODULE 1: 沉浸式发布会级 HERO 展台 (Immersive Keynote Stage)
         ========================================================================= */}
      <section ref={heroRef} className="cm-apple-hero-stage" aria-labelledby="hero-title">
        {/* 动态光晕与微米级暗纹经纬网格 */}
        <div ref={heroWashRef} className="cm-apple-hero-wash" />
        <div className="cm-apple-hero-lattice" />

        <div className="cm-apple-hero-container">
          {/* 顶部发布会规格状态栏 */}
          <div className="cm-apple-hero-statusbar">
            <div className="cm-apple-hero-brand-tag">
              <span className="cm-apple-pulse-dot" />
              <span>CAMPUS / MARKET · KEYNOTE 2026</span>
            </div>
            <div className="cm-apple-hero-stats-pill">
              <span>{onSaleCount || '1,400+'} 件好物在线</span>
              <span className="cm-apple-dot-sep">·</span>
              <span>4 个校区极速面交</span>
              <span className="cm-apple-dot-sep">·</span>
              <span>学子实名认证</span>
            </div>
          </div>

          {/* 主版面：左侧排版叙事 + 右侧 3D 旗舰产品互动展具 */}
          <div className="cm-apple-hero-grid">
            {/* 左侧：巨幕排版 */}
            <div ref={heroCopyRef} className="cm-apple-hero-content">
              <p className="cm-apple-eyebrow">A NEW RHYTHM FOR YOUR DORM & DESK</p>
              <h1 id="hero-title" className="cm-apple-hero-title">
                把闲置，
                <span className="cm-apple-silver-text">交给下一段生活。</span>
              </h1>
              <p className="cm-apple-hero-subtext">
                无需跨越城市，好东西就在隔壁宿舍与图书馆。
                <br className="hidden sm:inline" />
                当面验货、即刻交接，用纯粹的克制与优雅，重新定义校园二手循环。
              </p>

              {/* 行为召唤动作组 */}
              <div className="cm-apple-hero-cta-group">
                <Button
                  onClick={() =>
                    document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' })
                  }
                  variant="contained"
                  className="cm-apple-primary-cta"
                  endIcon={<ArrowDownwardRoundedIcon />}
                >
                  探索校园好物
                </Button>
                <button
                  type="button"
                  onClick={goToPublish}
                  className="cm-apple-secondary-cta"
                >
                  <span>发布一件闲置</span>
                  <ArrowOutwardRoundedIcon sx={{ fontSize: 16 }} />
                </button>
              </div>

              {/* 旗舰精选好物切换标签 (Keynote Showcase Tabs) */}
              {spotlightItems.length > 1 && (
                <div className="cm-apple-hero-spotlight-tabs">
                  <span className="cm-apple-spotlight-label">精选展台：</span>
                  {spotlightItems.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setHeroSpotlightIndex(idx)}
                      className={`cm-apple-spotlight-pill ${
                        heroSpotlightIndex === idx ? 'is-active' : ''
                      }`}
                    >
                      {idx === 0 ? '摄影数码' : idx === 1 ? '出行运动' : '学术生活'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 右侧：3D 物理悬浮展台 */}
            <div ref={heroProductRef} className="cm-apple-hero-showcase">
              <div
                className="cm-apple-showcase-card group cursor-pointer"
                onClick={() => currentHeroItem && navigate(`/product/${currentHeroItem.id}`)}
              >
                {/* 展台高光流线 */}
                <div className="cm-apple-showcase-glare" />

                {/* 主图视口 */}
                <div className="cm-apple-showcase-image-box">
                  <img
                    src={heroImages[0]}
                    alt={currentHeroItem?.title ?? '校园精选'}
                    className="cm-apple-showcase-img"
                  />
                  {heroImages[1] && (
                    <img
                      src={heroImages[1]}
                      alt=""
                      aria-hidden="true"
                      className="cm-apple-showcase-img-alt"
                    />
                  )}
                  <span className="cm-apple-showcase-badge">
                    <VerifiedIcon sx={{ fontSize: 13, mr: 0.4 }} />
                    {currentHeroItem?.condition ?? '几乎全新'}
                  </span>
                </div>

                {/* 展台底部铭牌 */}
                <div className="cm-apple-showcase-caption">
                  <div>
                    <span className="cm-apple-showcase-meta">
                      {currentHeroItem?.category} · {currentHeroItem?.campus}
                    </span>
                    <h2 className="cm-apple-showcase-title">
                      {currentHeroItem?.title ?? '今天，也有一件好物在等你'}
                    </h2>
                  </div>
                  <div className="cm-apple-showcase-price-box">
                    <span className="cm-apple-showcase-price">
                      {currentHeroItem ? `¥${currentHeroItem.price}` : '—'}
                    </span>
                    <span className="cm-apple-showcase-view-btn">
                      <NorthEastRoundedIcon sx={{ fontSize: 16 }} />
                    </span>
                  </div>
                </div>
              </div>

              {/* 展台旁注信用指示 */}
              <div className="cm-apple-showcase-footnote">
                <span className="cm-apple-avatar-cluster">
                  <i /><i /><i />
                </span>
                <span>全校 2,300+ 名认证同学已在此完成面对面流转</span>
              </div>
            </div>
          </div>

          {/* 底部滚动引导指示 */}
          <div className="cm-apple-hero-scroll-cue">
            <span className="cm-apple-scroll-text">向下滑动，进入产品叙事与校园集市</span>
            <div className="cm-apple-scroll-track">
              <span ref={scrollLineRef} className="cm-apple-scroll-thumb" />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          MODULE 2: 滚动驱动的页面叙事 (Scrollytelling Split Showcase)
         ========================================================================= */}
      <section ref={storyRef} className="cm-apple-story-section" aria-label="校园集市的设计哲学">
        <div className="cm-apple-story-container">
          {/* 叙事开篇大标题 */}
          <div className="cm-apple-story-header">
            <p className="cm-apple-eyebrow">DESIGNED FOR CAMPUS LIFE</p>
            <h2 className="cm-apple-story-main-title">
              每一次转让，
              <br />
              <span className="cm-apple-spruce-text">都恰如其分。</span>
            </h2>
            <p className="cm-apple-story-header-desc">
              不追求繁杂冗余，只保留最真实的校园连接。
            </p>
          </div>

          {/* 分屏粘性叙事舞台：左侧固定互动展具 + 右侧章节时间轴 */}
          <div className="cm-apple-story-split">
            {/* 左侧：粘性交互展示台 (Sticky Interactive Exhibit Canvas) */}
            <div className="cm-apple-sticky-exhibit-wrap">
              <div className="cm-apple-sticky-exhibit">
                {/* SCENE 01: 校园 15 分钟同心圆雷达 */}
                <div
                  className={`cm-apple-exhibit-scene cm-scene-radar ${
                    activeStory === 0 ? 'is-active' : ''
                  }`}
                >
                  <div className="cm-radar-circles" aria-hidden="true">
                    <span className="cm-circle cm-c1" />
                    <span className="cm-circle cm-c2" />
                    <span className="cm-circle cm-c3" />
                  </div>
                  <div className="cm-radar-center">
                    <NearMeOutlinedIcon sx={{ fontSize: 28, color: 'var(--cm-moss)' }} />
                    <span>你所在的位置</span>
                  </div>
                  <div className="cm-radar-pin cm-pin-lib">
                    <span>📍 图书馆东门</span>
                    <small>步行 3 分钟</small>
                  </div>
                  <div className="cm-radar-pin cm-pin-canteen">
                    <span>📍 学一食堂</span>
                    <small>步行 5 分钟</small>
                  </div>
                  <div className="cm-radar-pin cm-pin-dorm">
                    <span>📍 沁园宿舍区</span>
                    <small>步行 7 分钟</small>
                  </div>
                  <div className="cm-radar-pill">
                    <span>同校当面验货 · 0 快递包装与等待</span>
                  </div>
                </div>

                {/* SCENE 02: 真实学号与成色放大镜 */}
                <div
                  className={`cm-apple-exhibit-scene cm-scene-inspect ${
                    activeStory === 1 ? 'is-active' : ''
                  }`}
                >
                  <div className="cm-inspect-card">
                    <div className="cm-inspect-header">
                      <div className="cm-inspect-badge">
                        <VerifiedIcon sx={{ fontSize: 16 }} />
                        <span>校园可信认证</span>
                      </div>
                      <span className="cm-inspect-id">学号 2021**** 认证</span>
                    </div>
                    <div className="cm-inspect-loupe">
                      <div className="cm-loupe-circle">
                        <span>99%</span>
                        <small>几乎全新</small>
                      </div>
                      <div className="cm-inspect-check-list">
                        <div>✓ 屏幕无划痕（已贴类纸膜）</div>
                        <div>✓ 电池健康度 94%</div>
                        <div>✓ 附带原装包装盒与充电线</div>
                      </div>
                    </div>
                    <p className="cm-inspect-footer">
                      如实标注划痕与使用记录，绝不美化商品缺陷。
                    </p>
                  </div>
                </div>

                {/* SCENE 03: 绿色循环可持续减碳看板 */}
                <div
                  className={`cm-apple-exhibit-scene cm-scene-eco ${
                    activeStory === 2 ? 'is-active' : ''
                  }`}
                >
                  <div className="cm-eco-card">
                    <div className="cm-eco-icon-wrap">
                      <RecyclingOutlinedIcon sx={{ fontSize: 36, color: 'var(--cm-moss)' }} />
                    </div>
                    <div className="cm-eco-stat">
                      <strong>-1.8 kg</strong>
                      <span>每件闲置流转平均减碳</span>
                    </div>
                    <div className="cm-eco-stat">
                      <strong>65%</strong>
                      <span>相比新品平均为同学节省</span>
                    </div>
                    <div className="cm-eco-meter">
                      <span className="cm-eco-meter-fill" style={{ width: '82%' }} />
                    </div>
                    <p className="cm-eco-tip">
                      一件好的物品，值得陪伴两届甚至更多同学的大学时光。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：章节式滚动轨道 (Narrative Track) */}
            <div className="cm-apple-story-track">
              {STORY_STEPS.map((step, idx) => {
                const isActive = activeStory === idx;
                return (
                  <article
                    key={step.index}
                    ref={(el) => { storyStepRefs.current[idx] = el; }}
                    data-step-index={idx}
                    onClick={() => scrollToStep(idx)}
                    className={`cm-apple-story-step ${isActive ? 'is-active' : ''}`}
                  >
                    <div className="cm-step-indicator">
                      <span className="cm-step-num">{step.index}</span>
                      <span className="cm-step-line" />
                    </div>
                    <div className="cm-step-body">
                      <span className="cm-step-eyebrow">{step.eyebrow}</span>
                      <h3 className="cm-step-title">
                        {step.title.split('\n').map((l) => (
                          <span key={l}>
                            {l}
                            <br />
                          </span>
                        ))}
                      </h3>
                      <p className="cm-step-copy">{step.copy}</p>
                      <span className="cm-step-tag">{step.tag}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          MODULE 3 & 4: 校园集市商品广场与吸顶分类筛选
         ========================================================================= */}
      <section id="marketplace" className="cm-apple-market-section" aria-labelledby="market-title">
        <div className="cm-apple-market-container">
          {/* 集市顶部巨幅标题与数据指标 */}
          <div className="cm-apple-market-header">
            <div>
              <p className="cm-apple-eyebrow">THE MARKETPLACE · 2026</p>
              <h2 id="market-title" className="cm-apple-market-title">
                现在，去遇见。
              </h2>
            </div>
            <div className="cm-apple-market-stats-group">
              <div className="cm-stat-item">
                <strong>{onSaleCount || '—'}</strong>
                <span>件在售好物</span>
              </div>
              <div className="cm-stat-item">
                <strong>4</strong>
                <span>大校区同校</span>
              </div>
              <div className="cm-stat-item">
                <strong>100%</strong>
                <span>学子实名</span>
              </div>
            </div>
          </div>

          {/* 吸顶分类导航与精细筛选 */}
          <FilterBar
            value={filter}
            onChange={setFilter}
            resultCount={filtered.length}
          />

          {/* 商品网格区 */}
          <div className="cm-apple-grid-wrapper">
            <ProductGrid
              products={filtered}
              loading={loading}
              emptyTitle={priceInvalid ? '价格区间设置有误' : '暂时没有找到符合条件的物品'}
              emptyDescription={
                priceInvalid
                  ? '最低价不能高于最高价，请调整后再试。'
                  : '试着放宽成色或分类要求，或者发布求购告诉大家。'
              }
              emptyAction={
                <div className="flex flex-wrap justify-center gap-3 mt-4">
                  <Button
                    variant="outlined"
                    onClick={handleReset}
                    sx={{
                      borderRadius: 999,
                      px: 3,
                      borderColor: 'rgba(0,0,0,0.15)',
                      color: 'var(--cm-ink)',
                    }}
                  >
                    重置全部筛选
                  </Button>
                  <Button
                    variant="contained"
                    onClick={goToPublish}
                    startIcon={<AddRoundedIcon />}
                    sx={{
                      borderRadius: 999,
                      px: 3,
                      bgcolor: 'var(--cm-ink)',
                      '&:hover': { bgcolor: 'var(--cm-moss)' },
                    }}
                  >
                    我要发布一件
                  </Button>
                </div>
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}
