import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import EmptyState from '../../components/EmptyState';
import ImageWithFallback from '../../components/ImageWithFallback';
import ProductForm from '../../components/ProductForm';
import type { ProductFormValue } from '../../components/ProductForm';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';
import { useNotify } from '../../context/NotificationContext';
import { CATEGORY_EMOJI, CATEGORY_GRADIENT, CONDITION_COLOR } from '../../utils/constants';
import { formatPrice, formatRelativeTime } from '../../utils/format';
import type { Product, ProductInput, ProductStatus } from '../../types';

const STATUS_TABS: (ProductStatus | '全部')[] = ['全部', '在售', '已售出', '已下架'];

const STATUS_COLOR: Record<ProductStatus, 'success' | 'default' | 'warning'> = {
  在售: 'success',
  已售出: 'default',
  已下架: 'warning',
};

/** 我的发布：管理已发布商品（编辑 / 下架 / 标记已售 / 重新上架） */
export default function MyListingsPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { getSellerProducts, updateProduct, markSold, takedownProduct, relistProduct } =
    useMarket();
  const { success } = useNotify();

  const [statusTab, setStatusTab] = useState<ProductStatus | '全部'>('全部');
  const [editing, setEditing] = useState<Product | null>(null);

  const listings = currentUser ? getSellerProducts(currentUser.id) : [];

  const filtered = useMemo(
    () =>
      statusTab === '全部'
        ? listings
        : listings.filter((p) => p.status === statusTab),
    [listings, statusTab],
  );

  const handleEditSubmit = (data: Omit<ProductInput, 'sellerId'>) => {
    if (!editing) return;
    updateProduct(editing.id, {
      title: data.title,
      description: data.description,
      price: data.price,
      originalPrice: data.originalPrice,
      category: data.category,
      condition: data.condition,
      campus: data.campus,
      contact: data.contact,
      images: data.images,
    });
    setEditing(null);
    success('商品信息已更新');
  };

  const editInitial: Partial<ProductFormValue> | undefined = editing
    ? {
        title: editing.title,
        description: editing.description,
        price: String(editing.price),
        originalPrice:
          editing.originalPrice !== undefined ? String(editing.originalPrice) : '',
        category: editing.category,
        condition: editing.condition,
        campus: editing.campus,
        contact: editing.contact,
        images: editing.images,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={statusTab}
          onChange={(_e, value) => setStatusTab(value as ProductStatus | '全部')}
          variant="scrollable"
          scrollButtons={false}
          sx={{ minHeight: 40 }}
        >
          {STATUS_TABS.map((status) => (
            <Tab key={status} label={status} value={status} sx={{ minHeight: 40, fontWeight: 600 }} />
          ))}
        </Tabs>
        <Button
          variant="contained"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => navigate('/publish')}
        >
          发布新商品
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inventory2OutlinedIcon sx={{ fontSize: 34 }} />}
          title={statusTab === '全部' ? '还没有发布过商品' : `没有「${statusTab}」的商品`}
          description="把你闲置的好物发布出来，让它遇见需要它的同学～"
          action={
            <Button variant="contained" onClick={() => navigate('/publish')}>
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
                      backgroundColor: CONDITION_COLOR[product.condition] ?? '#64748b',
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
                {product.status === '在售' && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      color="success"
                      startIcon={<SellOutlinedIcon />}
                      onClick={() => {
                        markSold(product.id);
                        success('已标记为售出');
                      }}
                    >
                      标记已售
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      startIcon={<VisibilityOffOutlinedIcon />}
                      onClick={() => {
                        takedownProduct(product.id);
                        success('商品已下架');
                      }}
                    >
                      下架
                    </Button>
                  </>
                )}
                {product.status === '已下架' && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PublishOutlinedIcon />}
                    onClick={() => {
                      relistProduct(product.id);
                      success('商品已重新上架');
                    }}
                  >
                    重新上架
                  </Button>
                )}
                {product.status === '已售出' && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PublishOutlinedIcon />}
                    onClick={() => {
                      relistProduct(product.id);
                      success('商品已重新上架');
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
          {editing && (
            <ProductForm
              initial={editInitial}
              compact
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
