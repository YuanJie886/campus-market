import { Button, Input, Picker, Switch, Text, Textarea, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { imagesForSubmit, photoLimits, photosError, slotsFromImages, type PhotoSlot } from '../../images';
import { clientConfig } from '../../state';
import { CAMPUSES, CATEGORIES, CONDITIONS, type Campus, type Category, type InspectionTemplate, type ListingDraft, type ListingValidation } from '../../model';
import { CONTACT_PUBLIC_HELP } from '../../contacts';
import { VALIDATION_LABEL, categoryOptionLabel, conflictText, draftFormFrom, draftPayload, missingText, versionConflict, type DraftForm } from '../../supply';
import { BuildingPicker } from '../../widgets/BuildingPicker';
import { BundleRowsEditor } from '../../widgets/BundleRowsEditor';
import { PhotoField } from '../../widgets/PhotoField';
import { VisibilityPicker } from '../../widgets/VisibilityPicker';

const STATES = ['未测试', '正常', '存在问题', '不适用'];
const CODES = ['NOT_TESTED', 'NORMAL', 'DEFECT', 'NOT_APPLICABLE'];

/**
 * 批量发布中的一件（也用于协助整理，与 Web ListingItemEditor 一致）：草稿允许不完整，留空的字段不提交，发布前由服务端逐项校验；
 * 不替卖家预选分类、成色或任何声明。协助人只看到可以整理的字段（标题、描述、分类、价格建议、打包明细、取货楼栋建议），没有联系方式。
 * 保存带 expectedVersion；别处已保存过更新的版本时（409）不覆盖、不合并，提示重新加载。
 */
export function DraftEditor({ draft, assistant = false, validation, label, onSaved, onReload }: {
  draft: ListingDraft; assistant?: boolean; validation?: ListingValidation; label: string; onSaved: (draft: ListingDraft) => void; onReload: () => void;
}) {
  const [form, setForm] = useState<DraftForm>(() => draftFormFrom(draft.payload));
  const [photos, setPhotos] = useState<PhotoSlot[]>(() => slotsFromImages(draft.payload.images ?? [], (url) => api.imageRef(url), photoLimits(clientConfig.current).max));
  const [template, setTemplate] = useState<InspectionTemplate | null>(null), [templateReady, setTemplateReady] = useState(true);
  const [saving, setSaving] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [conflict, setConflict] = useState<number | null>(null);
  const bundle = draft.draftType === 'BUNDLE';
  useEffect(() => {
    if (bundle || assistant || !(CATEGORIES as readonly string[]).includes(form.category)) { setTemplate(null); setTemplateReady(true); return; }
    let active = true; setTemplateReady(false);
    api.template(form.category as Category).then((t) => { if (active) setTemplate(t); }).catch(() => { if (active) setTemplate(null); }).finally(() => { if (active) setTemplateReady(true); });
    return () => { active = false; };
  }, [form.category, bundle, assistant]);
  const patch = (next: Partial<DraftForm>) => { setForm((f) => ({ ...f, ...next })); setStatus(''); };
  const save = async (ready = false) => {
    if (saving) return;
    const photoProblem = assistant ? null : photosError(photos);
    if (photoProblem) { setError(photoProblem); return; }
    setSaving(true); setError(''); setStatus('');
    try {
      const payload = draftPayload(draft, { ...form, images: imagesForSubmit(photos) }, { assistant, hasTemplate: Boolean(template), templateReady });
      const saved = await api.updateDraft(draft.id, { expectedVersion: draft.version, payload, ...(ready ? { status: 'READY' as const } : {}) });
      setStatus(ready ? `${label}已标记为可以发布` : `${label}已保存`);
      onSaved(saved);
    } catch (e) {
      const current = versionConflict(e);
      if (current !== null) setConflict(current); else setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally { setSaving(false); }
  };
  const problem = validation && validation.code !== 'VALID' ? validation : null;
  const campus = (CAMPUSES as readonly string[]).includes(form.campus) ? form.campus as Campus : null;
  const uploading = photos.some((p) => p.status === 'uploading');
  return <View className='form-card'>
    <Text className='section-title'>{label}{bundle ? '（整套打包）' : ''}</Text>
    {problem ? <Text className='notice sheet-line'>{VALIDATION_LABEL[problem.code]}{problem.code === 'MISSING_FIELD' ? `：${missingText(problem.field)}` : problem.message ? `：${problem.message}` : ''}</Text> : null}
    {conflict !== null ? <View className='notice'><Text>{conflictText(conflict)}</Text><Text className='text-action' onClick={onReload}>重新加载这件</Text></View> : null}
    <Text className='field-label'>标题</Text>
    <Input className='field-input' value={form.title} maxlength={100} onInput={(e) => patch({ title: e.detail.value })} />
    <Text className='field-label'>描述</Text>
    <Textarea className='field-textarea' value={form.description} maxlength={4000} onInput={(e) => patch({ description: e.detail.value })} />
    <Text className='field-label'>{bundle ? '整套总价（元）' : assistant ? '价格建议（元）' : '价格（元）'}</Text>
    <Input className='field-input' type='digit' value={form.price} maxlength={12} onInput={(e) => patch({ price: e.detail.value })} />
    <Text className='field-label'>{bundle ? '主分类' : '分类'}</Text>
    <View className='choice-grid'>{CATEGORIES.map((c) => <Text key={c} className={`choice ${form.category === c ? 'active' : ''}`} onClick={() => patch({ category: c, declarations: {} })}>{categoryOptionLabel(c, bundle)}</Text>)}</View>
    {!assistant && <>
      <Text className='field-label'>{bundle ? '整体成色' : '成色'}</Text>
      <View className='choice-grid'>{CONDITIONS.map((c) => <Text key={c} className={`choice ${form.condition === c ? 'active' : ''}`} onClick={() => patch({ condition: c })}>{c}</Text>)}</View>
      <Text className='field-label'>校区</Text>
      <Picker range={[...CAMPUSES]} value={Math.max(0, CAMPUSES.indexOf(form.campus as Campus))} onChange={(e) => patch({ campus: CAMPUSES[Number(e.detail.value)], buildingId: null })}>
        <View className='picker'><Text className='picker-value'>{form.campus || '请选择校区'}</Text><View className='i-chevron' /></View>
      </Picker>
    </>}
    <Text className='field-label'>{assistant ? '取货楼栋建议' : '取货楼栋'}</Text>
    {campus ? <BuildingPicker campus={campus} value={form.buildingId} onChange={(buildingId) => patch({ buildingId })} emptyLabel='不指定楼栋' zoneLabel='取货园区' buildingLabel={assistant ? '取货楼栋建议' : '取货楼栋'} />
      : <Text className='field-help'>{assistant ? '所有者还没有选择校区，暂时不能建议取货楼栋。' : '先选择校区，再选择取货楼栋（可不指定）。'}</Text>}
    {!assistant && <View className='mt-12'><PhotoField photos={photos} onChange={setPhotos} disabled={saving} /></View>}
    {!assistant && <>
      <Text className='field-label'>联系方式（只有你自己能看到草稿里的联系方式）</Text>
      <Input className='field-input' value={form.contact} maxlength={100} onInput={(e) => patch({ contact: e.detail.value })} />
      <View className='switch-row'>
        <View className='switch-text'><Text>公开展示联系方式</Text><Text className='field-help'>{CONTACT_PUBLIC_HELP}</Text></View>
        <Switch color='#194E41' checked={form.contactPublic} onChange={(e) => patch({ contactPublic: e.detail.value })} />
      </View>
    </>}
    {bundle && <BundleRowsEditor rows={form.rows} onChange={(rows) => patch({ rows })} error={problem?.code === 'INVALID_BUNDLE' ? problem.message : null} />}
    {!bundle && template && template.items.map((item) => {
      const d = form.declarations[item.code] ?? { condition: '', note: '' };
      return <View key={item.code} className='declaration-field'>
        <Text className='field-label'>{item.label}</Text>
        <Picker range={STATES} value={Math.max(0, CODES.indexOf(d.condition))} onChange={(e) => patch({ declarations: { ...form.declarations, [item.code]: { ...d, condition: CODES[Number(e.detail.value)] } } })}>
          <View className='picker'><Text className='picker-value'>{d.condition ? STATES[CODES.indexOf(d.condition)] : '请选择'}</Text><View className='i-chevron' /></View>
        </Picker>
        <Input className='field-input' value={d.note} placeholder='补充说明（选填）' maxlength={200} onInput={(e) => patch({ declarations: { ...form.declarations, [item.code]: { ...d, note: e.detail.value } } })} />
      </View>;
    })}
    {!assistant && <VisibilityPicker visibility={form.visibility} circleIds={form.circleIds} onChange={(next) => patch(next)} error={problem?.code === 'INVALID_CIRCLE' ? problem.message : null} />}
    {error ? <Text className='error-text'>{error}</Text> : null}
    {status ? <Text className='notice sheet-line'>{status}</Text> : null}
    <View className='button-row'>
      <Button className='primary small' disabled={saving || conflict !== null || uploading} loading={saving} onClick={() => void save()}>保存这件</Button>
      {!assistant && <Button className='secondary small' disabled={saving || conflict !== null || uploading} onClick={() => void save(true)}>标记为可以发布</Button>}
    </View>
  </View>;
}
