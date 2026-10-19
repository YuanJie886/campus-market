import Taro, { useDidShow, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import { Button, Input, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import { Empty, ErrorState, LoginGate, ProductImage, StatusPill } from '../../components';
import { money, timeAgo, type ContactRequest, type Product, type User } from '../../model';
import { editProduct } from '../../navigation';
import { notify, notifyError, useMarket } from '../../state';

const DECLARATIONS: Record<string, string> = { NORMAL: '正常', DEFECT: '存在问题', NOT_TESTED: '未测试', NOT_APPLICABLE: '不适用' };
const TONE: Record<string, string> = { NORMAL: 'ok', DEFECT: 'warn', NOT_TESTED: 'mute', NOT_APPLICABLE: 'mute' };

export default function DetailPage() {
  const { user, favorites, toggleFavorite } = useMarket(), router = useRouter();
  const id = router.params.id ?? '';
  const [product, setProduct] = useState<Product | null>(null), [seller, setSeller] = useState<User | null>(null), [request, setRequest] = useState<ContactRequest | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reporting, setReporting] = useState(false), [reason, setReason] = useState('');
  const [gallery, setGallery] = useState(0);
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
  useEffect(() => { sequence.current++; setProduct(null); setSeller(null); setRequest(null); setGallery(0); void load(); }, [user?.id, id]);
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useShareAppMessage(() => ({ title: product?.title ?? '校园闲置好物', path: `/pages/detail/index?id=${encodeURIComponent(id)}` }));

  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { notifyError(e); } finally { setBusy(false); } };
  const own = product?.sellerId === user?.id;
  const images = product?.images?.length ? product.images : [''];
  const blocked = Boolean(product) && !product?.contact && (product?.status !== '在售' || Boolean(request));
  const hint = !product ? '' : product.contact ? '' : request?.status === 'PENDING' ? '申请已发出，等待卖家同意' : request?.status === 'REJECTED' ? '卖家暂未同意这次申请' : product.status !== '在售' ? `商品${product.status}，暂时无法申请` : '';
  const defects = product?.inspection?.items?.filter((item) => item.condition === 'DEFECT').length ?? 0;

  return <View className='detail-page'><LoginGate returnTo={`/pages/detail/index?id=${encodeURIComponent(id)}`}>
    {error ? <View className='page'><ErrorState message={error} retry={() => void load()} /></View> : !product ? <View className='page'><Empty title={loading ? '正在加载好物…' : '未找到商品'} /></View> : <>
      <View className='detail-gallery'>
        <Swiper className='gallery-swiper' indicatorDots={false} circular={images.length > 1} onChange={(e) => setGallery(e.detail.current)}>
          {images.map((src, index) => <SwiperItem key={index}>
            <View onClick={() => { if (src) void Taro.previewImage({ urls: product.images, current: src }); }}>
              <ProductImage key={src} product={product} src={src} large />
            </View>
          </SwiperItem>)}
        </Swiper>
        {images.length > 1 && <Text className='gallery-count'>{gallery + 1} / {images.length}</Text>}
      </View>

      <View className='detail-section detail-hero'>
        <View className='detail-price-row'>
          <Text className='detail-price'><Text className='currency'>¥</Text>{money(product.price)}</Text>
          {product.originalPrice && product.originalPrice > product.price ? <Text className='detail-original'>¥{money(product.originalPrice)}</Text> : null}
          <StatusPill status={product.status} />
        </View>
        <Text className='detail-title'>{product.title}</Text>
        <View className='detail-tags'>
          <Text className='detail-tag brand'>{product.condition}</Text>
          <Text className='detail-tag'>{product.category}</Text>
          <Text className='detail-tag'>{product.campus}{product.buildingName ? ` · ${product.buildingName}` : ''}</Text>
        </View>
        <Text className='detail-meta'>{timeAgo(product.createdAt)}发布 · {product.views} 次浏览</Text>
      </View>

      <View className='detail-section'>
        <View className='seller-card'>
          <View className='avatar'>{seller?.nickname.slice(0, 1) || '同'}</View>
          <View><Text className='seller-name'>{seller?.nickname || '本校同学'}</Text><Text className='seller-meta'>{seller?.campus} · 同校商品</Text></View>
          <Button className='text-button' openType='share'>分享</Button>
        </View>
      </View>

      {Boolean(product.inspection?.items?.length) && <View className='detail-section'>
        <View className='section-head'><Text className='section-title'>商品情况</Text><Text className='section-hint'>{product.inspection?.items.length} 项已说明{defects ? ` · ${defects} 项有问题` : ''}</Text></View>
        {product.inspection?.items.map((item) => <View className='declaration-row' key={item.code}>
          <Text className='declaration-key'>{item.label}</Text>
          <Text className={`declaration-value ${TONE[item.condition] ?? 'mute'}`}>{DECLARATIONS[item.condition] || '未声明'}{item.note ? ` · ${item.note}` : ''}</Text>
        </View>)}
      </View>}

      <View className='detail-section'>
        <View className='section-head'><Text className='section-title'>关于这件闲置</Text></View>
        <Text className='description'>{product.description}</Text>
      </View>

      <View className='detail-section contact-panel'>
        <View className='section-head'><Text className='section-title'>{own ? '你的联系方式' : '联系卖家'}</Text></View>
        {product.contact ? <><Text className='contact-value'>{product.contact}</Text><Text className='muted'>{own ? (product.contactPublic ? '你已选择向有权查看商品的同学公开联系方式。' : '只有获你同意的申请者可以查看。') : product.contactPublic ? '卖家已选择公开联系方式。' : '卖家已同意你的联系申请。'}</Text><Button className='secondary small' onClick={() => void Taro.setClipboardData({ data: product.contact })}>复制联系方式</Button></> : <Text className='muted'>{request?.status === 'PENDING' ? '联系申请已发出，等待卖家同意。' : request?.status === 'REJECTED' ? '卖家暂未同意这次申请。' : '卖家未公开联系方式，你可以先申请联系。'}</Text>}
      </View>

      <Text className='footnote'>约在校内公共地点，当面验货后再付款。学校信息由用户填写，平台不核验学籍或身份。</Text>

      {!own && <View className='report-area'>
        <Text className='report-link' onClick={() => setReporting(!reporting)}>{reporting ? '收起' : '举报此商品'}</Text>
        {reporting && <View className='panel report-panel'>
          <Input className='field-input' value={reason} placeholder='请描述你发现的问题' maxlength={1000} onInput={(e) => setReason(e.detail.value)} />
          <Button className='secondary mt-12' disabled={busy} onClick={() => void run(async () => { if (!reason.trim()) { notify('请填写举报原因'); return; } await api.report(id, reason.trim()); setReporting(false); notify(isDemo ? '演示举报已保存' : '举报已提交'); })}>提交举报</Button>
        </View>}
      </View>}

      <View className='detail-bar'>
        {hint ? <Text className='detail-hint'>{hint}</Text> : null}
        <View className='detail-bar-row'>
          {own ? <>
            <Button className='secondary' onClick={() => editProduct(id)}>编辑商品</Button>
            <Button className='primary' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index' })}>管理我的发布</Button>
          </> : <>
            <View className={`fav-btn ${favorites.includes(id) ? 'active' : ''}`} onClick={() => void run(() => toggleFavorite(id))}>
              <View className={favorites.includes(id) ? 'i-heart-on' : 'i-heart'} />
              <Text>{favorites.includes(id) ? '已收藏' : '收藏'}</Text>
            </View>
            <Button className='primary' loading={busy} disabled={busy || blocked} onClick={() => void run(async () => {
              if (product.contact) { await Taro.setClipboardData({ data: product.contact }); return; }
              setRequest(await api.requestContact(id)); notify('联系申请已发送');
            })}>{product.contact ? '复制联系方式' : '我想要'}</Button>
          </>}
        </View>
      </View>
    </>}
  </LoginGate></View>;
}
