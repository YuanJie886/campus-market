import { HttpError } from './HttpError';
import { request } from './http';

/**
 * 公开的学校 / 校区目录：GET /v1/schools（不需要登录，普通信封）。
 * 只列出在用学校里的在用校区；被隐藏的学校（例如生产环境里的演示学校 pilot）不出现，
 * 它们的校区在后台按原始校区编号显示。
 */
export interface CampusEntry { id: string; name: string; hasBuildings: boolean }
export interface SchoolEntry { id: string; name: string; shortName?: string; campuses: CampusEntry[] }
export interface CampusChoice { id: string; name: string }

export const SCHOOLS_PATH = '/v1/schools';

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;

/** 校验并整理接口返回；结构不对时视为读取失败（不缓存），界面回落到原始校区编号。 */
export function parseSchools(data: unknown): SchoolEntry[] {
    if (!Array.isArray(data)) throw new HttpError('学校目录格式无效', 502);
    return data.flatMap(raw => {
        const school = raw as Record<string, unknown> | null;
        const id = text(school?.id), name = text(school?.name);
        if (!id || !name) return [];
        const campuses = (Array.isArray(school?.campuses) ? school.campuses : []).flatMap(item => {
            const campus = item as Record<string, unknown> | null;
            const campusId = text(campus?.id), campusName = text(campus?.name);
            return campusId && campusName ? [{ id: campusId, name: campusName, hasBuildings: campus?.hasBuildings === true }] : [];
        });
        return [{ id, name, ...(text(school?.shortName) ? { shortName: school!.shortName as string } : {}), campuses }];
    });
}

/** 学校目录在页面里的状态：data 为最近一次成功读取的目录；failed 表示最近一次读取失败（界面回落到原始编号与自由输入）。 */
export interface SchoolsState { data?: SchoolEntry[]; failed: boolean; loading: boolean }
const INITIAL: SchoolsState = { failed: false, loading: false };
let state: SchoolsState = INITIAL;
const listeners = new Set<() => void>();
function update(next: SchoolsState) { state = next; for (const listener of listeners) listener(); }
export function getSchoolsState(): SchoolsState { return state; }
export function subscribeSchools(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

let cached: Promise<SchoolEntry[]> | null = null;
/**
 * 读取学校目录，整个页面生命周期只请求一次；失败（网络、非 0 信封、格式无效）不缓存，下次调用重新请求。
 * 并发调用共用同一个请求。公开接口不参与会话刷新（retry=false）：401 之类的失败只让界面回落到原始编号。
 */
export function loadSchools(): Promise<SchoolEntry[]> {
    if (!cached) {
        const flight = request<unknown>(SCHOOLS_PATH, {}, false).then(parseSchools);
        cached = flight;
        update({ ...state, loading: true });
        flight.then(
            data => { if (cached === flight) update({ data, failed: false, loading: false }); },
            () => { if (cached !== flight) return; cached = null; update({ ...state, failed: true, loading: false }); },
        );
    }
    return cached;
}
/** 仅供测试：清空模块级缓存与状态。 */
export function resetSchoolsCache() { cached = null; update(INITIAL); }

/** 校区编号 → 校区名称（只含目录里可见的学校）。 */
export function campusNames(schools: SchoolEntry[] | undefined): Map<string, string> {
    const names = new Map<string, string>();
    for (const school of schools ?? []) for (const campus of school.campuses) names.set(campus.id, campus.name);
    return names;
}

/** 显示用的校区文字：目录里有就用名称；隐藏学校、未知编号或目录读取失败时显示原始编号；空值返回 undefined。 */
export function campusLabel(value: unknown, names?: Map<string, string>): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const id = String(value);
    return names?.get(id) ?? id;
}

/**
 * 商品「所在校区」筛选的选项（value = 校区编号）。
 * 已知当前工作人员的学校且该校在目录中：只列该校校区；否则列出所有可见学校的校区，
 * 跨多所学校时名称前加学校简称以免同名校区混淆。
 */
export function campusFilterChoices(schools: SchoolEntry[] | undefined, schoolId?: string | null): CampusChoice[] {
    if (!schools?.length) return [];
    const own = schoolId ? schools.find(school => school.id === schoolId) : undefined;
    const scope = own ? [own] : schools;
    const prefix = scope.length > 1;
    return scope.flatMap(school => school.campuses.map(campus => ({ id: campus.id, name: prefix ? `${school.shortName ?? school.name} · ${campus.name}` : campus.name })));
}
