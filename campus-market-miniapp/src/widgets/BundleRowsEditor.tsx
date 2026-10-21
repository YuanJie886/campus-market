import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { BUNDLE_MAX_ITEMS, CATEGORIES, CONDITIONS } from '../model';
import { BUNDLE_ROWS_HELP, emptyBundleRow, rowsSummary, type BundleRow } from '../supply';

/** 整套打包的明细编辑：2～30 行，每行名称 / 分类 / 成色 / 数量 / 备注；分类与成色不预选（与 Web BundleEditor 一致）。 */
export function BundleRowsEditor({ rows, onChange, error }: { rows: BundleRow[]; onChange: (rows: BundleRow[]) => void; error?: string | null }) {
  const update = (key: string, patch: Partial<BundleRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return <View className='panel'>
    <Text className='section-title'>打包明细</Text>
    <Text className='field-help'>{BUNDLE_ROWS_HELP}</Text>
    <Text className='muted'>{rowsSummary(rows)}</Text>
    {error ? <Text className='error-text'>{error}</Text> : null}
    {rows.map((row, index) => <View key={row.key} className='bundle-row'>
      <View className='section-head'><Text className='field-label'>第 {index + 1} 行</Text><Text className='text-action danger-text' onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>删除</Text></View>
      <Input className='field-input' value={row.name} placeholder={`第 ${index + 1} 行名称`} maxlength={60} onInput={(e) => update(row.key, { name: e.detail.value })} />
      <View className='form-columns'>
        <Picker range={[...CATEGORIES]} value={Math.max(0, CATEGORIES.indexOf(row.category as typeof CATEGORIES[number]))} onChange={(e) => update(row.key, { category: CATEGORIES[Number(e.detail.value)] })}>
          <View className='picker'><Text className='picker-value'>{row.category || '分类'}</Text><View className='i-chevron' /></View>
        </Picker>
        <Picker range={[...CONDITIONS]} value={Math.max(0, CONDITIONS.indexOf(row.condition as typeof CONDITIONS[number]))} onChange={(e) => update(row.key, { condition: CONDITIONS[Number(e.detail.value)] })}>
          <View className='picker'><Text className='picker-value'>{row.condition || '成色'}</Text><View className='i-chevron' /></View>
        </Picker>
      </View>
      <View className='form-columns'>
        <Input className='field-input' type='number' value={row.quantity} placeholder='数量' maxlength={2} onInput={(e) => update(row.key, { quantity: e.detail.value })} />
        <Input className='field-input' value={row.note} placeholder='备注（选填）' maxlength={200} onInput={(e) => update(row.key, { note: e.detail.value })} />
      </View>
    </View>)}
    <Button className='secondary small' disabled={rows.length >= BUNDLE_MAX_ITEMS} onClick={() => onChange([...rows, emptyBundleRow()])}>添加一行</Button>
  </View>;
}
