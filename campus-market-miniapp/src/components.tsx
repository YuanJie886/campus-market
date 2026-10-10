import Taro from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import { useState, type ReactNode } from 'react';
import type { Product } from './model';
import { CATEGORY_EMOJI, CATEGORY_STYLE, money, timeAgo } from './model';
import { isDemo } from './api';
import { goLogin, notifyError, useMarket } from './state';

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View className='page-title'><View><Text className='title'>{title}</Text>{subtitle && <Text className='subtitle'>{subtitle}</Text>}</View>{isDemo && <Text className='demo-tag'>演示版</Text>}</View>;
}
export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <View className='empty'><Text className='empty-symbol'>◇</Text><Text className='empty-title'>{title}</Text>{description && <Text className='muted empty-description'>{description}</Text>}{action}</View>;
}
export function LoginGate({ children, returnTo }: { children: ReactNode; returnTo?: string }) {
  const { user, ready } = useMarket();
  if (!ready) return <Empty title='正在准备校园集市…' />;
  if (!user) return <Empty title='登录后发现本校好物' description='浏览、发布和联系申请仅对登录用户开放。' action={<Button className='primary' onClick={() => goLogin(returnTo)}>登录 / 注册</Button>} />;
  return <>{children}</>;
}
export function ProductImage({ product, src, large = false }: { product: Pick<Product, 'category' | 'title'>; src?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <View className={`product-image ${large ? 'large-image' : ''} category-${CATEGORY_STYLE[product.category] ?? 'other'}`}>
    {src && !failed ? <Image src={src} mode='aspectFill' className='image' onError={() => setFailed(true)} /> : <Text className='image-emoji'>{CATEGORY_EMOJI[product.category]}</Text>}
  </View>;
}
export function ProductCard({ product }: { product: Product }) {
  const { favorites, toggleFavorite } = useMarket();
  const [busy, setBusy] = useState(false);
  const active = favorites.includes(product.id);
  return <View className='product-card' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` })}>
    <View className='card-picture'><ProductImage product={product} src={product.images[0]} />
      <Text className='condition'>{product.condition}</Text>
      <Button className={`favorite ${active ? 'active' : ''}`} aria-label={active ? '取消收藏' : '收藏商品'} disabled={busy} onClick={async (event) => {
        event.stopPropagation(); if (busy) return; setBusy(true); try { await toggleFavorite(product.id); } catch (e) { notifyError(e); } finally { setBusy(false); }
      }}>{active ? '♥' : '♡'}</Button>
      {product.status !== '在售' && <Text className='sold-label'>{product.status}</Text>}
    </View>
    <View className='card-content'><View className='card-meta'><Text>{product.category}</Text><Text>{product.campus}</Text></View>
      <Text className='card-title'>{product.title}</Text>
      <View className='price-line'><Text className='price'><Text className='currency'>¥</Text>{money(product.price)}</Text>{product.originalPrice && product.originalPrice > product.price && <Text className='original'>¥{money(product.originalPrice)}</Text>}</View>
      <Text className='card-time'>{timeAgo(product.createdAt)}</Text>
    </View>
  </View>;
}
export function ProductGrid({ products }: { products: Product[] }) { return <View className='product-grid'>{products.map((p) => <ProductCard key={p.id} product={p} />)}</View>; }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <Empty title='暂时无法加载' description={message} action={<Button className='secondary' onClick={retry}>重新加载</Button>} />; }
