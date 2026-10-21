import type { ReactNode } from 'react';
import type { Product } from '../types';
import type { ContactRequestStatus } from '../api/contracts';
import ProductCard from './ProductCard';
import EmptyState from './EmptyState';

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** 当前用户发出的联系申请（商品 id → 状态），用于卡片角标 */
  contactStatuses?: ReadonlyMap<string, ContactRequestStatus>;
  /** 列表的可访问名称 */
  label?: string;
}

/** 骨架卡片：与真实卡片同样的结构与比例，加载完成时不跳动 */
export function ProductCardSkeleton() {
  return (
    <div className="cm-card cm-card-skeleton" aria-hidden="true">
      <div className="cm-card-media cm-skeleton-block" />
      <div className="cm-card-body">
        <div className="cm-skeleton-line" style={{ width: '38%', height: 18 }} />
        <div className="cm-skeleton-line" style={{ width: '92%' }} />
        <div className="cm-skeleton-line" style={{ width: '64%' }} />
        <div className="cm-skeleton-line" style={{ width: '50%', marginTop: 10 }} />
      </div>
    </div>
  );
}

/** 响应式商品网格：手机 2 列 / 平板 3 列 / ≥1280px 4 列，含骨架屏与空状态 */
export default function ProductGrid({
  products,
  loading = false,
  emptyTitle = '暂无商品',
  emptyDescription = '换个筛选条件试试，或去发布你的第一件闲置吧～',
  emptyAction,
  contactStatuses,
  label = '商品列表',
}: ProductGridProps) {
  if (loading) {
    return (
      <div className="cm-grid" role="status" aria-label="正在加载商品">
        {Array.from({ length: 8 }).map((_, index) => (
          <ProductCardSkeleton key={`skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <ul className="cm-grid" aria-label={label}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} index={index} contactStatus={contactStatuses?.get(product.id) ?? null} />
        </li>
      ))}
    </ul>
  );
}
