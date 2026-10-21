import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import { Empty, LoginGate, PageTitle } from '../../../components';
import { CAMPUSES, type Campus, type CoursePage, type Term } from '../../../model';
import { COURSES_INTRO, DEMO_CATALOG_NOTE, TERM_OPTIONS, termLabel } from '../../../catalog';
import { TEXTBOOK_PAGES } from '../../../menu';
import { useMarket } from '../../../state';

const PAGE_SIZE = 20;

/** 课程教材入口：按课程名 / 课程代码搜索本校课程目录（学校由服务端从登录用户推导），不读取任何个人选课信息。 */
export default function CoursesPage() {
  const { user } = useMarket();
  const [draft, setDraft] = useState(''), [q, setQ] = useState(''), [term, setTerm] = useState<Term | ''>(''), [campus, setCampus] = useState<Campus | ''>(''), [page, setPage] = useState(1);
  const [result, setResult] = useState<CoursePage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current; setLoading(true); setError('');
    try { const r = await api.courses({ q: q || undefined, term: term || undefined, campus: campus || undefined, page, pageSize: PAGE_SIZE }); if (gen === sequence.current) setResult(r); }
    catch (e) { if (gen === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, [q, term, campus, page, user?.id]);
  useDidShow(() => { if (result) void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  return <View className='page'>
    <PageTitle title='课程教材' subtitle={COURSES_INTRO} />
    <LoginGate returnTo={TEXTBOOK_PAGES.courses}>
      <Text className='notice sheet-line'>{DEMO_CATALOG_NOTE}</Text>
      <View className='inline-row'>
        <Input className='field-input' value={draft} placeholder='课程名称或代码' maxlength={80} confirmType='search' onInput={(e) => setDraft(e.detail.value)} onConfirm={() => { setQ(draft.trim()); setPage(1); }} />
        <Button className='primary small' onClick={() => { setQ(draft.trim()); setPage(1); }}>搜索</Button>
      </View>
      <View className='form-columns'>
        <Picker range={['全部学期', ...TERM_OPTIONS.map(termLabel)]} value={term ? TERM_OPTIONS.indexOf(term) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); setTerm(i ? TERM_OPTIONS[i - 1] : ''); setPage(1); }}>
          <View className='picker'><Text className='picker-value'>{term ? termLabel(term) : '全部学期'}</Text><View className='i-chevron' /></View>
        </Picker>
        <Picker range={['全部校区', ...CAMPUSES]} value={campus ? CAMPUSES.indexOf(campus) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); setCampus(i ? CAMPUSES[i - 1] : ''); setPage(1); }}>
          <View className='picker'><Text className='picker-value'>{campus || '全部校区'}</Text><View className='i-chevron' /></View>
        </Picker>
      </View>
      <Text className='muted'>{loading ? '正在搜索…' : result ? `共 ${result.total} 门课程` : ''}</Text>
      {error ? <Text className='error-text'>{error}</Text> : null}
      {result && !result.items.length && !loading ? <Empty title='没有找到课程，换个关键词试试。' /> : null}
      {result?.items.map((c) => <View key={c.id} className='req-card' onClick={() => void Taro.navigateTo({ url: `${TEXTBOOK_PAGES.course}?id=${encodeURIComponent(c.id)}` })}>
        <Text className='req-name'>{c.name}</Text>
        <Text className='req-sub'>{c.courseCode ? `${c.courseCode} · ` : ''}{c.department ?? '开课单位未注明'} · {c.offeringCount ?? 0} 个开课学期 · {c.textbookCount ?? 0} 本指定 / 推荐教材{c.isDemo ? ' · 演示' : ''}</Text>
      </View>)}
      {result && totalPages > 1 && <View className='button-row'>
        <Button className='secondary small' disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Text className='muted'>第 {page} / {totalPages} 页</Text>
        <Button className='secondary small' disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
      </View>}
      <Text className='text-action sheet-line' onClick={() => void Taro.navigateTo({ url: TEXTBOOK_PAGES.suggestions })}>我的教材建议</Text>
    </LoginGate>
  </View>;
}
