import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Typography } from '@mui/material';
import { SelectInput, TextInput, useGetIdentity, useListContext, useRecordContext, type FieldProps } from 'react-admin';
import { campusFilterChoices, campusLabel, campusNames, getSchoolsState, loadSchools, subscribeSchools } from './schools';

export const CAMPUS_FILTER_LABEL = '所在校区';
/** 学校目录读取失败时的筛选：自由输入校区编号（与列表里显示的原始编号一致）。 */
export const CAMPUS_FILTER_TEXT_LABEL = '所在校区（校区编号）';

/**
 * 学校目录状态。挂载时若还没有成功读取过就发起读取（loadSchools 合并并发请求、成功后不再请求）；
 * 上一次失败的话，新挂载的页面会重新读取——失败不缓存。
 */
export function useSchools() {
    const snapshot = useSyncExternalStore(subscribeSchools, getSchoolsState, getSchoolsState);
    useEffect(() => { if (!getSchoolsState().data) loadSchools().catch(() => undefined); }, []);
    return snapshot;
}

/** 返回把校区编号转换为显示名称的函数；目录未加载或读取失败时原样返回编号。 */
export function useCampusLabel() {
    const { data } = useSchools();
    const names = useMemo(() => campusNames(data), [data]);
    return useCallback((value: unknown) => campusLabel(value, names), [names]);
}

/** 与 TextField 相同的样式，但显示校区名称。 */
export function CampusField({ source, emptyText }: FieldProps & { emptyText?: string }) {
    const record = useRecordContext();
    const label = useCampusLabel();
    const value = source ? record?.[source as string] : undefined;
    return <Typography component="span" variant="body2">{label(value) ?? emptyText ?? ''}</Typography>;
}

type FilterProps = { source?: string; label?: string; alwaysOn?: boolean } & Record<string, unknown>;
/**
 * 商品「所在校区」筛选：下拉显示校区名称、提交校区编号。
 * 已知当前工作人员的学校时只列本校校区，否则列出所有可见校区；
 * 学校目录读取失败（或没有可选校区）时回落为自由输入的校区编号。
 */
export function CampusFilterInput({ source = 'campus', label: _label, alwaysOn: _alwaysOn, ...rest }: FilterProps) {
    const { data, failed } = useSchools();
    const { identity, isPending: identityPending } = useGetIdentity();
    const { filterValues } = useListContext();
    const current = filterValues?.[source];
    const schoolId = typeof identity?.schoolId === 'string' ? identity.schoolId : undefined;
    const options = useMemo(() => campusFilterChoices(data, schoolId), [data, schoolId]);
    if (data ? !options.length : failed) return <TextInput {...rest} source={source} label={CAMPUS_FILTER_TEXT_LABEL} resettable inputProps={{ maxLength: 100 }} />;
    // 地址栏里带来的编号不在选项中（例如隐藏学校的校区）时仍显示该编号，而不是显示为空
    const choices = current && !options.some(option => option.id === String(current)) ? [...options, { id: String(current), name: String(current) }] : options;
    return <SelectInput {...rest} source={source} label={CAMPUS_FILTER_LABEL} choices={choices} isPending={!data || identityPending} />;
}
