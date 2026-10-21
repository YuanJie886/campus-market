import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import { normalizeSchools, type CampusInfo, type CampusMarketApi, type School } from '../api/contracts';
import {
  campusChoicesFor,
  campusLabel as labelOf,
  campusesOfSchool as campusesOf,
  hasBuildings as buildingsKnown,
  schoolOfCampus as schoolOf,
} from '../utils/schools';

/**
 * 学校与校区的唯一来源：GET /v1/schools 按当前 API 客户端只请求一次（与 useClientConfig 相同的缓存方式；
 * 测试里 setApiClient 换客户端时自然重新请求）。失败不缓存，下次挂载或 reload() 时再试。
 * 没有实现 getSchools 的客户端（旧的测试替身）按空列表处理：所有校区名回落到 id。
 */
const cache = new WeakMap<CampusMarketApi, Promise<School[]>>();
const resolved = new WeakMap<CampusMarketApi, School[]>();

export function loadSchools(api: CampusMarketApi = getApiClient()): Promise<School[]> {
  let pending = cache.get(api);
  if (!pending) {
    pending = (typeof api.getSchools === 'function' ? api.getSchools() : Promise.resolve([]))
      .then((list) => {
        const schools = normalizeSchools(list);
        resolved.set(api, schools);
        return schools;
      })
      .catch((e: unknown) => {
        cache.delete(api);
        throw e;
      });
    cache.set(api, pending);
  }
  return pending;
}

export interface SchoolsState {
  schools: School[];
  /** 还没拿到学校列表 */
  loading: boolean;
  /** 加载失败时给用户看的提示（含 requestId）；成功后为 null */
  error: string | null;
  reload: () => void;
  /** 校区显示名称；未知校区回落到原始 id */
  campusLabel: (campusId: string | null | undefined) => string;
  schoolOfCampus: (campusId: string | null | undefined) => School | null;
  campusesOfSchool: (schoolId: string | null | undefined) => CampusInfo[];
  /** 只有服务端明确说没有楼栋时为 false */
  hasBuildings: (campusId: string | null | undefined) => boolean;
  /** 校区选择器的选项：本人学校的校区（找不到学校时只有本人当前校区） */
  campusChoicesFor: (userCampusId: string | null | undefined) => CampusInfo[];
}

export function useSchools(): SchoolsState {
  const api = getApiClient();
  const [schools, setSchools] = useState<School[] | null>(() => resolved.get(api) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const known = resolved.get(api);
    if (known) {
      setSchools(known);
      setError(null);
      return () => { active = false };
    }
    setError(null);
    loadSchools(api)
      .then((list) => { if (active) setSchools(list) })
      .catch((e: unknown) => {
        if (!active) return;
        setSchools([]);
        setError(toUserMessage(e));
      });
    return () => { active = false };
  }, [api, attempt]);

  const reload = useCallback(() => {
    setSchools(null);
    setAttempt((n) => n + 1);
  }, []);

  return useMemo(() => {
    const list = schools ?? [];
    return {
      schools: list,
      loading: schools === null,
      error,
      reload,
      campusLabel: (id) => labelOf(list, id),
      schoolOfCampus: (id) => schoolOf(list, id),
      campusesOfSchool: (id) => campusesOf(list, id),
      hasBuildings: (id) => buildingsKnown(list, id),
      campusChoicesFor: (id) => campusChoicesFor(list, id),
    };
  }, [schools, error, reload]);
}

/**
 * 校区有没有启用的楼栋（首页决定是否提供「本楼」）：/v1/schools 明确说没有 → false；
 * 否则看 GET /v1/buildings?campus=… 是否为空（按客户端与校区缓存，本次会话只请求一次）。
 * 结果未知（加载中、请求失败、没有校区）时为 null——调用方不据此隐藏任何入口。
 */
const buildingPresence = new WeakMap<CampusMarketApi, Map<string, Promise<boolean>>>();

function loadBuildingPresence(api: CampusMarketApi, campusId: string): Promise<boolean> {
  let perApi = buildingPresence.get(api);
  if (!perApi) { perApi = new Map(); buildingPresence.set(api, perApi) }
  let pending = perApi.get(campusId);
  if (!pending) {
    const map = perApi;
    pending = (typeof api.listBuildings === 'function' ? api.listBuildings(campusId) : Promise.reject(new Error('listBuildings unavailable')))
      .then((list) => Array.isArray(list) && list.length > 0)
      .catch((e: unknown) => { map.delete(campusId); throw e });
    perApi.set(campusId, pending);
  }
  return pending;
}

export function useCampusHasBuildings(campusId: string | null | undefined): boolean | null {
  const api = getApiClient();
  const { hasBuildings, loading } = useSchools();
  const declaredEmpty = !loading && !!campusId && !hasBuildings(campusId);
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    setPresent(null);
    if (!campusId || declaredEmpty) return () => { active = false };
    loadBuildingPresence(api, campusId)
      .then((value) => { if (active) setPresent(value) })
      .catch(() => undefined);
    return () => { active = false };
  }, [api, campusId, declaredEmpty]);
  if (!campusId) return null;
  if (declaredEmpty) return false;
  return present;
}
