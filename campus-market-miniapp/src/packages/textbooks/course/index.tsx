import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { Empty, LoginGate, PageTitle } from '../../../components';
import type { CourseDetail, TextbookEdition } from '../../../model';
import { DEMO_CATALOG_NOTE, offeringLabel, usageLabel } from '../../../catalog';
import { TEXTBOOK_PAGES } from '../../../menu';
import { useMarket } from '../../../state';
import { EditionSummary } from '../EditionSummary';
import { SuggestionForm } from '../SuggestionForm';
import { TextbookSubscribe } from '../TextbookSubscribe';

/** 课程详情：各学期的指定教材版本（只有已验证的关系），每本附本校在售数量；有货直达该版本，无货可以订阅。 */
export default function CourseDetailPage() {
  const { user } = useMarket(), id = useRouter().params.id ?? '';
  const [course, setCourse] = useState<CourseDetail | null>(null), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [subscribeFor, setSubscribeFor] = useState<TextbookEdition | null>(null), [suggesting, setSuggesting] = useState(false);
  const load = async () => { if (!user) return; try { setCourse(await api.course(id)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  return <View className='page'>
    <LoginGate returnTo={`${TEXTBOOK_PAGES.course}?id=${encodeURIComponent(id)}`}>
      {error ? <View><Text className='error-text'>{error}</Text><Button className='secondary small' onClick={() => void Taro.navigateBack()}>返回课程教材</Button></View> : !course ? <Empty title='正在读取课程…' /> : <>
        <PageTitle title={course.name} subtitle={`${course.courseCode ? `${course.courseCode} · ` : ''}${course.department ?? '开课单位未注明'}`} />
        {course.isDemo ? <Text className='notice sheet-line'>{DEMO_CATALOG_NOTE}</Text> : null}
        {status ? <Text className='notice sheet-line'>{status}</Text> : null}
        {!course.offerings.length ? <Text className='muted'>这门课暂时没有开课记录。</Text> : null}
        {course.offerings.map((o) => <View key={o.id} className='form-card'>
          <Text className='section-title'>{offeringLabel(o)}{o.campusId ? ` · ${o.campusId}` : ''}</Text>
          {!o.textbooks.length ? <Text className='muted'>本学期还没有已验证的教材信息。</Text> : o.textbooks.map(({ usageType, edition }) => <View key={edition.id} className='req-card'>
            <Text className={`status-pill ${usageType === 'REQUIRED' ? 'ok' : 'mute'}`}>{usageLabel(usageType)}</Text>
            <Text className='req-sub'>本校在售 {edition.onSaleCount} 件</Text>
            <EditionSummary edition={edition} />
            <View className='button-row wrap'>
              <Button className={edition.onSaleCount > 0 ? 'primary small' : 'secondary small'} onClick={() => void Taro.navigateTo({ url: `${TEXTBOOK_PAGES.textbook}?id=${encodeURIComponent(edition.id)}` })}>
                {edition.onSaleCount > 0 ? `查看这个版本的在售商品（${edition.onSaleCount}）` : '查看版本详情'}
              </Button>
              {edition.onSaleCount === 0 && <Button className='secondary small' onClick={() => setSubscribeFor(edition)}>订阅这个教材版本</Button>}
            </View>
            {subscribeFor?.id === edition.id && <TextbookSubscribe edition={edition} hasDorm={Boolean(user?.dormBuildingId)} onClose={() => setSubscribeFor(null)} onDone={(m) => { setSubscribeFor(null); setStatus(m); }} />}
          </View>)}
        </View>)}
        <View className='form-card'>
          <Text className='section-title'>教材信息不对或缺了？</Text>
          <Text className='field-help'>你可以提交建议。建议不会公开，也不会自动变成正式教材。</Text>
          {suggesting ? <SuggestionForm offerings={course.offerings} onClose={() => setSuggesting(false)} onDone={(m) => { setSuggesting(false); setStatus(m); }} />
            : <Button className='secondary small' disabled={!course.offerings.length} onClick={() => setSuggesting(true)}>为这门课建议教材</Button>}
          <Text className='text-action sheet-line' onClick={() => void Taro.navigateTo({ url: TEXTBOOK_PAGES.suggestions })}>我的教材建议</Text>
        </View>
      </>}
    </LoginGate>
  </View>;
}
