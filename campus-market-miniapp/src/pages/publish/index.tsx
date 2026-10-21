import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { LoginGate, PageTitle, PrivacyPopup } from '../../components';
import { imagesForSubmit, photoLimits, photosError, slotsFromImages, type PhotoSlot } from '../../images';
import { CATEGORIES, CONDITIONS, validateProduct, type InspectionTemplate, type ProductInput, type ProductVisibility } from '../../model';
import { takeEditingId, takePresetTextbook } from '../../navigation';
import { CONTACT_PUBLIC_HELP } from '../../contacts';
import { buildingHelp, listingInput, TEXTBOOK_CATEGORY, type ListingOriginal } from '../../listing';
import { visibilityProblem } from '../../circles';
import { describeLinked } from '../../catalog';
import { SUPPLY_PAGES } from '../../menu';
import { notify, notifyError, useClientConfig, useMarket, useUnread } from '../../state';
import { PhotoField } from '../../widgets/PhotoField';
import { BuildingPicker } from '../../widgets/BuildingPicker';
import { CampusPicker } from '../../widgets/CampusPicker';
import { VisibilityPicker } from '../../widgets/VisibilityPicker';
import { TextbookIsbnField, type LinkedTextbook } from '../../widgets/TextbookIsbnField';
import { BundlePublish } from './BundlePublish';

const BLANK: ProductInput = { title: '', description: '', price: 0, category: '生活用品', condition: '几乎全新', campus: '', images: [], contact: '', contactPublic: false };
const STATES = ['未测试', '正常', '存在问题', '不适用'];
const CODES = ['NOT_TESTED', 'NORMAL', 'DEFECT', 'NOT_APPLICABLE'] as const;
const STEP_TITLES = ['添加照片', '描述你的闲置', '说明情况并留下联系方式'];

export default function PublishPage() {
  const { user } = useMarket();
  useUnread(); // 页面显示时刷新 tabBar 未读角标
  const { max } = photoLimits(useClientConfig());
  const [kind, setKind] = useState<'SINGLE' | 'BUNDLE'>('SINGLE');
  const [form, setForm] = useState<ProductInput>({ ...BLANK }), [editId, setEditId] = useState(''), [original, setOriginal] = useState<ListingOriginal | null>(null);
  const [step, setStep] = useState(1);
  const [price, setPrice] = useState(''), [originalPrice, setOriginalPrice] = useState(''), [busy, setBusy] = useState(false);
  // 照片：每张单独显示上传进度与失败原因；提交时按顺序取上传得到的引用（upload:<id>）放进 images
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const uploading = photos.some((photo) => photo.status === 'uploading');
  const [template, setTemplate] = useState<InspectionTemplate | null>(null), [templateError, setTemplateError] = useState(''), [templateLoading, setTemplateLoading] = useState(false);
  const [declarations, setDeclarations] = useState<Record<string, { condition: typeof CODES[number]; note: string }>>({});
  // 取货楼栋（预填本人宿舍楼，可以改成别的楼或不指定）、可见范围、教材版本
  const [buildingId, setBuildingId] = useState<string | null>(null), [buildingLabel, setBuildingLabel] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProductVisibility>('PUBLIC'), [circleIds, setCircleIds] = useState<string[]>([]);
  const [textbook, setTextbook] = useState<LinkedTextbook | null>(null), [presetEdition, setPresetEdition] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const generation = useRef(0);
  const bundleEdit = Boolean(editId) && original?.bundle === true;

  const patch = (part: Partial<ProductInput>) => setForm((prev) => ({ ...prev, ...part }));
  const clear = () => {
    setForm({ ...BLANK, campus: user?.campus ?? '', contact: user?.contact ?? '', images: [] }); setPhotos([]); setEditId(''); setOriginal(null); setPrice(''); setOriginalPrice(''); setDeclarations({}); setStep(1);
    setBuildingId(user?.dormBuildingId ?? null); setVisibility('PUBLIC'); setCircleIds([]); setTextbook(null); setPresetEdition(null); setSubmitError('');
  };
  useEffect(clear, [user?.id]);

  const loadTemplate = (category: string) => {
    const gen = ++generation.current; setTemplate(null); setTemplateError(''); setTemplateLoading(Boolean(user) && !bundleEdit);
    if (!user || bundleEdit) return;
    api.template(category as ProductInput['category']).then((value) => {
      if (gen !== generation.current) return;
      setTemplate(value);
      setDeclarations((prev) => Object.fromEntries((value?.items ?? []).map((item) => [item.code, prev[item.code] ?? { condition: 'NOT_TESTED', note: '' }])));
    })
      .catch((e) => { if (gen === generation.current) setTemplateError(e instanceof Error ? e.message : '商品情况清单加载失败'); })
      .finally(() => { if (gen === generation.current) setTemplateLoading(false); });
  };
  useEffect(() => { loadTemplate(form.category); }, [form.category, user?.id, bundleEdit]);
  // 切离教材书籍分类时解除教材版本
  useEffect(() => { if (form.category !== TEXTBOOK_CATEGORY) setTextbook(null); }, [form.category]);

  useDidShow(() => {
    const preset = takePresetTextbook();
    if (preset && user) { clear(); setKind('SINGLE'); patch({ category: TEXTBOOK_CATEGORY }); setPresetEdition(preset); return; }
    const requestedId = takeEditingId(); if (!requestedId || !user) return;
    setBusy(true);
    api.detail(requestedId).then((p) => {
      if (p.sellerId !== user.id) throw new Error('只能编辑自己的商品');
      setKind('SINGLE');
      setForm({ title: p.title, description: p.description, category: p.category, campus: p.campus, condition: p.condition, price: p.price, originalPrice: p.originalPrice, contact: p.contact, contactPublic: Boolean(p.contactPublic), images: [] });
      // 响应里是 1 小时有效的签名地址：显示用它，提交时换回 upload:<id>
      setPhotos(slotsFromImages(p.images, (url) => api.imageRef(url), max));
      setPrice(String(p.price)); setOriginalPrice(p.originalPrice ? String(p.originalPrice) : ''); setEditId(p.id); setStep(2);
      setBuildingId(p.buildingId ?? null);
      const circles = (p.circles ?? []).map((c) => c.id);
      setVisibility(p.visibility ?? 'PUBLIC'); setCircleIds(circles);
      setTextbook(p.textbook ? { editionId: p.textbook.editionId, label: describeLinked(p.textbook) } : null);
      setOriginal({ visibility: p.visibility ?? 'PUBLIC', circleIds: circles, textbookEditionId: p.textbook?.editionId ?? null, bundle: p.listingKind === 'BUNDLE' });
      setDeclarations(Object.fromEntries((p.inspection?.items ?? []).map((item) => [item.code, { condition: CODES.includes(item.condition as typeof CODES[number]) ? item.condition : 'NOT_TESTED', note: item.note ?? '' }])) as Record<string, { condition: typeof CODES[number]; note: string }>);
    }).catch(notifyError).finally(() => setBusy(false));
  });

  const goStep = (next: number) => { setStep(next); void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }); };

  const forward = () => {
    if (step === 1) {
      const problem = photosError(photos); if (problem) { notify(problem); return; }
      if (!imagesForSubmit(photos).length) { notify('请至少添加 1 张商品图片'); return; }
      goStep(2); return;
    }
    if (step === 2) {
      if (!form.title.trim()) { notify('请填写商品名称'); return; }
      if (price.trim() === '' || !(Number(price) > 0)) { notify('请输入大于 0 的出售价格'); return; }
      goStep(3);
    }
  };

  const submit = async () => {
    if (busy || uploading) return;
    if (price.trim() === '') { notify('请输入出售价格'); return; }
    const problem = photosError(photos); if (problem) { notify(problem); return; }
    const base: ProductInput = { ...form, images: imagesForSubmit(photos), title: form.title.trim(), description: form.description.trim(), contact: form.contact.trim(), price: Number(price), originalPrice: originalPrice === '' ? undefined : Number(originalPrice), ...(template && !bundleEdit ? { inspection: template.items.map((item) => ({ itemCode: item.code, condition: declarations[item.code]?.condition ?? 'NOT_TESTED', note: declarations[item.code]?.note || undefined })) } : {}) };
    const error = validateProduct(base, max) ?? visibilityProblem(visibility, circleIds); if (error) { notify(error); return; }
    if (templateLoading) { notify('请等待商品情况清单加载完成'); return; }
    const input = listingInput(base, { buildingId, visibility, circleIds, textbookEditionId: textbook?.editionId ?? null }, original ?? undefined);
    setBusy(true); setSubmitError('');
    try { const product = await api.publish(input, editId || undefined); clear(); notify(editId ? '修改已保存' : '商品已发布'); await Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` }); }
    catch (e) { setSubmitError(e instanceof Error ? e.message : '发布失败，请重试'); notifyError(e); } finally { setBusy(false); }
  };

  return <View className='page publish-page'>
    <PageTitle title={editId ? '编辑你的闲置' : '发布闲置'} subtitle={editId ? '改完记得保存，同学看到的会立刻更新。' : '三步填完，同校同学就能看到。'} />
    <LoginGate returnTo='/pages/publish/index'>
      {!editId && <>
        <View className='segmented'>
          {([['SINGLE', '单件'], ['BUNDLE', '整套打包']] as const).map(([value, label]) => <Text key={value} className={kind === value ? 'selected' : ''} onClick={() => setKind(value)}>{label}</Text>)}
        </View>
        <Text className='text-action sheet-line' onClick={() => void Taro.navigateTo({ url: SUPPLY_PAGES.batches })}>一次发布多件？使用毕业季快速发布</Text>
      </>}

      {kind === 'BUNDLE' && !editId ? <BundlePublish /> : <>
        <View className='step-bar'>{[1, 2, 3].map((i) => <View key={i} className={`step-seg ${step >= i ? 'done' : ''}`} />)}</View>
        <View className='step-line'><Text>第 <Text className='step-num'>{step}</Text> 步 / 共 3 步 · {STEP_TITLES[step - 1]}</Text><Text>{editId ? '编辑中' : ''}</Text></View>

        {editId && <View className='notice'><Text>正在编辑已发布的商品</Text><Text className='text-action' onClick={clear}>改为新发布</Text></View>}
        {bundleEdit && <Text className='notice sheet-line'>整套打包：这里修改整套的标题、价格、图片等信息，打包明细保持不变。</Text>}

        {step === 1 && <View className='form-card'>
          <PhotoField photos={photos} onChange={setPhotos} disabled={busy} />
          <Text className='field-help'>第一张图会作为列表封面，建议实拍、光线充足。</Text>
        </View>}

        {step === 2 && <>
          <View className='form-card'>
            <Text className='field-label'>商品名称 <Text className='optional'>（{form.title.length}/60）</Text></Text>
            <Input className='field-input' placeholder='例如：自用宿舍护眼台灯' value={form.title} maxlength={60} onInput={(e) => patch({ title: e.detail.value })} />

            <Text className='field-label'>商品描述</Text>
            <Textarea className='field-textarea' placeholder='用了多久、有没有瑕疵、配件是否齐全…' value={form.description} maxlength={4000} onInput={(e) => patch({ description: e.detail.value })} />

            <Text className='field-label'>分类</Text>
            <View className='choice-grid'>{CATEGORIES.map((c) => <Text key={c} className={`choice ${form.category === c ? 'active' : ''}`} onClick={() => patch({ category: c })}>{bundleEdit && c === '其他' ? '其他 / 混合物品' : c}</Text>)}</View>

            <Text className='field-label'>成色</Text>
            <View className='choice-grid'>{CONDITIONS.map((c) => <Text key={c} className={`choice ${form.condition === c ? 'active' : ''}`} onClick={() => patch({ condition: c })}>{c}</Text>)}</View>

            <View className='form-columns'>
              <View><Text className='field-label'>{bundleEdit ? '整套总价' : '售价'}</Text><View className='price-field'><Text className='prefix'>¥</Text><Input type='digit' value={price} placeholder='0.00' onInput={(e) => setPrice(e.detail.value)} /></View></View>
              <View><Text className='field-label'>原价 <Text className='optional'>选填</Text></Text><View className='price-field'><Text className='prefix'>¥</Text><Input type='digit' value={originalPrice} placeholder='0.00' onInput={(e) => setOriginalPrice(e.detail.value)} /></View></View>
            </View>

            <Text className='field-label'>交易地点</Text>
            <CampusPicker value={form.campus} onChange={(campus) => patch({ campus })} />
            <Text className='field-label'>取货楼栋（选填）</Text>
            <BuildingPicker campus={form.campus} value={buildingId} onChange={setBuildingId} emptyLabel='不指定楼栋' zoneLabel='取货园区' buildingLabel='取货楼栋' onLabel={setBuildingLabel} />
            <Text className='field-help'>{buildingHelp(buildingId ? buildingLabel : null)}</Text>
          </View>
          {form.category === TEXTBOOK_CATEGORY && !bundleEdit && <TextbookIsbnField value={textbook} onChange={setTextbook} presetEditionId={presetEdition} onPresetHandled={() => setPresetEdition(null)}
            changed={Boolean(editId) && (textbook?.editionId ?? null) !== (original?.textbookEditionId ?? null)} />}
        </>}

        {step === 3 && <>
          {!bundleEdit && <View className='panel'>
            <View className='section-head'><Text className='section-title'>如实说明商品情况</Text>{templateLoading ? <Text className='section-hint'>加载中…</Text> : null}</View>
            {templateError ? <View>
              <Text className='error-text'>{templateError}</Text>
              <Button className='secondary small mt-12' onClick={() => loadTemplate(form.category)}>重新加载</Button>
            </View> : templateLoading ? <Text className='muted'>正在加载这份清单…</Text> : template?.items.map((item) => <View key={item.code} className='declaration-field'>
              <Text className='field-label'>{item.label}</Text>
              <Picker range={STATES} value={CODES.indexOf(declarations[item.code]?.condition ?? 'NOT_TESTED')} onChange={(e) => setDeclarations({ ...declarations, [item.code]: { ...declarations[item.code], condition: CODES[Number(e.detail.value)], note: declarations[item.code]?.note ?? '' } })}>
                <View className='picker'><Text className='picker-value'>{STATES[CODES.indexOf(declarations[item.code]?.condition ?? 'NOT_TESTED')]}</Text><View className='i-chevron' /></View>
              </Picker>
              <Input className='field-input' value={declarations[item.code]?.note ?? ''} placeholder='补充说明（选填）' maxlength={200} onInput={(e) => setDeclarations({ ...declarations, [item.code]: { condition: declarations[item.code]?.condition ?? 'NOT_TESTED', note: e.detail.value } })} />
            </View>)}
          </View>}

          <View className='form-card'>
            <Text className='field-label'>联系方式</Text>
            <Input className='field-input' value={form.contact} placeholder='微信号 / 手机号' maxlength={100} onInput={(e) => patch({ contact: e.detail.value })} />
            <View className='switch-row'>
              <View className='switch-text'><Text>公开展示联系方式</Text><Text className='field-help'>{CONTACT_PUBLIC_HELP}</Text></View>
              <Switch color='#194E41' checked={form.contactPublic} onChange={(e) => patch({ contactPublic: e.detail.value })} />
            </View>
          </View>
          <VisibilityPicker visibility={visibility} circleIds={circleIds} onChange={(next) => { setVisibility(next.visibility); setCircleIds(next.circleIds); }} />
        </>}

        {submitError ? <Text className='error-text'>{submitError}</Text> : null}
        <View className='step-actions'>
          {step > 1 && <Button className='secondary back' onClick={() => goStep(step - 1)}>上一步</Button>}
          {step < 3 ? <Button className='primary next' onClick={forward}>下一步</Button>
            : <Button className='primary next' loading={busy} disabled={busy || uploading || templateLoading} onClick={() => void submit()}>{editId ? '保存修改' : '发布这件闲置'}</Button>}
        </View>
        <Text className='footnote'>请如实填写商品信息，联系方式默认不公开。</Text>
      </>}
    </LoginGate>
    <PrivacyPopup />
  </View>;
}
