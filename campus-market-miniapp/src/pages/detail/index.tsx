import Taro, { useDidShow, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import { Button, Input, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import { Empty, ErrorState, LoginGate, ProductImage } from '../../components';
import { money, timeAgo, type ContactRequest, type Product, type User } from '../../model';
import { editProduct } from '../../navigation';
import { notify, notifyError, useMarket } from '../../state';

const DECLARATIONS: Record<string, string> = { NORMAL: '正常', DEFECT: '存在问题', NOT_TESTED: '未测试', NOT_APPLICABLE: '不适用' };
export default function DetailPage() {
  const { user, favorites, toggleFavorite } = useMarket(), router = useRouter();
  const id = router.params.id ?? '';
  const [product, setProduct] = useState<Product | null>(null), [seller, setSeller] = useState<User | null>(null), [request, setRequest] = useState<ContactRequest | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reporting, setReporting] = useState(false), [reason, setReason] = useState('');
  const sequence = useRef(0);
  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current; setLoading(true); setError('');
    try {
      const p = await api.detail(id);
      const [u, r] = await Promise.all([api.publicUser(p.sellerId), api.contactState(id)]);
      if (gen !== sequence.current) return;
      setProduct(p); setSeller(u); setRequest(r);
    } catch (e) { if (gen === sequence.current) { setProduct(null); setError(e instanceof Error ? e.message : '加载失败'); } }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useDidShow(() => { void load(); });
  useEffect(() => { sequence.current++; setProduct(null); setSeller(null); setRequest(null); void load(); }, [user?.id, id]);
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useShareAppMessage(() => ({ title: product?.title ?? '校园闲置好物', path: `/pages/detail/index?id=${encodeURIComponent(id)}` }));
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { notifyError(e); } finally { setBusy(false); } };
  const own = product?.sellerId === user?.id;
  return <View className='page detail-page'><LoginGate returnTo={`/pages/detail/index?id=${encodeURIComponent(id)}`}>
    {error ? <ErrorState message={error} retry={() => void load()} /> : !product ? <Empty title={loading ? '正在加载好物…' : '未找到商品'} /> : <>
      <Swiper className='detail-gallery' indicatorDots={product.images.length > 1}>{(product.images.length ? product.images : ['']).map((src, index) => <SwiperItem key={index}><View onClick={() => { if (src) void Taro.previewImage({ urls: product.images, current: src }); }}><ProductImage key={src} product={product} src={src} large /></View></SwiperItem>)}</Swiper>
      <View className='detail-summary'><View className='detail-price-row'><Text className='detail-price'>¥{money(product.price)}</Text><Text className='status-pill'>{product.status}</Text></View><Text className='detail-title'>{product.title}</Text><View className='detail-tags'><Text>{product.condition}</Text><Text>{product.category}</Text><Text>{product.campus}{product.buildingName ? ` · ${product.buildingName}` : ''}</Text></View><Text className='muted'>{timeAgo(product.createdAt)}发布</Text></View>
      <View className='panel'><Text className='section-title'>关于这件闲置</Text><Text className='description'>{product.description}</Text></View>
      {Boolean(product.inspection?.items?.length) && <View className='panel'><Text className='section-title'>卖家填写的商品情况</Text>{product.inspection?.items.map((item) => <View className='declaration-row' key={item.code}><Text>{item.label}</Text><Text className='muted'>{DECLARATIONS[item.condition] || '未声明'}{item.note ? ` · ${item.note}` : ''}</Text></View>)}</View>}
      <View className='panel seller-panel'><View className='avatar'>{seller?.nickname.slice(0, 1) || '同'}</View><View><Text className='section-title'>{seller?.nickname || '本校同学'}</Text><Text className='subtitle'>{seller?.campus} · 同校商品</Text></View><Button className='text-button' openType='share'>分享</Button></View>
      <View className='panel contact-panel'><Text className='section-title'>{own ? '你的联系方式' : '联系卖家'}</Text>
        {product.contact ? <><Text className='contact-value'>{product.contact}</Text><Text className='muted'>{own ? product.contactPublic ? '你已选择向有权查看商品的同学公开联系方式。' : '只有获你同意的申请者可以查看。' : product.contactPublic ? '卖家已选择公开联系方式。' : '卖家已同意你的联系申请。'}</Text><Button className='secondary' onClick={() => void Taro.setClipboardData({ data: product.contact })}>复制联系方式</Button></> : <Text className='muted'>{request?.status === 'PENDING' ? '联系申请已发出，等待卖家同意。' : request?.status === 'REJECTED' ? '卖家暂未同意这次申请。' : '卖家未公开联系方式，你可以先申请联系。'}</Text>}
      </View>
      {!own && <View className='report-area'><Text className='text-action' onClick={() => setReporting(!reporting)}>举报此商品</Text>{reporting && <View className='panel'><Input className='field-input' value={reason} placeholder='请描述你发现的问题' maxlength={1000} onInput={(e) => setReason(e.detail.value)} /><Button className='secondary' disabled={busy} onClick={() => void run(async () => { if (!reason.trim()) { notify('请填写举报原因'); return; } await api.report(id, reason.trim()); setReporting(false); notify(isDemo ? '演示举报已保存' : '举报已提交'); })}>提交举报</Button></View>}</View>}
      <Text className='footnote'>约在校内公共地点，当面验货后再付款。学校信息由用户填写，平台不核验学籍或身份。</Text>
      <View className='detail-actions'>{own ? <><Button className='secondary' onClick={() => editProduct(id)}>编辑商品</Button><Button className='primary' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index' })}>管理我的发布</Button></> : <>
        <Button className='secondary' disabled={busy} onClick={() => void run(() => toggleFavorite(id))}>{favorites.includes(id) ? '♥ 已收藏' : '♡ 收藏'}</Button>
        <Button className='primary' loading={busy} disabled={busy || (!product.contact && (product.status !== '在售' || Boolean(request)))} onClick={() => void run(async () => { if (product.contact) { await Taro.setClipboardData({ data: product.contact }); return; } setRequest(await api.requestContact(id)); notify('联系申请已发送'); })}>{product.contact ? '复制联系方式' : request?.status === 'PENDING' ? '等待卖家同意' : request?.status === 'REJECTED' ? '申请未通过' : product.status !== '在售' ? product.status : '我想要 · 申请联系'}</Button>
      </>}</View>
    </>}
  </LoginGate></View>;
}
