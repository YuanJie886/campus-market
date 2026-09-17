import type { ReactNode } from 'react';
import Skeleton from '@mui/material/Skeleton';
import Card from '@mui/material/Card';
import type { Product } from '../types';
import ProductCard from './ProductCard';
import EmptyState from './EmptyState';

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}

function ProductCardSkeleton() {
  return (
    <Card
      elevation={0}
      className="overflow-hidden border border-slate-200/70 bg-white shadow-card"
      sx={{ borderRadius: '20px' }}
    >
      <Skeleton variant="rectangular" sx={{ width: '100%', aspectRatio: '1 / 1' }} />
      <div className="p-4">
        <Skeleton variant="text" width="90%" />
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="40%" height={28} />
      </div>
    </Card>
  );
}

/** 响应式商品网格：手机 1 列 / 平板 2 列 / 桌面 3-4 列，含骨架屏与空状态 */
export default function ProductGrid({
  products,
  loading = false,
  emptyTitle = '暂无商品',
  emptyDescription = '换个筛选条件试试，或去发布你的第一件闲置吧～',
  emptyAction,
}: ProductGridProps) {
  const gridClass =
    'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-5';

  if (loading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 8 }).map((_, index) => (
          <ProductCardSkeleton key={`skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className={gridClass}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
