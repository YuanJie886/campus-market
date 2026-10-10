import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ProductGrid from "../../components/ProductGrid";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import { getApiClient } from "../../api/client";
import type { DemandSubscription } from "../../types";
import { matchesDemand } from "../../utils/listingFreshness";
import EmptyState from "../../components/EmptyState";
import SearchOffIcon from "@mui/icons-material/SearchOff";

function describeDemand(demand: DemandSubscription): string {
  return [
    demand.keyword && `关键词：${demand.keyword}`,
    demand.category && `分类：${demand.category}`,
    demand.campus,
    demand.minPrice !== undefined && `¥${demand.minPrice} 起`,
    demand.maxPrice !== undefined && `最高 ¥${demand.maxPrice}`,
  ].filter(Boolean).join(" · ");
}

export default function DemandSubscriptionsPage() {
  const { products, loading: marketLoading } = useMarket();
  const { error, success } = useNotify();
  const [items, setItems] = useState<DemandSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getApiClient().listDemandSubscriptions());
    } catch (e) {
      error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await getApiClient().deleteDemandSubscription(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
      success("已删除需求条件");
    } catch (e) {
      error((e as Error).message);
    } finally {
      setRemoving(null);
    }
  };

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        icon={<SearchOffIcon sx={{ fontSize: 34 }} />}
        title="还没有保存的需求条件"
        description="搜索暂时没有结果时，可以保存关键词、分类、校区和预算条件，之后回来查看匹配的在售商品。"
        action={<Button component={Link} to="/search" variant="outlined">去搜索</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loading && <div className="rounded-2xl bg-white p-6 text-sm text-slate-500">正在读取需求条件…</div>}
      {!loading && items.map((demand) => {
        const matches = products.filter((product) => matchesDemand(product, demand));
        return (
          <section key={demand.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-bold text-slate-800">{describeDemand(demand) || "已保存的需求条件"}</h2>
                <Chip className="!mt-2" size="small" variant="outlined" label={`${matches.length} 个在售匹配`} />
              </div>
              <Button size="small" color="inherit" disabled={removing === demand.id} onClick={() => void remove(demand.id)}>
                {removing === demand.id ? "删除中…" : "删除条件"}
              </Button>
            </div>
            <ProductGrid
              products={matches.slice(0, 4)}
              loading={marketLoading}
              emptyTitle="暂时还没有匹配商品"
              emptyDescription="有新商品满足这些规则后，回来这里查看。当前版本不会发送推送通知。"
            />
          </section>
        );
      })}
    </div>
  );
}
