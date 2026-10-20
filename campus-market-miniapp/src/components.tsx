import Taro from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import { useEffect, useState, type ReactNode } from 'react';
import type { Product, ProductStatus } from './model';
import { CATEGORY_EMOJI, CATEGORY_STYLE, money, timeAgo } from './model';
import { imageSrc, isDemo } from './api';
import { PRIVACY_PAGE, PRIVACY_SUMMARY, TERMS_PAGE, type LegalDocument } from './legal';
import { PRIVACY_AGREE_BUTTON_ID } from './privacy';
import { privacy } from './privacyGuard';
import { goLogin, notifyError, useMarket } from './state';

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return <View className='page-title'><View><Text className='title'>{title}</Text>{subtitle && <Text className='subtitle'>{subtitle}</Text>}</View>{isDemo && <Text className='demo-tag'>演示版</Text>}</View>;
}

export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <View className='empty'><View className='empty-symbol'>◇</View><Text className='empty-title'>{title}</Text>{description && <Text className='muted empty-description'>{description}</Text>}{action}</View>;
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
    {src && imageSrc(src) && !failed ? <Image src={imageSrc(src)} mode='aspectFill' className='image' onError={() => setFailed(true)} /> : <Text className='image-emoji'>{CATEGORY_EMOJI[product.category]}</Text>}
  </View>;
}

export function StatusPill({ status }: { status: ProductStatus }) {
  const tone = status === '在售' ? 'ok' : 'mute';
  return <Text className={`status-pill ${tone}`}>{status}</Text>;
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
      }}><Text className={active ? 'i-heart-on' : 'i-heart'} /></Button>
      {product.status !== '在售' && <Text className='sold-label'>{product.status}</Text>}
    </View>
    <View className='card-content'>
      <Text className='card-title'>{product.title}</Text>
      <View className='price-line'><Text className='price'><Text className='currency'>¥</Text>{money(product.price)}</Text>{product.originalPrice && product.originalPrice > product.price && <Text className='original'>¥{money(product.originalPrice)}</Text>}</View>
      <View className='card-meta'><Text>{product.campus}</Text><View className='meta-dot' /><Text>{timeAgo(product.createdAt)}</Text></View>
    </View>
  </View>;
}

export function ProductGrid({ products }: { products: Product[] }) { return <View className='product-grid'>{products.map((p) => <ProductCard key={p.id} product={p} />)}</View>; }
export function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <Empty title='暂时无法加载' description={message} action={<Button className='secondary' onClick={retry}>重新加载</Button>} />; }

const openLegal = (url: string) => { void Taro.navigateTo({ url }); };
/** 文中的《用户协议》《隐私政策》链接。 */
export function LegalLinks() {
  return <><Text className='legal-link' onClick={(e) => { e.stopPropagation(); openLegal(TERMS_PAGE); }}>《用户协议》</Text>和<Text className='legal-link' onClick={(e) => { e.stopPropagation(); openLegal(PRIVACY_PAGE); }}>《隐私政策》</Text></>;
}

/** 注册前必须勾选的「已阅读并同意」。 */
export function AgreementCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <View className='agreement-row' onClick={() => onChange(!checked)}>
    <View className={`agreement-box ${checked ? 'checked' : ''}`} ariaRole='checkbox' ariaChecked={checked}>{checked ? '✓' : ''}</View>
    <Text className='agreement-text'>已阅读并同意<LegalLinks /></Text>
  </View>;
}

/** 用户协议 / 隐私政策页面：顶部醒目标注「草案，待法务审核后生效」。 */
export function LegalPage({ document }: { document: LegalDocument }) {
  return <View className='page legal-page'>
    <View className='legal-draft'><Text>{document.draft}</Text></View>
    <Text className='legal-title'>{document.title}</Text>
    {document.meta.map((line) => <Text key={line} className='legal-meta'>{line}</Text>)}
    {document.sections.map((section) => <View key={section.heading} className='legal-section'>
      <Text className='legal-heading'>{section.heading}</Text>
      {section.paragraphs.map((paragraph, index) => <Text key={index} className='legal-paragraph'>{paragraph}</Text>)}
    </View>)}
  </View>;
}

/**
 * 微信隐私授权弹窗：微信暂停隐私接口（或主动检查发现尚未同意）时显示摘要与完整政策链接；
 * 只有点击「同意」按钮（open-type=agreePrivacyAuthorization）才会同意，关闭或「拒绝」都是不同意。
 */
export function PrivacyPopup() {
  const [open, setOpen] = useState(privacy.open);
  useEffect(() => { setOpen(privacy.open); return privacy.subscribe(setOpen); }, []);
  if (!open) return null;
  return <View className='privacy-mask' catchMove>
    <View className='privacy-dialog'>
      <Text className='privacy-title'>隐私保护提示</Text>
      <Text className='privacy-lead'>使用这项功能前，请阅读并同意<LegalLinks />。我们会：</Text>
      {PRIVACY_SUMMARY.map((line) => <Text key={line} className='privacy-item'>· {line}</Text>)}
      <View className='privacy-actions'>
        <Button className='secondary' onClick={() => privacy.disagree()}>拒绝</Button>
        <Button id={PRIVACY_AGREE_BUTTON_ID} className='primary' openType='agreePrivacyAuthorization'
          onAgreePrivacyAuthorization={() => privacy.agree(PRIVACY_AGREE_BUTTON_ID)}
          onClick={() => { if (process.env.TARO_ENV !== 'weapp') privacy.agree(PRIVACY_AGREE_BUTTON_ID); }}>同意</Button>
      </View>
    </View>
  </View>;
}
