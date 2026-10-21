import Taro, { useDidShow, usePullDownRefresh, useRouter, useShareAppMessage } from '@tarojs/taro';
import { Button, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, imageSrc } from '../../api';
import { Empty, ErrorState, LoginGate, PrivacyPopup, ProductImage, StatusPill } from '../../components';
import { isPrivacyDenied, PRIVACY_REQUIRED_MESSAGE } from '../../privacy';
import { requirePrivacy } from '../../privacyGuard';
import { money, timeAgo, type ContactRequest, type Product, type User } from '../../model';
import { CONFIRM, contactCta } from '../../contacts';
import { editProduct } from '../../navigation';
import { notify, notifyError, unread, useMarket, useSchools } from '../../state';
import { CommentBoard } from '../../widgets/CommentBoard';
import { ReportSheet } from '../../widgets/ReportSheet';
import { Avatar } from '../../widgets/Avatar';
import { CIRCLE_PAGES, TEXTBOOK_PAGES } from '../../menu';
import { PRODUCT_CIRCLE_NOTE } from '../../circles';
import { averagePerItem } from '../../supply';

const DECLARATIONS: Record<string, string> = { NORMAL: '正常', DEFECT: '存在问题', NOT_TESTED: '未测试', NOT_APPLICABLE: '不适用' };
const TONE: Record<string, string> = { NORMAL: 'ok', DEFECT: 'warn', NOT_TESTED: 'mute', NOT_APPLICABLE: 'mute' };

export default function DetailPage() {
  const { user, favorites, toggleFavorite } = useMarket(), { catalog } = useSchools(), router = useRouter();
  const id = router.params.id ?? '';
  const [product, setProduct] = useState<Product | null>(null), [seller, setSeller] = useState<User | null>(null), [request, setRequest] = useState<ContactRequest | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reporting, setReporting] = useState(false), [commentsKey, setCommentsKey] = useState(0);
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
  usePullDownRefresh(() => { setCommentsKey((k) => k + 1); void load().finally(() => Taro.stopPullDownRefresh()); });
  useShareAppMessage(() => ({ title: product?.title ?? '校园闲置好物', path: `/pages/detail/index?id=${encodeURIComponent(id)}` }));

  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { notifyError(e); } finally { setBusy(false); } };
  const own = product?.sellerId === user?.id;
  const images = product?.images?.length ? product.images : [''];
  const cta = product ? contactCta(product, request) : null;
  const hint = own ? '' : cta?.hint ?? '';
  const withdraw = () => run(async () => {
    if (!request) return;
    const answer = await Taro.showModal({ title: CONFIRM.withdraw.title, content: CONFIRM.withdraw.content, confirmText: '撤回申请', confirmColor: '#b4432f' });
    if (!answer.confirm) return;
    setRequest(await api.withdraw(request.id)); notify(CONFIRM.withdraw.done); void unread.refresh();
  });
  // 写剪贴板是微信隐私接口：先确认用户已同意隐私政策
  const copyContact = async (contact: string) => {
    await requirePrivacy();
    try { await Taro.setClipboardData({ data: contact }); }
    catch (e) { throw isPrivacyDenied(e) ? new Error(PRIVACY_REQUIRED_MESSAGE) : e instanceof Error ? e : new Error('复制失败，请重试'); }
  };
  /** 私信卖家：买家对这件商品的会话（已有则复用），进入会话页发送快捷消息。 */
  const openChat = () => run(async () => {
    const conversation = await api.openConversation(id);
    void Taro.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(conversation.id)}` });
  });
  const defects = product?.inspection?.items?.filter((item) => item.condition === 'DEFECT').length ?? 0;

  return <View className='detail-page'><LoginGate returnTo={`/pages/detail/index?id=${encodeURIComponent(id)}`}>
    {error ? <View className='page'><ErrorState message={error} retry={() => void load()} /></View> : !product ? <View className='page'><Empty title={loading ? '正在加载好物…' : '未找到商品'} /></View> : <>
      <View className='detail-gallery'>
        <Swiper className='gallery-swiper' indicatorDots={false} circular={images.length > 1} onChange={(e) => setGallery(e.detail.current)}>
          {images.map((src, index) => <SwiperItem key={index}>
            <View onClick={() => { if (imageSrc(src)) void Taro.previewImage({ urls: product.images.map(imageSrc).filter(Boolean), current: imageSrc(src) }); }}>
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
          <Text className='detail-tag'>{catalog.locationLabel(product.campus, product.buildingName)}</Text>
        </View>
        <Text className='detail-meta'>{timeAgo(product.createdAt)}发布 · {product.views} 次浏览</Text>
      </View>

      <View className='detail-section'>
        <View className='seller-card'>
          <Avatar value={seller?.avatar} userId={product.sellerId} nickname={seller?.nickname} />
          <View><Text className='seller-name'>{seller?.nickname || '本校同学'}</Text><Text className='seller-meta'>{catalog.campusLabel(seller?.campus)} · 同校商品</Text></View>
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

      {product.textbook && <View className='detail-section'>
        <View className='section-head'><Text className='section-title'>课程教材版本</Text></View>
        <Text className='description'>{product.textbook.title} {product.textbook.editionLabel}</Text>
        <Text className='muted sheet-line'>ISBN {product.textbook.isbn ?? '无 ISBN'} · 出版社 {product.textbook.publisher}</Text>
        <Text className='muted sheet-line'>关联课程：{product.textbook.courseNames.length ? product.textbook.courseNames.join('、') : '暂无已验证的课程'}</Text>
        <Text className='field-help'>以上是卖家发布时确认的版本。</Text>
        <Text className='text-action' onClick={() => void Taro.navigateTo({ url: `${TEXTBOOK_PAGES.textbook}?id=${encodeURIComponent(product.textbook!.editionId)}` })}>查看这个版本的其他在售商品</Text>
      </View>}

      {product.visibility === 'CIRCLE_ONLY' && <View className='detail-section'>
        <View className='section-head'><Text className='section-title'>圈子可见</Text></View>
        <Text className='muted'>{PRODUCT_CIRCLE_NOTE}</Text>
        {(product.circles ?? []).map((c) => <Text key={c.id} className='text-action sheet-line' onClick={() => void Taro.navigateTo({ url: `${CIRCLE_PAGES.detail}?id=${encodeURIComponent(c.id)}` })}>{c.name}</Text>)}
      </View>}

      {product.listingKind === 'BUNDLE' && (() => {
        const items = product.bundleItems ?? [], quantity = items.reduce((n, i) => n + i.quantity, 0), average = averagePerItem(product.price, quantity);
        return <View className='detail-section'>
          <View className='section-head'><Text className='section-title'>整套转让明细</Text></View>
          <Text className='notice sheet-line'>整套出售，不单独出售其中的物品。</Text>
          <Text className='muted sheet-line'>共 {items.length} 项 · {new Set(items.map((i) => i.category)).size} 类 / {quantity} 件 · 整套总价 ¥{money(product.price)}{average ? ` · 平均每件约 ¥${average}（仅供参考，不能按件购买）` : ''}</Text>
          {items.map((i) => <View key={i.itemCode} className='declaration-row'>
            <Text className='declaration-key'>{i.name} × {i.quantity}</Text>
            <Text className='declaration-value mute'>{i.category} · {i.condition}{i.note ? ` · ${i.note}` : ''}</Text>
          </View>)}
          <Text className='field-help'>以上明细由卖家填写，当面查看时请逐项核对；平台不做鉴定或担保。</Text>
        </View>;
      })()}

      <View className='detail-section'>
        <View className='section-head'><Text className='section-title'>关于这件闲置</Text></View>
        <Text className='description'>{product.description}</Text>
      </View>

      <View className='detail-section contact-panel'>
        <View className='section-head'><Text className='section-title'>{own ? '你的联系方式' : '联系卖家'}</Text></View>
        {product.contact ? <><Text className='contact-value'>{product.contact}</Text><Text className='muted'>{own ? (product.contactPublic ? '你已选择公开：所有能看到这件商品的本校登录同学都能看到。' : '只有你同意（且未撤回）的申请者可以查看。') : cta?.panel}</Text><Button className='secondary small' onClick={() => void copyContact(product.contact).catch(notifyError)}>复制联系方式</Button></> : <Text className='muted'>{cta?.panel}</Text>}
      </View>

      {own && product.moderationHidden ? <Text className='notice detail-note'>这件商品已被平台工作人员隐藏，其他同学暂时看不到。可以在「我的限制」里查看原因并申诉一次。</Text> : null}

      {user && <CommentBoard productId={id} user={user} refreshKey={commentsKey} />}

      <Text className='footnote'>约在校内公共地点，当面验货后再付款。学校信息由用户填写，平台不核验学籍或身份。</Text>

      {!own && <View className='report-area'>
        <Text className='report-link' onClick={() => setReporting(!reporting)}>{reporting ? '收起' : '举报此商品'}</Text>
        {reporting && <ReportSheet targetType='PRODUCT' targetId={id} targetLabel={product.title} onClose={() => setReporting(false)} />}
      </View>}

      <View className='detail-bar'>
        {hint ? <Text className='detail-hint'>{hint}</Text> : null}
        {!own && cta?.canWithdraw ? <Text className='detail-withdraw' onClick={() => void withdraw()}>撤回申请</Text> : null}
        <View className='detail-bar-row'>
          {own ? <>
            <Button className='secondary' onClick={() => editProduct(id)}>编辑商品</Button>
            <Button className='primary' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index' })}>管理我的发布</Button>
          </> : <>
            <View className={`fav-btn ${favorites.includes(id) ? 'active' : ''}`} onClick={() => void run(() => toggleFavorite(id))}>
              <View className={favorites.includes(id) ? 'i-heart-on' : 'i-heart'} />
              <Text>{favorites.includes(id) ? '已收藏' : '收藏'}</Text>
            </View>
            <Button className='secondary' disabled={busy} onClick={() => void openChat()}>私信卖家</Button>
            <Button className='primary' loading={busy} disabled={busy || !cta || cta.disabled} onClick={() => void run(async () => {
              if (!cta || cta.disabled) return;
              if (cta.kind === 'copy') { await copyContact(product.contact); return; }
              const again = request?.status === 'WITHDRAWN';
              try { setRequest(await api.requestContact(id)); notify(again ? '已重新申请' : '联系申请已发送'); }
              catch (e) { setRequest(await api.contactState(id).catch(() => request)); throw e; }
            })}>{cta?.label ?? '我想要'}</Button>
          </>}
        </View>
      </View>
    </>}
  </LoginGate><PrivacyPopup /></View>;
}
