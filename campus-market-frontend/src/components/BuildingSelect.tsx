import { useEffect, useMemo, useState } from 'react';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { Building, Campus } from '../types';

interface Props {
  campus: Campus;
  /** 当前选中的楼栋 id；null / '' 表示未指定 */
  value: string | null;
  onChange: (buildingId: string | null) => void;
  /** 「不指定」选项的文案 */
  emptyLabel?: string;
  zoneLabel?: string;
  buildingLabel?: string;
  helperText?: string;
  disabled?: boolean;
}

/**
 * 园区 → 楼栋的级联选择。
 *
 * <p>校区一变，楼栋列表随之重新拉取，原来的选择如果不属于新校区就<b>立即清空</b>——
 * 留着一个跨校区的旧值，只会在提交时被后端拒绝，用户还不知道错在哪。
 *
 * <p>始终提供「不指定」：无论是宿舍楼还是取货楼栋，都不是必填项。
 */
export default function BuildingSelect({
  campus, value, onChange,
  emptyLabel = '不指定',
  zoneLabel = '园区',
  buildingLabel = '楼栋',
  helperText,
  disabled = false,
}: Props) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zone, setZone] = useState<string>('');

  useEffect(() => {
    let active = true;
    setLoadError(null);
    getApiClient()
      .listBuildings(campus)
      .then((list) => {
        if (!active) return;
        setBuildings(list);
        // 校区变化后，原选择若不在新列表中就清掉，不留下一个必然被拒绝的值
        if (value && !list.some((building) => building.id === value)) onChange(null);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(toUserMessage(error));
      });
    return () => {
      active = false;
    };
    // value/onChange 刻意不进依赖：这里只在校区变化时重新拉取列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus]);

  const zones = useMemo(
    () => [...new Set(buildings.map((building) => building.zone))],
    [buildings],
  );

  // 选中的楼栋决定当前园区，用户没选园区时不过滤
  const selected = buildings.find((building) => building.id === value) ?? null;
  const activeZone = zone || selected?.zone || '';
  const visible = activeZone ? buildings.filter((b) => b.zone === activeZone) : buildings;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        select
        fullWidth
        label={zoneLabel}
        value={activeZone}
        disabled={disabled || !!loadError}
        onChange={(event) => {
          const nextZone = event.target.value;
          setZone(nextZone);
          // 换园区后原楼栋多半不在其中，清空避免出现「园区 A、楼栋属于 B」的矛盾显示
          if (selected && selected.zone !== nextZone) onChange(null);
        }}
      >
        <MenuItem value="">全部园区</MenuItem>
        {zones.map((item) => (
          <MenuItem key={item} value={item}>
            {item}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        fullWidth
        label={buildingLabel}
        value={value ?? ''}
        disabled={disabled || !!loadError}
        error={!!loadError}
        helperText={loadError ?? helperText}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <MenuItem value="">{emptyLabel}</MenuItem>
        {visible.map((building) => (
          <MenuItem key={building.id} value={building.id}>
            {building.zone} · {building.name}
          </MenuItem>
        ))}
      </TextField>
    </div>
  );
}
