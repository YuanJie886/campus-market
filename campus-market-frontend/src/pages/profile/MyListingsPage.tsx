import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import SellOutlinedIcon from "@mui/icons-material/SellOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import EmptyState from "../../components/EmptyState";
import ImageWithFallback from "../../components/ImageWithFallback";
import ProductForm from "../../components/ProductForm";
import type { ProductFormValue } from "../../components/ProductForm";
import { useAuth } from "../../context/AuthContext";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import {
  CATEGORY_EMOJI,
  CATEGORY_GRADIENT,
  CONDITION_COLOR,
} from "../../utils/constants";
import { formatPrice, formatRelativeTime } from "../../utils/format";
import type { Product, ProductInput, ProductStatus } from "../../types";
import { toUserMessage } from '../../api/errors';
import { getApiClient } from '../../api/client';
import type { ProductDisclosure, ProductTextbook } from '../../api/contracts';

const STATUS_TABS: (ProductStatus | "全部")[] = [
  "全部",
  "在售",
  "已售出",
  "已下架",
];

const STATUS_COLOR: Record<ProductStatus, "success" | "default" | "warning"> = {
  在售: "success",
  预约中: "warning",
  已售出: "default",
  已下架: "warning",
};

/** 我的发布：管理已发布商品（编辑 / 下架 / 标记已售 / 重新上架） */
export default function MyListingsPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const {
    getSellerProducts,
    updateProduct,
    markSold,
    takedownProduct,
    relistProduct,
  } = useMarket();
  const { success, error } = useNotify();

  const [statusTab, setStatusTab] = useState<ProductStatus | "全部">("全部");
  const [editing, setEditing] = useState<Product | null>(null);
  // 编辑前读取商品当前声明：列表接口不带声明，不能拿空值当作「未声明」
  const [editingDisclosure, setEditingDisclosure] = useState<ProductDisclosure | null | undefined>(undefined);
  const [disclosureError, setDisclosureError] = useState<string | null>(null);
  const [editingTextbook, setEditingTextbook] = useState<ProductTextbook | null>(null);
  useEffect(() => {
    if (!editing) return;
    let active = true;
    setEditingDisclosure(undefined);
    setDisclosureError(null);
    getApiClient()
      .getProduct(editing.id)
      .then((detail) => {
        if (!active) return;
        setEditingTextbook(detail.textbook ?? null);
        setEditingDisclosure(detail.inspection ?? null);
      })
      .catch((e) => {
        if (active) setDisclosureError(toUserMessage(e));
      });
    return () => {
      active = false;
    };
  }, [editing]);

  const listings = currentUser ? getSellerProducts(currentUser.id) : [];

  const filtered = useMemo(
    () =>
      statusTab === "全部"
        ? listings
        : listings.filter((p) => p.status === statusTab),
    [listings, statusTab],
  );

  const handleEditSubmit = async (data: Omit<ProductInput, "sellerId">) => {
    try {
      if (!editing) return;
      await updateProduct(editing.id, {
        title: data.title,
        description: data.description,
        price: data.price,
        originalPrice: data.originalPrice,
        category: data.category,
        condition: data.condition,
        campus: data.campus,
        // 始终显式提交取货楼栋：切换校区时表单已清掉不兼容的旧值，
        // 显式提交让后端不必走「只改校区」的 400 分支
        buildingId: data.buildingId ?? null,
        contact: data.contact,
        contactPublic: data.contactPublic,
        images: data.images,
        // 表单只在需要替换声明时才给出 inspection；缺省即「声明不变」
        ...(data.inspection ? { inspection: data.inspection } : {}),
        ...(data.textbookEditionId !== undefined ? { textbookEditionId: data.textbookEditionId } : {}),
        ...(data.visibility !== undefined ? { visibility: data.visibility, circleIds: data.circleIds ?? [] } : {}),
      });
      setEditing(null);
      success("商品信息已更新");
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  const editInitial: Partial<ProductFormValue> | undefined = editing
    ? {
        title: editing.title,
        description: editing.description,
        price: String(editing.price),
        originalPrice:
          editing.originalPrice !== undefined
            ? String(editing.originalPrice)
            : "",
        category: editing.category,
        condition: editing.condition,
        campus: editing.campus,
        // 编辑时保留原有的合法楼栋；BuildingSelect 会在校区变化时清掉不兼容的值
        buildingId: editing.buildingId ?? null,
        contact: editing.contact,
        contactPublic: editing.contactPublic === true,
        images: editing.images,
        visibility: editing.visibility ?? "PUBLIC",
        circleIds: (editing.circles ?? []).map((c) => c.id),
      }
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={statusTab}
          onChange={(_e, value) =>
            setStatusTab(value as ProductStatus | "全部")
          }
          variant="scrollable"
          scrollButtons={false}
          sx={{ minHeight: 40 }}
        >
          {STATUS_TABS.map((status) => (
            <Tab
              key={status}
              label={status}
              value={status}
              sx={{ minHeight: 40, fontWeight: 600 }}
            />
          ))}
        </Tabs>
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate("/publish")}
        >
          发布新商品
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inventory2OutlinedIcon sx={{ fontSize: 34 }} />}
          title={
            statusTab === "全部"
              ? "还没有发布过商品"
              : `没有「${statusTab}」的商品`
          }
          description="把你闲置的好物发布出来，让它遇见需要它的同学～"
          action={
            <Button variant="contained" onClick={() => navigate("/publish")}>
              去发布
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((product) => (
            <div
              key={product.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-card sm:flex-row sm:items-center"
            >
              <button
                type="button"
                onClick={() => navigate(`/product/${product.id}`)}
                className="shrink-0"
                aria-label="查看商品"
              >
                <ImageWithFallback
                  src={product.images[0]}
                  alt={product.title}
                  emoji={CATEGORY_EMOJI[product.category]}
                  gradient={CATEGORY_GRADIENT[product.category]}
                  className="h-24 w-24 rounded-xl"
                />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/product/${product.id}`)}
                    className="line-clamp-2 text-left text-sm font-semibold text-slate-800 hover:text-brand-600"
                  >
                    {product.title}
                  </button>
                  <Chip
                    label={product.status}
                    size="small"
                    color={STATUS_COLOR[product.status]}
                    sx={{ flexShrink: 0 }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="text-base font-extrabold text-brand-600">
                    {formatPrice(product.price)}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 font-medium text-white"
                    style={{
                      backgroundColor:
                        CONDITION_COLOR[product.condition] ?? "#64748b",
                    }}
                  >
                    {product.condition}
                  </span>
                  <span>{product.campus}</span>
                  <span>· {product.views} 浏览</span>
                  <span>· {formatRelativeTime(product.createdAt)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => setEditing(product)}
                >
                  编辑
                </Button>
                {product.status === "在售" && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      color="success"
                      startIcon={<SellOutlinedIcon />}
                      onClick={async () => {
                        try {
                          await markSold(product.id);
                          success("已标记为售出");
                        } catch (e) {
                          error(toUserMessage(e));
                        }
                      }}
                    >
                      标记已售
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      startIcon={<VisibilityOffOutlinedIcon />}
                      onClick={async () => {
                        try {
                          await takedownProduct(product.id);
                          success("商品已下架");
                        } catch (e) {
                          error(toUserMessage(e));
                        }
                      }}
                    >
                      下架
                    </Button>
                  </>
                )}
                {product.status === "已下架" && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PublishOutlinedIcon />}
                    onClick={async () => {
                      try {
                        await relistProduct(product.id);
                        success("商品已重新上架");
                      } catch (e) {
                        error(toUserMessage(e));
                      }
                    }}
                  >
                    重新上架
                  </Button>
                )}
                {product.status === "已售出" && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PublishOutlinedIcon />}
                    onClick={async () => {
                      try {
                        await relistProduct(product.id);
                        success("商品已重新上架");
                      } catch (e) {
                        error(toUserMessage(e));
                      }
                    }}
                  >
                    重新上架
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        fullWidth
        maxWidth="sm"
        scroll="paper"
      >
        <DialogTitle sx={{ fontWeight: 700 }}>编辑商品</DialogTitle>
        <DialogContent dividers>
          {editing && disclosureError && (
            <p className="text-sm text-red-700" role="alert">{disclosureError}</p>
          )}
          {editing && !disclosureError && editingDisclosure === undefined && (
            <p className="text-sm text-slate-600" role="status">正在读取商品信息…</p>
          )}
          {editing && editingDisclosure !== undefined && (
            <ProductForm
              initial={editInitial}
              compact
              mode="edit"
              initialInspection={editingDisclosure}
              initialTextbook={editingTextbook}
              submitLabel="保存修改"
              onSubmit={handleEditSubmit}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
