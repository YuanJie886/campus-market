import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { CIRCLE_MAX_PER_PRODUCT, type Circle, type ProductVisibility } from '../model';
import { CIRCLE_TYPE_LABEL, VISIBILITY_OPTIONS, toggleCircle, visibilityHelp } from '../circles';
import { CIRCLE_PAGES } from '../menu';

/**
 * 发布时的可见范围（与 Web VisibilityPicker 一致）：默认「全校公开」；「圈子可见」必须由卖家主动选择，并勾选 1～5 个自己在籍的圈子。
 * 不会默认勾选任何圈子；只在选择「圈子可见」后才读取我的圈子。下面始终写清楚谁能看到。
 */
export function VisibilityPicker({ visibility, circleIds, onChange, error }: { visibility: ProductVisibility; circleIds: string[]; onChange: (next: { visibility: ProductVisibility; circleIds: string[] }) => void; error?: string | null }) {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const want = visibility === 'CIRCLE_ONLY';
  useEffect(() => {
    if (!want || circles !== null) return;
    let active = true;
    api.myCircles().then((list) => { if (active) setCircles(list.filter((c) => c.status === 'ACTIVE')); }).catch(() => { if (active) setCircles([]); });
    return () => { active = false; };
  }, [want, circles]);
  const names = (circles ?? []).filter((c) => circleIds.includes(c.id)).map((c) => c.name);
  return <View className='panel'>
    <Text className='section-title'>谁能看到这件商品</Text>
    <View className='choice-grid mt-12'>
      {VISIBILITY_OPTIONS.map(([value, label]) => <Text key={value} className={`choice ${visibility === value ? 'active' : ''}`} onClick={() => onChange({ visibility: value, circleIds: value === 'PUBLIC' ? [] : circleIds })}>{label}</Text>)}
    </View>
    <Text className='field-help'>{visibilityHelp(visibility, names)}</Text>
    {want && (circles === null ? <Text className='muted'>正在读取你的圈子…</Text>
      : !circles.length ? <Text className='muted'>你还没有加入任何圈子。<Text className='text-action' onClick={() => void Taro.navigateTo({ url: CIRCLE_PAGES.list })}>创建或加入圈子</Text></Text>
        : <View>
          <Text className='field-label'>选择圈子（已选 {circleIds.length} / 最多 {CIRCLE_MAX_PER_PRODUCT} 个）</Text>
          {circles.map((c) => {
            const checked = circleIds.includes(c.id), blocked = !checked && circleIds.length >= CIRCLE_MAX_PER_PRODUCT;
            return <View key={c.id} className={`check-row ${blocked ? 'disabled' : ''}`} onClick={() => { if (!blocked) onChange({ visibility, circleIds: toggleCircle(circleIds, c.id, !checked) }); }}>
              <View className={`agreement-box ${checked ? 'checked' : ''}`}>{checked ? '✓' : ''}</View>
              <Text>{c.name}<Text className='muted'>（{CIRCLE_TYPE_LABEL[c.type]} · 用户创建）</Text></Text>
            </View>;
          })}
        </View>)}
    {error ? <Text className='error-text'>{error}</Text> : null}
  </View>;
}
