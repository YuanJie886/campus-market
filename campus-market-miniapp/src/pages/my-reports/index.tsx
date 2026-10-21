import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, LoginGate, PageTitle } from '../../components';
import type { MyReport } from '../../model';
import { AWAITING_STAFF_REPORT, formatDateTime, MY_REPORTS_INTRO, REPORT_REASON_LABEL, reportStatusText, TARGET_LABEL } from '../../governance';
import { useMarket } from '../../state';

/** 我的举报：只有状态摘要（已收到 / 处理中 / 已结束，以及平台是否采取了措施），不显示处理细节或被举报人的处罚。 */
export default function MyReportsPage() {
  const { user } = useMarket();
  const [items, setItems] = useState<MyReport[] | null>(null), [error, setError] = useState('');
  const sequence = useRef(0);
  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current;
    try { const list = await api.myReports(); if (gen === sequence.current) { setItems(list); setError(''); } }
    catch (e) { if (gen === sequence.current) { setItems((previous) => previous ?? []); setError(e instanceof Error ? e.message : '加载失败'); } }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  return <View className='page'>
    <PageTitle title='我的举报' subtitle={MY_REPORTS_INTRO} />
    <LoginGate returnTo='/pages/my-reports/index'>
      {error ? <Text className='error-text'>{error}</Text> : null}
      {items === null ? <Empty title='正在读取…' /> : !items.length ? <Empty title='你还没有提交过举报。' /> : items.map((r) => <View className='req-card' key={r.id}>
        <Text className='req-name'>{TARGET_LABEL[r.targetType] ?? r.targetType} · {REPORT_REASON_LABEL[r.reasonCode] ?? r.reasonCode}</Text>
        <Text className='gov-line'>状态：{reportStatusText(r)}</Text>
        {r.awaitingEligibleStaff ? <Text className='gov-note warn'>{AWAITING_STAFF_REPORT}</Text> : null}
        <Text className='gov-meta'>提交于 {formatDateTime(r.createdAt)}</Text>
      </View>)}
    </LoginGate>
  </View>;
}
