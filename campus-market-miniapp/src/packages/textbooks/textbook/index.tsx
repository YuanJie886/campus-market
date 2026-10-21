import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { Empty, LoginGate, ProductGrid } from '../../../components';
import type { TextbookDetail } from '../../../model';
import { DEMO_CATALOG_NOTE, OTHER_EDITIONS_NOTE, offeringLabel, usageLabel } from '../../../catalog';
import { TEXTBOOK_PAGES } from '../../../menu';
import { publishWithTextbook } from '../../../navigation';
import { useMarket } from '../../../state';
import { EditionSummary } from '../EditionSummary';
import { TextbookSubscribe } from '../TextbookSubscribe';

/** 教材版本详情：关联课程、精确版本的在售商品，以及单独分区、明确标注的「其他版本」——两组从不混在一起排序。 */
export default function TextbookDetailPage() {
  const { user } = useMarket(), id = useRouter().params.id ?? '';
  const [detail, setDetail] = useState<TextbookDetail | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [subscribing, setSubscribing] = useState(false);
  const load = async () => { if (!user) return; try { setDetail(await api.textbook(id)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  return <View className='page'>
    <LoginGate returnTo={`${TEXTBOOK_PAGES.textbook}?id=${encodeURIComponent(id)}`}>
      {error ? <Text className='error-text'>{error}</Text> : !detail ? <Empty title='正在读取教材…' /> : <>
        <View className='form-card'>
          <EditionSummary edition={detail} />
          {detail.isDemo ? <Text className='field-help'>{DEMO_CATALOG_NOTE}</Text> : null}
          {/* 无 ISBN 的版本无法按 ISBN 查找，从这里进入发布页；关联前仍需卖家确认 */}
          <Text className='text-action sheet-line' onClick={() => publishWithTextbook(detail.id)}>我有这一版，去发布</Text>
          {detail.courses.length > 0 && <View>
            <Text className='field-label'>用于这些课程</Text>
            {detail.courses.map((c) => <Text key={c.offeringId} className='sheet-line' onClick={() => void Taro.navigateTo({ url: `${TEXTBOOK_PAGES.course}?id=${encodeURIComponent(c.courseId)}` })}>
              <Text className='text-action'>{c.courseName}</Text><Text className='muted'> · {offeringLabel(c)} · {usageLabel(c.usageType)}</Text>
            </Text>)}
          </View>}
        </View>
        {status ? <Text className='notice sheet-line'>{status}</Text> : null}
        <Text className='gov-heading'>正是这个版本的在售商品（{detail.listings.length}）</Text>
        <Text className='field-help'>{detail.listingSort === 'nearest' ? '按离你的宿舍楼由近到远排列（直线估算）。' : '按最新发布排列。设置宿舍楼后可按距离排序。'}</Text>
        {!detail.listings.length ? <View className='panel'>
          <Text className='muted'>本校暂时没有这个版本在卖。</Text>
          {subscribing ? <TextbookSubscribe edition={detail} hasDorm={Boolean(user?.dormBuildingId)} onClose={() => setSubscribing(false)} onDone={(m) => { setSubscribing(false); setStatus(m); }} />
            : <Button className='primary small mt-12' onClick={() => setSubscribing(true)}>订阅这个教材版本</Button>}
        </View> : <ProductGrid products={detail.listings} />}
        {detail.otherEditions.length > 0 && <View className='panel other-editions'>
          <Text className='section-title'>其他版本（不是这个版本）</Text>
          <Text className='field-help'>{OTHER_EDITIONS_NOTE}</Text>
          {detail.otherEditions.map((e) => <Text key={e.id} className='sheet-line' onClick={() => void Taro.navigateTo({ url: `${TEXTBOOK_PAGES.textbook}?id=${encodeURIComponent(e.id)}` })}>
            <Text className='text-action'>{e.title} {e.editionLabel}</Text><Text className='muted'> · 在售 {e.onSaleCount} 件</Text>
          </Text>)}
          {detail.otherEditionListings.length > 0 && <ProductGrid products={detail.otherEditionListings} />}
        </View>}
      </>}
    </LoginGate>
  </View>;
}
