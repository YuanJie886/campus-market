import { Picker, Text, View } from '@tarojs/components';
import type { Campus } from '../model';
import { useMarket, useSchools } from '../state';

/**
 * 校区选择：只列出本人所在学校的校区（来自 GET /v1/schools），显示名称、提交 id。
 * 没有写死的校区列表；目录还没读到时只有本人校区本身。
 */
export function CampusPicker({ value, onChange, prefix = '', className = 'picker', placeholder = '请选择校区' }: {
  value: Campus | null | undefined; onChange: (campus: Campus) => void; prefix?: string; className?: string; placeholder?: string;
}) {
  const { user } = useMarket(), { catalog } = useSchools();
  const options = catalog.campusOptions(user?.campus);
  const index = options.findIndex((c) => c.id === value);
  return <Picker range={options.map((c) => c.name)} value={Math.max(0, index)} onChange={(e) => { const next = options[Number(e.detail.value)]; if (next) onChange(next.id); }}>
    <View className={className}><Text className='picker-value'>{prefix}{value ? catalog.campusLabel(value) : placeholder}</Text><View className='i-chevron' /></View>
  </Picker>;
}
