import { Picker, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Building, Campus } from '../model';
import { buildingsIn, zonesOf } from '../profile';
import { buildingPickerState } from '../schools';

/**
 * 园区 → 楼栋的级联选择（与 Web BuildingSelect 一致）：校区一变就重新读取楼栋，原来的选择不属于新校区时立即清空；
 * 始终提供「不指定」。本校区还没有启用的楼栋（列表为空）时不显示选择，只显示「本校楼栋信息还在录入中」。onLabel 把选中楼栋的文字交给调用方（用于「买家会在商品页看到：…」）。
 */
export function BuildingPicker({ campus, value, onChange, emptyLabel = '不指定', zoneLabel = '园区', buildingLabel = '楼栋', onLabel }: {
  campus: Campus; value: string | null; onChange: (id: string | null) => void; emptyLabel?: string; zoneLabel?: string; buildingLabel?: string; onLabel?: (label: string | null) => void;
}) {
  const [buildings, setBuildings] = useState<Building[]>([]), [zone, setZone] = useState(''), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true; setError(''); setLoaded(false);
    api.buildings(campus).then((list) => {
      if (!active) return;
      setBuildings(list); setZone(''); setLoaded(true);
      if (value && !list.some((b) => b.id === value)) onChange(null);
    }).catch((e) => { if (active) { setBuildings([]); setError(e instanceof Error ? e.message : '楼栋读取失败'); } });
    return () => { active = false; };
  }, [campus]);
  const selected = buildings.find((b) => b.id === value) ?? null;
  useEffect(() => { onLabel?.(selected ? `${selected.zone}${selected.name}` : null); }, [selected?.id]);
  const activeZone = zone || selected?.zone || '';
  const zones = zonesOf(buildings), visible = buildingsIn(buildings, activeZone);
  if (error) return <Text className='error-text'>{error}</Text>;
  const state = buildingPickerState(buildings);
  if (loaded && state.pending) return <Text className='field-help'>{state.text}</Text>;
  return <View>
    <Picker range={['全部园区', ...zones]} value={activeZone ? zones.indexOf(activeZone) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); const next = i ? zones[i - 1] : ''; setZone(next); if (selected && next && selected.zone !== next) onChange(null); }}>
      <View className='picker'><Text className='picker-value'>{zoneLabel}：{activeZone || '全部园区'}</Text><View className='i-chevron' /></View>
    </Picker>
    <Picker range={[emptyLabel, ...visible.map((b) => `${b.zone} · ${b.name}`)]} value={selected ? visible.findIndex((b) => b.id === selected.id) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); onChange(i ? visible[i - 1].id : null); }}>
      <View className='picker mt-12'><Text className='picker-value'>{buildingLabel}：{selected ? `${selected.zone} · ${selected.name}` : emptyLabel}</Text><View className='i-chevron' /></View>
    </Picker>
  </View>;
}
