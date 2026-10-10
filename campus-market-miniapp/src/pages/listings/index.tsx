import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate, PageTitle, ProductGrid, ProductImage } from '../../components';
import { money, type Product, type ProductStatus } from '../../model';
import { editProduct } from '../../navigation';
import { notify, notifyError, useMarket } from '../../state';

export default function ListingsPage() {
  const { user, loadFavorites } = useMarket(), router = useRouter(), favoriteMode = router.params.kind === 'favorites';
  const [items, setItems] = useState<Product[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(''), [unavailable, setUnavailable] = useState(0);
  const sequence = useRef(0);
  const load = async () => {
    if (!user) return; const gen = ++sequence.current; setLoading(true); setError('');
    try {
      let products: Product[];
      if (favoriteMode) {
        const ids = await api.favorites(), results = await Promise.allSettled(ids.map((id) => api.detail(id)));
        products = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.some((r) => r.status === 'rejected' && !/不存在|已下架/.test(String(r.reason?.message)))) throw new Error('部分收藏加载失败，请重试');
        if (gen === sequence.current) setUnavailable(failed.length);
        await loadFavorites();
      } else products = await api.myListings();
      if (gen === sequence.current) setItems(products);
    } catch (e) { if (gen === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useDidShow(() => { void load(); });
  useEffect(() => { sequence.current++; setItems([]); setUnavailable(0); void load(); }, [user?.id, favoriteMode]);
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const changeStatus = async (p: Product, status: ProductStatus) => {
    if (busy) return;
    const answer = await Taro.showModal({ title: status === '已售出' ? '确认已经售出？' : status === '已下架' ? '下架这件商品？' : '重新上架这件商品？', content: status === '已下架' ? '其他同学将无法查看，你可以稍后重新上架。' : '请根据商品实际情况更新状态。', confirmColor: '#194e41' });
    if (!answer.confirm) return; setBusy(p.id);
    try { await api.status(p.id, status); await load(); notify('商品状态已更新'); }
    catch (e) { notifyError(e); } finally { setBusy(''); }
  };
  return <View className='page'><PageTitle title={favoriteMode ? '留给喜欢的好物' : '我的闲置，有了新去处'} subtitle={favoriteMode ? '收藏方便再次找到，商品状态以详情页为准。' : '及时更新状态，让同学少跑一趟。'} /><LoginGate returnTo={`/pages/listings/index${favoriteMode ? '?kind=favorites' : ''}`}>
    {unavailable > 0 && <View className='notice'>{unavailable} 件收藏已下架或当前不可查看。</View>}
    {error ? <ErrorState message={error} retry={() => void load()} /> : loading && !items.length ? <Empty title='加载好物中…' /> : !items.length ? <Empty title={favoriteMode ? '还没有收藏商品' : '还没有发布闲置'} action={<Button className='primary' onClick={() => void Taro.switchTab({ url: favoriteMode ? '/pages/market/index' : '/pages/publish/index' })}>{favoriteMode ? '去集市逛逛' : '发布第一件闲置'}</Button>} /> : favoriteMode ? <ProductGrid products={items} /> : items.map((p) => <View className='listing-card' key={p.id}>
      <View className='listing-main' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(p.id)}` })}><ProductImage product={p} src={p.images[0]} /><View className='listing-info'><Text className='request-title'>{p.title}</Text><Text className='price'>¥{money(p.price)}</Text><Text className='status-pill'>{p.status}</Text></View></View>
      <View className='listing-buttons'><Button className='secondary small' onClick={() => editProduct(p.id)}>编辑</Button>{p.status === '在售' ? <><Button className='secondary small' disabled={Boolean(busy)} onClick={() => void changeStatus(p, '已下架')}>下架</Button><Button className='primary small' disabled={Boolean(busy)} onClick={() => void changeStatus(p, '已售出')}>标记已售</Button></> : <Button className='primary small' disabled={Boolean(busy)} onClick={() => void changeStatus(p, '在售')}>重新上架</Button>}</View>
    </View>)}
  </LoginGate></View>;
}
