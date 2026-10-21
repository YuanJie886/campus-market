import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import type { Campus, DemandConditions } from '../model';
import { CAMPUSES, CATEGORIES } from '../model';
import { circleScopeText, demandFormFrom, demandSubmit, FORM_INTRO, FORM_RULES, MAX_KEYWORD_LENGTH, SCOPE_LABEL, SCOPE_ORDER, type DemandForm as Form } from '../demand';
import { BuildingPicker } from './BuildingPicker';

/**
 * 需求订阅表单（与 Web DemandSubscribeDialog 一致）：创建（搜索空态、圈子）与修改共用；预填只是省事，每一项都可以改。
 * 地理范围以 BUILDING / ZONE / CAMPUS / SCHOOL 保存；圈子订阅的范围固定为这个圈子。服务端错误原样显示在提交按钮上方。
 */
export function DemandForm({ title, submitLabel, initial, userCampus, busy, errorMessage, onCancel, onSubmit, circleScope = null }: {
  title: string; submitLabel: string; initial: DemandConditions; userCampus: Campus; busy?: boolean; errorMessage?: string | null;
  onCancel: () => void; onSubmit: (conditions: DemandConditions) => void; circleScope?: { name: string | null } | null;
}) {
  const [form, setForm] = useState<Form>(() => demandFormFrom(initial, userCampus)), [local, setLocal] = useState('');
  useEffect(() => { setForm(demandFormFrom(initial, userCampus)); setLocal(''); }, [initial, userCampus]);
  const patch = (part: Partial<Form>) => setForm((f) => ({ ...f, ...part }));
  const submit = () => {
    const result = demandSubmit(form, Boolean(circleScope));
    if ('error' in result) { setLocal(result.error); return; }
    setLocal(''); onSubmit(result.conditions);
  };
  const shown = local || errorMessage || '';
  return <View className='panel'>
    <Text className='section-title'>{title}</Text>
    <Text className='field-help'>{FORM_INTRO}</Text>
    {FORM_RULES.map((line) => <Text key={line} className='muted sheet-line'>· {line}</Text>)}
    <Text className='field-label'>关键词</Text>
    <Input className='field-input' value={form.keyword} maxlength={MAX_KEYWORD_LENGTH * 2} onInput={(e) => patch({ keyword: e.detail.value })} />
    <Text className='field-help'>最多 {MAX_KEYWORD_LENGTH} 个字，大小写与空格不影响匹配</Text>
    <Text className='field-label'>分类（选填）</Text>
    <Picker range={['不限分类', ...CATEGORIES]} value={form.category ? CATEGORIES.indexOf(form.category) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); patch({ category: i ? CATEGORIES[i - 1] : '' }); }}>
      <View className='picker'><Text className='picker-value'>{form.category || '不限分类'}</Text><View className='i-chevron' /></View>
    </Picker>
    <View className='form-columns'>
      <View><Text className='field-label'>最低价（选填）</Text><Input className='field-input' type='digit' value={form.minPrice} onInput={(e) => patch({ minPrice: e.detail.value })} /></View>
      <View><Text className='field-label'>最高价（选填）</Text><Input className='field-input' type='digit' value={form.maxPrice} onInput={(e) => patch({ maxPrice: e.detail.value })} /></View>
    </View>
    {circleScope ? <Text className='notice sheet-line'>{circleScopeText(circleScope.name)}</Text> : <>
      <Text className='field-label'>地理范围</Text>
      <View className='choice-grid'>{SCOPE_ORDER.map((s) => <Text key={s} className={`choice ${form.geoScope === s ? 'active' : ''}`} onClick={() => patch({ geoScope: s })}>{SCOPE_LABEL[s]}</Text>)}</View>
      {form.geoScope === 'CAMPUS' && <Picker range={[...CAMPUSES]} value={Math.max(0, CAMPUSES.indexOf(form.campusId))} onChange={(e) => patch({ campusId: CAMPUSES[Number(e.detail.value)] })}>
        <View className='picker mt-12'><Text className='picker-value'>校区：{form.campusId}</Text><View className='i-chevron' /></View>
      </Picker>}
      {(form.geoScope === 'BUILDING' || form.geoScope === 'ZONE') && <View className='mt-12'>
        <BuildingPicker campus={userCampus} value={form.buildingId} onChange={(buildingId) => patch({ buildingId })} emptyLabel='使用我的宿舍楼' buildingLabel={form.geoScope === 'ZONE' ? '以哪栋楼所在园区为准' : '楼栋'} />
        {form.geoScope === 'ZONE' ? <Text className='field-help'>园区由所选楼栋推导</Text> : null}
      </View>}
    </>}
    {shown ? <Text className='error-text'>{shown}</Text> : null}
    <View className='button-row'>
      <Button className='secondary small' onClick={onCancel}>取消</Button>
      <Button className='primary small' disabled={busy} loading={busy} onClick={submit}>{submitLabel}</Button>
    </View>
  </View>;
}
