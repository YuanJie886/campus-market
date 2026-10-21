import Taro from '@tarojs/taro';
import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { LoginGate, PageTitle } from '../../../components';
import type { CircleType, CircleVisibility } from '../../../model';
import { CIRCLE_TYPES, CIRCLE_TYPE_LABEL, CIRCLE_VISIBILITIES, CIRCLE_VISIBILITY_LABEL, CREATE_NOTE, circleFormProblems } from '../../../circles';
import { CIRCLE_PAGES } from '../../../menu';

/** 创建圈子：类型不预选；可见性默认私密。平台不核验班级或社团身份。 */
export default function CircleCreatePage() {
  const [type, setType] = useState<CircleType | ''>(''), [name, setName] = useState(''), [description, setDescription] = useState(''), [visibility, setVisibility] = useState<CircleVisibility>('PRIVATE');
  const [problems, setProblems] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => {
    const list = circleFormProblems({ type, name, description });
    setProblems(list);
    if (list.length || busy) return;
    setBusy(true); setError('');
    try { const circle = await api.createCircle({ type: type as CircleType, name: name.trim(), description: description.trim(), visibility }); void Taro.redirectTo({ url: `${CIRCLE_PAGES.detail}?id=${encodeURIComponent(circle.id)}` }); }
    catch (e) { setError(e instanceof Error ? e.message : '创建失败，请重试'); }
    finally { setBusy(false); }
  };
  return <View className='page'>
    <PageTitle title='创建圈子' />
    <LoginGate returnTo={CIRCLE_PAGES.create}>
      <Text className='notice sheet-line'>{CREATE_NOTE}</Text>
      {problems.length > 0 && <View className='problem-box'><Text className='section-title'>创建前请先修正以下问题</Text>{problems.map((p) => <Text key={p} className='error-text'>· {p}</Text>)}</View>}
      <View className='form-card'>
        <Text className='field-label'>圈子类型</Text>
        <View className='choice-grid'>{CIRCLE_TYPES.map((t) => <Text key={t} className={`choice ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{CIRCLE_TYPE_LABEL[t]}</Text>)}</View>
        <Text className='field-help'>只是给成员看的分类，不代表任何身份认证</Text>
        <Text className='field-label'>圈子名称</Text>
        <Input className='field-input' value={name} maxlength={30} onInput={(e) => setName(e.detail.value)} />
        <Text className='field-help'>2～30 个字</Text>
        <Text className='field-label'>简介（选填）</Text>
        <Textarea className='field-textarea' value={description} maxlength={200} onInput={(e) => setDescription(e.detail.value)} />
        <Text className='field-label'>谁能发现这个圈子</Text>
        {CIRCLE_VISIBILITIES.map((v) => <Text key={v} className={`choice block ${visibility === v ? 'active' : ''}`} onClick={() => setVisibility(v)}>{CIRCLE_VISIBILITY_LABEL[v]}</Text>)}
        <Text className='field-help'>无论哪种，加入都需要成员的邀请码</Text>
        {error ? <Text className='error-text'>{error}</Text> : null}
        <View className='button-row'>
          <Button className='secondary small' onClick={() => void Taro.navigateBack()}>取消</Button>
          <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>创建</Button>
        </View>
      </View>
    </LoginGate>
  </View>;
}
