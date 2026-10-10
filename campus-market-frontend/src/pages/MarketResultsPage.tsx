import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "@mui/material/Button";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ProductGrid from "../components/ProductGrid";
import DemandSubscriptionDialog from "../components/DemandSubscriptionDialog";
import FilterBar from "../components/FilterBar";
import { useMarket } from "../context/MarketContext";
import { DEFAULT_FILTER } from "../types";
import type { Category, FilterState } from "../types";
import { isListingStale } from "../utils/listingFreshness";

interface Props { category?: Category }

export default function MarketResultsPage({ category }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { products, loading } = useMarket();
  const queryKeyword = params.get("q") ?? params.get("keyword") ?? "";
  const [filter, setFilter] = useState<FilterState>({
    ...DEFAULT_FILTER,
    keyword: queryKeyword,
    category: category ?? "全部",
  });
  useEffect(() => {
    setFilter((previous) => ({
      ...previous,
      keyword: queryKeyword,
      category: category ?? "全部",
    }));
  }, [category, queryKeyword]);
  const filtered = useMemo(() => {
    const keyword = filter.keyword.trim().toLowerCase();
    const list = products.filter((product) => {
      if (product.status === "已下架" || isListingStale(product)) return false;
      if (keyword && !`${product.title} ${product.description}`.toLowerCase().includes(keyword)) return false;
      if (filter.category !== "全部" && product.category !== filter.category) return false;
      if (filter.campus !== "全部" && product.campus !== filter.campus) return false;
      if (filter.condition !== "全部" && product.condition !== filter.condition) return false;
      if (filter.minPrice !== "" && product.price < filter.minPrice) return false;
      if (filter.maxPrice !== "" && product.price > filter.maxPrice) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (filter.sort === "priceAsc") return a.price - b.price;
      if (filter.sort === "priceDesc") return b.price - a.price;
      if (filter.sort === "views") return b.views - a.views;
      return b.createdAt - a.createdAt;
    });
  }, [filter, products]);

  const title = category ? `${category} · 商品` : queryKeyword ? `搜索「${queryKeyword}」` : "搜索商品";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600" onClick={() => navigate("/")}>
            <ArrowBackRoundedIcon fontSize="small" /> 返回集市
          </button>
          <p className="text-sm font-semibold text-brand-600">DISCOVER · 独立结果页</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-900 md:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">筛选条件会保留在当前结果页，找到合适的好物再进入详情。</p>
        </div>
        {queryKeyword && <Button variant="outlined" onClick={() => navigate("/search")}>清空关键词</Button>}
      </div>
      <FilterBar value={filter} onChange={setFilter} resultCount={filtered.length} />
      <ProductGrid products={filtered} loading={loading} emptyTitle="没有找到符合条件的好物" emptyDescription="试试换个关键词，或保存需求条件，之后查看匹配的在售商品。" emptyAction={<div className="flex flex-wrap justify-center gap-2"><Button variant="outlined" onClick={() => setFilter({ ...DEFAULT_FILTER, category: category ?? "全部" })}>清空筛选</Button><DemandSubscriptionDialog initial={filter} /></div>} />
    </div>
  );
}
