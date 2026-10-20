import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Image, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, imageSrc, isDemo } from '../../api';
import { LoginGate, PageTitle, PrivacyPopup } from '../../components';
import { addPickedFiles, addReadySlot, IMAGE_TOO_LARGE, imagesForSubmit, MAX_IMAGES, moveSlot, photosError, removeSlot, slotFailed, slotProgress, slotRetrying, slotsFromImages, slotUploaded, type PhotoSlot } from '../../images';
import { isPrivacyDenied, PRIVACY_REQUIRED_MESSAGE } from '../../privacy';
import { requirePrivacy } from '../../privacyGuard';
import { CAMPUSES, CATEGORIES, CONDITIONS, validateProduct, type ProductInput, type InspectionTemplate } from '../../model';
import { takeEditingId } from '../../navigation';
import { CONTACT_PUBLIC_HELP } from '../../contacts';
import { notify, notifyError, useMarket, useUnread } from '../../state';

const BLANK: ProductInput = { title: '', description: '', price: 0, category: '生活用品', condition: '几乎全新', campus: '东校区', images: [], contact: '', contactPublic: false };
const STATES = ['未测试', '正常', '存在问题', '不适用'];
const CODES = ['NOT_TESTED', 'NORMAL', 'DEFECT', 'NOT_APPLICABLE'] as const;
const SAMPLE_IMAGES = ['headphones', 'books', 'lamp', 'bike', 'bag', 'keyboard'];
const STEP_TITLES = ['添加照片', '描述你的闲置', '说明情况并留下联系方式'];

export default function PublishPage() {
  const { user } = useMarket();
  useUnread(); // 页面显示时刷新 tabBar 未读角标
  const [form, setForm] = useState<ProductInput>({ ...BLANK }), [editId, setEditId] = useState('');
  const [step, setStep] = useState(1);
  const [price, setPrice] = useState(''), [original, setOriginal] = useState(''), [busy, setBusy] = useState(false), [picking, setPicking] = useState(false);
  // 照片：每张单独显示上传进度与失败原因；提交时按顺序取上传得到的引用（upload:<id>）放进 images
  const [photos, setPhotos] = useState<PhotoSlot[]>([]), photosRef = useRef(photos); photosRef.current = photos;
  const uploading = photos.some((photo) => photo.status === 'uploading');
  const [template, setTemplate] = useState<InspectionTemplate | null>(null), [templateError, setTemplateError] = useState(''), [templateLoading, setTemplateLoading] = useState(false);
  const [declarations, setDeclarations] = useState<Record<string, { condition: typeof CODES[number]; note: string }>>({});
  const generation = useRef(0);

  const patch = (part: Partial<ProductInput>) => setForm((prev) => ({ ...prev, ...part }));
  const clear = () => { setForm({ ...BLANK, campus: user?.campus ?? '东校区', contact: user?.contact ?? '', images: [] }); setPhotos([]); setEditId(''); setPrice(''); setOriginal(''); setDeclarations({}); setStep(1); };
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
      setForm({ title: p.title, description: p.description, category: p.category, campus: p.campus, condition: p.condition, price: p.price, originalPrice: p.originalPrice, contact: p.contact, contactPublic: Boolean(p.contactPublic), images: [] });
      // 响应里是 1 小时有效的签名地址：显示用它，提交时换回 upload:<id>
      setPhotos(slotsFromImages(p.images, (url) => api.imageRef(url)));
      setPrice(String(p.price)); setOriginal(p.originalPrice ? String(p.originalPrice) : ''); setEditId(p.id); setStep(2);
      setDeclarations(Object.fromEntries((p.inspection?.items ?? []).map((item) => [item.code, { condition: CODES.includes(item.condition as typeof CODES[number]) ? item.condition : 'NOT_TESTED', note: item.note ?? '' }])) as Record<string, { condition: typeof CODES[number]; note: string }>);
    }).catch(notifyError).finally(() => setBusy(false));
  });

  const uploadSlot = async (slot: PhotoSlot) => {
    try {
      let path = slot.filePath;
      if (isDemo && process.env.TARO_ENV !== 'h5') {
        // 演示模式不联网：把照片存成本机文件，演示库里只记路径
        const saved = await Taro.saveFile({ tempFilePath: path });
        if (!('savedFilePath' in saved)) throw new Error('图片本地保存失败，请重新选择');
        path = saved.savedFilePath;
      }
      const image = await api.upload(path, (percent) => setPhotos((prev) => slotProgress(prev, slot.key, percent)));
      setPhotos((prev) => slotUploaded(prev, slot.key, image));
    } catch (e) { setPhotos((prev) => slotFailed(prev, slot.key, e instanceof Error ? e : new Error('图片上传失败，请重试'))); }
  };

  const addPhoto = async () => {
    if (picking || busy) return;
    if (photosRef.current.length >= MAX_IMAGES) { notify(`最多 ${MAX_IMAGES} 张图片`); return; }
    setPicking(true);
    let queued: PhotoSlot[] = [];
    try {
      await requirePrivacy();
      const selected = await Taro.chooseMedia({ count: MAX_IMAGES - photosRef.current.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const added = addPickedFiles(photosRef.current, selected.tempFiles.map((file) => ({ path: file.tempFilePath, size: file.size })));
      photosRef.current = added.slots; setPhotos(added.slots); queued = added.queued;
    } catch (e) {
      const message = (e as { errMsg?: string })?.errMsg ?? '';
      if (!message.includes('cancel')) notify(isPrivacyDenied(e) ? PRIVACY_REQUIRED_MESSAGE : e instanceof Error ? e.message : '没有选到照片，请重试');
    } finally { setPicking(false); }
    // 逐张上传（服务端按用户每小时 60 张限流），每张单独显示进度与失败原因
    for (const slot of queued) await uploadSlot(slot);
  };

  const retryPhoto = (slot: PhotoSlot) => {
    if (!slot.filePath || slot.error === IMAGE_TOO_LARGE) return;
    setPhotos((prev) => slotRetrying(prev, slot.key));
    void uploadSlot(slot);
  };

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
    const input: ProductInput = { ...form, images: imagesForSubmit(photos), title: form.title.trim(), description: form.description.trim(), contact: form.contact.trim(), price: Number(price), originalPrice: original === '' ? undefined : Number(original), ...(template ? { inspection: template.items.map((item) => ({ itemCode: item.code, condition: declarations[item.code]?.condition ?? 'NOT_TESTED', note: declarations[item.code]?.note || undefined })) } : {}) };
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
        <Text className='field-label'>商品图片 <Text className='optional'>（{photos.length}/{MAX_IMAGES}，第 1 张为主图）</Text></Text>
        <View className='photo-grid'>
          {photos.map((photo, i) => <View className={`photo-item ${photo.status}`} key={photo.key}>
            <Image src={imageSrc(photo.preview)} mode='aspectFill' onClick={() => { const src = imageSrc(photo.preview); if (src) void Taro.previewImage({ current: src, urls: photos.map((p) => imageSrc(p.preview)).filter(Boolean) }); }} />
            {i === 0 && <Text className='photo-main'>主图</Text>}
            {photo.status === 'uploading' && <Text className='photo-state'>上传中 {photo.progress}%</Text>}
            {photo.status === 'failed' && <View className='photo-state failed' onClick={() => retryPhoto(photo)}>
              <Text>{photo.error}</Text>{photo.filePath && photo.error !== IMAGE_TOO_LARGE ? <Text className='photo-retry'>点此重试</Text> : null}
            </View>}
            <Text className='remove-photo' aria-label='移除这张照片' onClick={() => setPhotos((prev) => removeSlot(prev, photo.key))}>×</Text>
            {photos.length > 1 && <View className='photo-order'>
              {i > 0 ? <Text className='photo-move' onClick={() => setPhotos((prev) => moveSlot(prev, photo.key, -1))}>‹</Text> : <Text className='photo-move disabled' />}
              {i < photos.length - 1 ? <Text className='photo-move' onClick={() => setPhotos((prev) => moveSlot(prev, photo.key, 1))}>›</Text> : <Text className='photo-move disabled' />}
            </View>}
          </View>)}
          {photos.length < MAX_IMAGES && <View className='add-photo' onClick={() => void addPhoto()}>
            <View className='i-camera' />
            <Text>{picking ? '正在选择' : uploading ? '继续添加' : '拍照 / 相册'}</Text>
          </View>}
        </View>
        {isDemo && <><Text className='field-help'>演示版也可以直接选一张示意插画</Text><View className='sample-images'>{SAMPLE_IMAGES.map((name) => <Image key={name} src={`/assets/goods/${name}.png`} mode='aspectFill' onClick={() => setPhotos((prev) => addReadySlot(prev, `/assets/goods/${name}.png`))} />)}</View></>}
        <Text className='field-help'>支持 JPEG / PNG，每张不超过 5 MB；上传后会去掉拍摄地点等信息。用 ‹ › 调整顺序。</Text>
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
            <View className='switch-text'><Text>公开展示联系方式</Text><Text className='field-help'>{CONTACT_PUBLIC_HELP}</Text></View>
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
    <PrivacyPopup />
  </View>;
}
