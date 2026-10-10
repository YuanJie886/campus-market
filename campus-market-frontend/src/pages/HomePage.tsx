import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@mui/material/Button";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ProductGrid from "../components/ProductGrid";
import FilterBar from "../components/FilterBar";
import BuildingScopeBar from "../components/BuildingScopeBar";
import DemandEmptyStateCta from "../components/demand/DemandEmptyStateCta";
import type { DemandConditions } from "../api/contracts";
import { useBuildingFeed } from "../hooks/useBuildingFeed";
import type { FeedQuery } from "../api/contracts";
import { useMarket } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { DEFAULT_FILTER, SORT_OPTIONS } from "../types";
import type { FilterState } from "../types";

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { products, loading } = useMarket();
  const { isAuthenticated } = useAuth();

  const keywordParam = searchParams.get("keyword") ?? "";
  const [filter, setFilter] = useState<FilterState>({
    ...DEFAULT_FILTER,
    keyword: keywordParam,
  });

  useEffect(() => {
    setFilter((prev) =>
      prev.keyword === keywordParam ? prev : { ...prev, keyword: keywordParam },
    );
  }, [keywordParam]);

  // 筛选与排序
  const filtered = useMemo(() => {
    const kw = filter.keyword.trim().toLowerCase();
    let list = products.filter((p) => p.status !== "已下架");
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
    if (filter.category !== "全部")
      list = list.filter((p) => p.category === filter.category);
    if (filter.campus !== "全部")
      list = list.filter((p) => p.campus === filter.campus);
    if (filter.condition !== "全部")
      list = list.filter((p) => p.condition === filter.condition);
    if (filter.minPrice !== "")
      list = list.filter((p) => p.price >= Number(filter.minPrice));
    if (filter.maxPrice !== "")
      list = list.filter((p) => p.price <= Number(filter.maxPrice));

    const sorted = [...list];
    switch (filter.sort) {
      case "priceAsc":
        sorted.sort((a, b) => a.price - b.price);
        break;
      case "priceDesc":
        sorted.sort((a, b) => b.price - a.price);
        break;
      case "views":
        sorted.sort((a, b) => b.views - a.views);
        break;
      default:
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

  // ---- 只看本楼 ----
  // 开关关闭时完全走原来的本地筛选流；打开时才请求 feed 端点。
  // 这样普通浏览的行为一个字节都没变，降级逻辑也只在用户主动要求时生效。
  const [buildingOnly, setBuildingOnly] = useState(false);
  const feedQuery = useMemo<FeedQuery | null>(() => {
    if (!buildingOnly) return null;
    return {
      scope: "BUILDING",
      sort: filter.sort,
      page: 1,
      pageSize: 100,
      keyword: filter.keyword.trim() || undefined,
      category: filter.category === "全部" ? undefined : filter.category,
      condition: filter.condition === "全部" ? undefined : filter.condition,
      minPrice: filter.minPrice === "" ? undefined : Number(filter.minPrice),
      maxPrice: filter.maxPrice === "" ? undefined : Number(filter.maxPrice),
    };
  }, [buildingOnly, filter]);
  const feed = useBuildingFeed(feedQuery);
  const displayedProducts = buildingOnly ? (feed.page?.items ?? []) : filtered;
  const displayedLoading = buildingOnly ? feed.status === "loading" : loading;

  // 搜索空态的订阅预填：地理范围取自<b>状态</b>（开关、校区筛选），不取任何展示文案
  const demandPrefill = useMemo<DemandConditions>(
    () => ({
      keyword: filter.keyword.trim() || null,
      category: filter.category === "全部" ? null : filter.category,
      minPrice: filter.minPrice === "" ? null : Number(filter.minPrice),
      maxPrice: filter.maxPrice === "" ? null : Number(filter.maxPrice),
      geoScope: buildingOnly
        ? "BUILDING"
        : filter.campus !== "全部"
          ? "CAMPUS"
          : "SCHOOL",
      campusId:
        !buildingOnly && filter.campus !== "全部" ? filter.campus : null,
      buildingId: null, // BUILDING 时省略即使用本人宿舍楼
    }),
    [filter, buildingOnly],
  );

  const onSaleCount = products.filter((p) => p.status === "在售").length;
  const sortLabel = SORT_OPTIONS.find(
    (option) => option.value === filter.sort,
  )?.label;

  const priceInvalid =
    filter.minPrice !== "" &&
    filter.maxPrice !== "" &&
    Number(filter.minPrice) > Number(filter.maxPrice);

  const goToPublish = () => navigate(isAuthenticated ? "/publish" : "/login");
  const handleReset = () => {
    setFilter({ ...DEFAULT_FILTER });
    navigate("/");
  };

  return (
    <div className="cm-market-home">
      <section className="cm-market-intro" aria-labelledby="home-title">
        <div>
          <h1 id="home-title">发现本校同学的闲置好物</h1>
          <p>闲置就在身边，约好地点，当面看看再决定。</p>
        </div>
        <span className="cm-market-intro-badge">
          <span aria-hidden="true" className="cm-market-intro-dot" />
          {isAuthenticated
            ? loading
              ? "正在加载好物…"
              : `${onSaleCount} 件在售好物`
            : "校园闲置 · 就近面交"}
        </span>
      </section>

      {isAuthenticated ? (
        <section
          id="marketplace"
          className="cm-apple-market-section"
          aria-labelledby="market-title"
        >
          <div className="cm-apple-market-container">
            <div className="cm-market-toolbar">
              <div className="cm-market-heading">
                <h2 id="market-title">
                  {filter.keyword.trim() ? "搜索结果" : "校园集市"}
                </h2>
                <p>
                  {filter.keyword.trim()
                    ? `搜索「${filter.keyword.trim()}」`
                    : filter.category === "全部"
                      ? "全部好物"
                      : filter.category}
                  {" · "}
                  {sortLabel}
                </p>
              </div>
              <BuildingScopeBar
                enabled={buildingOnly}
                onToggle={setBuildingOnly}
                feed={feed}
              />
            </div>

            <FilterBar
              value={filter}
              onChange={setFilter}
              resultCount={displayedProducts.length}
            />

            {/* 商品网格区 */}
            <div className="cm-apple-grid-wrapper">
              {/* 搜索空态的订阅入口：结果为空时直接出现在商品区，而不是藏在「我的」里 */}
              <DemandEmptyStateCta
                prefill={demandPrefill}
                showCta={
                  !displayedLoading &&
                  !priceInvalid &&
                  displayedProducts.length === 0
                }
              />
              <ProductGrid
                products={displayedProducts}
                loading={displayedLoading}
                emptyTitle={
                  priceInvalid
                    ? "价格区间设置有误"
                    : "暂时没有找到符合条件的物品"
                }
                emptyDescription={
                  priceInvalid
                    ? "最低价不能高于最高价，请调整后再试。"
                    : "试着放宽成色或分类要求，或者发布求购告诉大家。"
                }
                emptyAction={
                  <div className="flex flex-wrap justify-center gap-3 mt-4">
                    <Button
                      variant="outlined"
                      onClick={handleReset}
                      sx={{
                        borderRadius: 999,
                        px: 3,
                        borderColor: "rgba(0,0,0,0.15)",
                        color: "var(--cm-ink)",
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
                        bgcolor: "var(--cm-ink)",
                        "&:hover": { bgcolor: "var(--cm-moss)" },
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
      ) : (
        // 未登录时保留本校商品的登录访问要求。
        <section
          id="marketplace"
          className="cm-apple-market-section"
          aria-labelledby="guest-market-title"
        >
          <div className="cm-apple-market-container">
            <div className="cm-market-guest">
              <h2
                id="guest-market-title"
                className="text-xl font-extrabold text-slate-800"
              >
                登录后查看本校在售好物
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                校园集市展示同一所学校内的闲置商品：登录后才能浏览、搜索和查看商品，看到的都是你所在学校的商品。
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <Button
                  variant="contained"
                  onClick={() => navigate("/login", { state: { from: "/" } })}
                >
                  登录
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate("/register")}
                >
                  注册
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
