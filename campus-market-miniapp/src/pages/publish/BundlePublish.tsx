import Taro from '@tarojs/taro';
import { Button, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { imagesForSubmit, photosError, type PhotoSlot } from '../../images';
import { CAMPUSES, CATEGORIES, CONDITIONS, type Campus, type ProductVisibility } from '../../model';
import { CONTACT_PUBLIC_HELP } from '../../contacts';
import { averagePerItem, BUNDLE_NOTICE, bundleFormProblems, bundleInput, categoryOptionLabel, emptyBundleRow, rowTotals, type BundleRow } from '../../supply';
import { buildingHelp } from '../../listing';
import { notify, useMarket } from '../../state';
import { PhotoField } from '../../widgets/PhotoField';
import { BuildingPicker } from '../../widgets/BuildingPicker';
import { VisibilityPicker } from '../../widgets/VisibilityPicker';
import { BundleRowsEditor } from '../../widgets/BundleRowsEditor';

/**
 * 整套打包发布（与 Web BundleProductForm 一致）：一个商品主体（标题、总价、主分类或「其他 / 混合物品」）+ 2～30 条明细；
 * 整套展示，买家只能针对整套申请查看联系方式。分类与成色都不预选；发布失败时服务端的原话显示在发布按钮上方。
 */
export function BundlePublish() {
  const { user } = useMarket();
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [price, setPrice] = useState('');
  const [category, setCategory] = useState(''), [condition, setCondition] = useState(''), [campus, setCampus] = useState<Campus>(user?.campus ?? '东校区');
  const [buildingId, setBuildingId] = useState<string | null>(user?.dormBuildingId ?? null), [buildingLabel, setBuildingLabel] = useState<string | null>(null);
  const [contact, setContact] = useState(user?.contact ?? ''), [contactPublic, setContactPublic] = useState(false);
  const [photos, setPhotos] = useState<PhotoSlot[]>([]), [rows, setRows] = useState<BundleRow[]>(() => [emptyBundleRow(), emptyBundleRow()]);
  const [visibility, setVisibility] = useState<ProductVisibility>('PUBLIC'), [circleIds, setCircleIds] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]), [submitError, setSubmitError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setCampus(user?.campus ?? '东校区'); setContact(user?.contact ?? ''); setBuildingId(user?.dormBuildingId ?? null); }, [user?.id]);
  const uploading = photos.some((p) => p.status === 'uploading');
  const average = /^\d+(\.\d{1,2})?$/.test(price.trim()) ? averagePerItem(Number(price), rowTotals(rows).quantity) : null;

  const submit = async () => {
    if (busy) return;
    const photoProblem = photosError(photos);
    const form = { title, description, price, category, condition, campus, buildingId, images: imagesForSubmit(photos), uploading, contact, contactPublic, rows, visibility, circleIds };
    const list = [...bundleFormProblems(form), ...(photoProblem && !uploading ? [photoProblem] : [])];
    setProblems(list);
    if (list.length) { void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }); return; }
    setBusy(true); setSubmitError('');
    try {
      const product = await api.publish(bundleInput(form));
      notify('发布成功');
      await Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` });
    } catch (e) { setSubmitError(e instanceof Error ? e.message : '发布失败，请重试'); }
    finally { setBusy(false); }
  };

  return <View>
    <Text className='notice sheet-line'>{BUNDLE_NOTICE}</Text>
    {problems.length > 0 && <View className='problem-box'>
      <Text className='section-title'>还有内容需要补充</Text>
      {problems.map((p) => <Text key={p} className='error-text'>· {p}</Text>)}
    </View>}
    <View className='form-card'>
      <Text className='field-label'>整套标题</Text>
      <Input className='field-input' value={title} maxlength={100} onInput={(e) => setTitle(e.detail.value)} />
      <Text className='field-label'>描述</Text>
      <Textarea className='field-textarea' value={description} maxlength={4000} onInput={(e) => setDescription(e.detail.value)} />
      <Text className='field-label'>整套总价（元）</Text>
      <View className='price-field'><Text className='prefix'>¥</Text><Input type='digit' value={price} placeholder='0.00' maxlength={12} onInput={(e) => setPrice(e.detail.value)} /></View>
      {average ? <Text className='field-help'>平均每件约 ¥{average}（仅供展示）</Text> : null}
      <Text className='field-label'>主分类</Text>
      <View className='choice-grid'>{CATEGORIES.map((c) => <Text key={c} className={`choice ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{categoryOptionLabel(c, true)}</Text>)}</View>
      <Text className='field-label'>整体成色</Text>
      <View className='choice-grid'>{CONDITIONS.map((c) => <Text key={c} className={`choice ${condition === c ? 'active' : ''}`} onClick={() => setCondition(c)}>{c}</Text>)}</View>
      <Text className='field-label'>校区</Text>
      <Picker range={[...CAMPUSES]} value={CAMPUSES.indexOf(campus)} onChange={(e) => { setCampus(CAMPUSES[Number(e.detail.value)] as Campus); setBuildingId(null); }}>
        <View className='picker'><Text className='picker-value'>{campus}</Text><View className='i-chevron' /></View>
      </Picker>
      <Text className='field-label'>取货楼栋（选填）</Text>
      <BuildingPicker campus={campus} value={buildingId} onChange={setBuildingId} emptyLabel='不指定楼栋' zoneLabel='取货园区' buildingLabel='取货楼栋' onLabel={setBuildingLabel} />
      <Text className='field-help'>{buildingHelp(buildingId ? buildingLabel : null)}</Text>
    </View>
    <View className='form-card'><PhotoField photos={photos} onChange={setPhotos} disabled={busy} /></View>
    <View className='form-card'>
      <Text className='field-label'>联系方式</Text>
      <Input className='field-input' value={contact} placeholder='微信号 / 手机号' maxlength={100} onInput={(e) => setContact(e.detail.value)} />
      <View className='switch-row'>
        <View className='switch-text'><Text>公开展示联系方式</Text><Text className='field-help'>{CONTACT_PUBLIC_HELP}</Text></View>
        <Switch color='#194E41' checked={contactPublic} onChange={(e) => setContactPublic(e.detail.value)} />
      </View>
    </View>
    <BundleRowsEditor rows={rows} onChange={setRows} />
    <VisibilityPicker visibility={visibility} circleIds={circleIds} onChange={(next) => { setVisibility(next.visibility); setCircleIds(next.circleIds); }} />
    {submitError ? <Text className='error-text'>{submitError}</Text> : null}
    <View className='step-actions'><Button className='primary next' loading={busy} disabled={busy || uploading} onClick={() => void submit()}>发布整套</Button></View>
  </View>;
}
