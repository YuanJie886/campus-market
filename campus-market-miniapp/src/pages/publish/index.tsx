import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Image, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo, uploadConfigured } from '../../api';
import { LoginGate, PageTitle } from '../../components';
import { CAMPUSES, CATEGORIES, CONDITIONS, validateProduct, type ProductInput, type InspectionTemplate } from '../../model';
import { takeEditingId } from '../../navigation';
import { notify, notifyError, useMarket } from '../../state';

const BLANK: ProductInput = { title: '', description: '', price: 0, category: '生活用品', condition: '几乎全新', campus: '东校区', images: [], contact: '', contactPublic: false };
const STATES = ['未测试', '正常', '存在问题', '不适用'];
const CODES = ['NOT_TESTED', 'NORMAL', 'DEFECT', 'NOT_APPLICABLE'] as const;
const SAMPLE_IMAGES = ['headphones', 'books', 'lamp', 'bike', 'bag', 'keyboard'];
const STEP_TITLES = ['添加照片', '描述你的闲置', '说明情况并留下联系方式'];

export default function PublishPage() {
  const { user } = useMarket();
  const [form, setForm] = useState<ProductInput>({ ...BLANK }), [editId, setEditId] = useState('');
  const [step, setStep] = useState(1);
  const [price, setPrice] = useState(''), [original, setOriginal] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState(''), [template, setTemplate] = useState<InspectionTemplate | null>(null), [templateError, setTemplateError] = useState(''), [templateLoading, setTemplateLoading] = useState(false);
  const [declarations, setDeclarations] = useState<Record<string, { condition: typeof CODES[number]; note: string }>>({});
  const generation = useRef(0);

  const patch = (part: Partial<ProductInput>) => setForm((prev) => ({ ...prev, ...part }));
  const clear = () => { setForm({ ...BLANK, campus: user?.campus ?? '东校区', contact: user?.contact ?? '', images: [] }); setEditId(''); setPrice(''); setOriginal(''); setDeclarations({}); setStep(1); };
  useEffect(clear, [user?.id]);

  const loadTemplate = (category: string) => {
    const gen = ++generation.current; setTemplate(null); setTemplateError(''); setTemplateLoading(Boolean(user));
    if (!user) return;
    api.template(category as ProductInput['category']).then((value) => {
      if (gen !== generation.current) return;
      setTemplate(value);
      setDeclarations((prev) => Object.fromEntries((value?.items ?? []).map((item) => [item.code, prev[item.code] ?? { condition: 'NOT_TESTED', note: '' }])));
    })
      .catch((e) => { if (gen === generation.current) setTemplateError(e instanceof Error ? e.message : '商品情况清单加载失败'); })
      .finally(() => { if (gen === generation.current) setTemplateLoading(false); });
  };
  useEffect(() => { loadTemplate(form.category); }, [form.category, user?.id]);

  useDidShow(() => {
    const requestedId = takeEditingId(); if (!requestedId || !user) return;
    setBusy(true);
    api.detail(requestedId).then((p) => {
      if (p.sellerId !== user.id) throw new Error('只能编辑自己的商品');
      if (p.listingKind === 'BUNDLE') throw new Error('整套打包商品请在网页版编辑');
      setForm({ title: p.title, description: p.description, category: p.category, campus: p.campus, condition: p.condition, price: p.price, originalPrice: p.originalPrice, contact: p.contact, contactPublic: Boolean(p.contactPublic), images: p.images });
      setPrice(String(p.price)); setOriginal(p.originalPrice ? String(p.originalPrice) : ''); setEditId(p.id); setStep(2);
      setDeclarations(Object.fromEntries((p.inspection?.items ?? []).map((item) => [item.code, { condition: CODES.includes(item.condition as typeof CODES[number]) ? item.condition : 'NOT_TESTED', note: item.note ?? '' }])) as Record<string, { condition: typeof CODES[number]; note: string }>);
    }).catch(notifyError).finally(() => setBusy(false));
  });

  const addPhoto = async () => {
    if (uploading || busy) return;
    if (!uploadConfigured) { notify('图片上传尚未配置，可先添加已有商品图片链接'); return; }
    if (form.images.length >= 5) { notify('最多上传 5 张图片'); return; }
    setUploading(true);
    try {
      const selected = await Taro.chooseMedia({ count: 5 - form.images.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const completed: string[] = [];
      for (const file of selected.tempFiles) {
        if (file.size > 10 * 1024 * 1024) { notify('图片不能超过 10MB'); continue; }
        try {
          let path = file.tempFilePath;
          if (isDemo && process.env.TARO_ENV !== 'h5') {
            const saved = await Taro.saveFile({ tempFilePath: file.tempFilePath });
            if (!('savedFilePath' in saved)) throw new Error('图片本地保存失败，请重新选择');
            path = saved.savedFilePath;
          }
          completed.push(await api.upload(path));
        } catch (e) { notifyError(e); }
      }
      setForm((previous) => ({ ...previous, images: [...previous.images, ...completed].slice(0, 5) }));
    } catch (e) { if (!(e as { errMsg?: string })?.errMsg?.includes('cancel')) notifyError(e); }
    finally { setUploading(false); }
  };

  const goStep = (next: number) => { setStep(next); void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }); };

  const forward = () => {
    if (step === 1) {
      if (!form.images.length) { notify('请至少添加 1 张商品图片'); return; }
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
    const input: ProductInput = { ...form, title: form.title.trim(), description: form.description.trim(), contact: form.contact.trim(), price: Number(price), originalPrice: original === '' ? undefined : Number(original), ...(template ? { inspection: template.items.map((item) => ({ itemCode: item.code, condition: declarations[item.code]?.condition ?? 'NOT_TESTED', note: declarations[item.code]?.note || undefined })) } : {}) };
    const error = validateProduct(input); if (error) { notify(error); return; }
    if (templateLoading) { notify('请等待商品情况清单加载完成'); return; }
    setBusy(true);
    try { const product = await api.publish(input, editId || undefined); clear(); notify(editId ? '修改已保存' : '商品已发布'); await Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(product.id)}` }); }
    catch (e) { notifyError(e); } finally { setBusy(false); }
  };

  return <View className='page publish-page'>
    <PageTitle title={editId ? '编辑你的闲置' : '发布闲置'} subtitle={editId ? '改完记得保存，同学看到的会立刻更新。' : '三步填完，同校同学就能看到。'} />
    <LoginGate returnTo='/pages/publish/index'>
      <View className='step-bar'>{[1, 2, 3].map((i) => <View key={i} className={`step-seg ${step >= i ? 'done' : ''}`} />)}</View>
      <View className='step-line'><Text>第 <Text className='step-num'>{step}</Text> 步 / 共 3 步 · {STEP_TITLES[step - 1]}</Text><Text>{editId ? '编辑中' : ''}</Text></View>

      {editId && <View className='notice'><Text>正在编辑已发布的商品</Text><Text className='text-action' onClick={clear}>改为新发布</Text></View>}

      {step === 1 && <View className='form-card'>
        <Text className='field-label'>商品图片 <Text className='optional'>（{form.images.length}/5，第 1 张为主图）</Text></Text>
        <View className='photo-grid'>
          {form.images.map((src, i) => <View className='photo-item' key={`${src}-${i}`}>
            <Image src={src} mode='aspectFill' onClick={() => void Taro.previewImage({ current: src, urls: form.images })} />
            {i === 0 && <Text className='photo-main'>主图</Text>}
            <Text className='remove-photo' onClick={() => patch({ images: form.images.filter((_, index) => index !== i) })}>×</Text>
          </View>)}
          {form.images.length < 5 && <View className='add-photo' onClick={() => void addPhoto()}>
            <View className='i-camera' />
            <Text>{uploading ? '正在上传' : '拍照 / 相册'}</Text>
          </View>}
        </View>
        {isDemo && <><Text className='field-help'>演示版也可以直接选一张示意插画</Text><View className='sample-images'>{SAMPLE_IMAGES.map((name) => <Image key={name} src={`/assets/goods/${name}.png`} mode='aspectFill' onClick={() => { const src = `/assets/goods/${name}.png`; if (!form.images.includes(src) && form.images.length < 5) patch({ images: [...form.images, src] }); }} />)}</View></>}
        {!uploadConfigured && <><Text className='field-help'>当前上传服务尚未配置，联调时可添加已有的 HTTP(S) 图片链接。</Text><View className='inline-input'><Input className='field-input' value={url} placeholder='https://…' onInput={(e) => setUrl(e.detail.value)} /><Button className='secondary small' onClick={() => { if (!/^https?:\/\//.test(url.trim()) || form.images.length >= 5) { notify('请输入有效链接，最多 5 张'); return; } patch({ images: [...form.images, url.trim()] }); setUrl(''); }}>添加</Button></View></>}
        <Text className='field-help'>第一张图会作为列表封面，建议实拍、光线充足。</Text>
      </View>}

      {step === 2 && <View className='form-card'>
        <Text className='field-label'>商品名称 <Text className='optional'>（{form.title.length}/60）</Text></Text>
        <Input className='field-input' placeholder='例如：自用宿舍护眼台灯' value={form.title} maxlength={60} onInput={(e) => patch({ title: e.detail.value })} />

        <Text className='field-label'>商品描述</Text>
        <Textarea className='field-textarea' placeholder='用了多久、有没有瑕疵、配件是否齐全…' value={form.description} maxlength={4000} onInput={(e) => patch({ description: e.detail.value })} />

        <Text className='field-label'>分类</Text>
        <View className='choice-grid'>{CATEGORIES.map((c) => <Text key={c} className={`choice ${form.category === c ? 'active' : ''}`} onClick={() => patch({ category: c })}>{c}</Text>)}</View>

        <Text className='field-label'>成色</Text>
        <View className='choice-grid'>{CONDITIONS.map((c) => <Text key={c} className={`choice ${form.condition === c ? 'active' : ''}`} onClick={() => patch({ condition: c })}>{c}</Text>)}</View>

        <View className='form-columns'>
          <View><Text className='field-label'>售价</Text><View className='price-field'><Text className='prefix'>¥</Text><Input type='digit' value={price} placeholder='0.00' onInput={(e) => setPrice(e.detail.value)} /></View></View>
          <View><Text className='field-label'>原价 <Text className='optional'>选填</Text></Text><View className='price-field'><Text className='prefix'>¥</Text><Input type='digit' value={original} placeholder='0.00' onInput={(e) => setOriginal(e.detail.value)} /></View></View>
        </View>

        <Text className='field-label'>交易地点</Text>
        <Picker range={[...CAMPUSES]} value={CAMPUSES.indexOf(form.campus)} onChange={(e) => patch({ campus: CAMPUSES[Number(e.detail.value)] })}>
          <View className='picker'><Text className='picker-value'>{form.campus}</Text><View className='i-chevron' /></View>
        </Picker>
      </View>}

      {step === 3 && <>
        <View className='panel'>
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
        </View>

        <View className='form-card'>
          <Text className='field-label'>联系方式</Text>
          <Input className='field-input' value={form.contact} placeholder='微信号 / 手机号' maxlength={100} onInput={(e) => patch({ contact: e.detail.value })} />
          <View className='switch-row'>
            <View className='switch-text'><Text>公开展示联系方式</Text><Text className='field-help'>关闭时，只有获你同意的同学能查看。</Text></View>
            <Switch color='#194E41' checked={form.contactPublic} onChange={(e) => patch({ contactPublic: e.detail.value })} />
          </View>
        </View>
      </>}

      <View className='step-actions'>
        {step > 1 && <Button className='secondary back' onClick={() => goStep(step - 1)}>上一步</Button>}
        {step < 3 ? <Button className='primary next' onClick={forward}>下一步</Button>
          : <Button className='primary next' loading={busy} disabled={busy || uploading || templateLoading} onClick={() => void submit()}>{editId ? '保存修改' : '发布这件闲置'}</Button>}
      </View>
      <Text className='footnote'>请如实填写商品信息，联系方式默认不公开。</Text>
    </LoginGate>
  </View>;
}
