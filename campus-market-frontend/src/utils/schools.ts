import type { CampusInfo, School } from '../api/contracts';

/**
 * 学校与校区的纯函数（数据来自 GET /v1/schools）。界面通过 useSchools() 拿到绑定好数据的同名函数。
 *
 * <p>校区 id 是请求里提交的值，名称只用于展示：新学校的 id（例如 aust-huainan）不能直接给用户看。
 * 找不到时回落到 id 本身——旧数据、学校列表还没加载完或接口不可用时，至少显示原值而不是空白。
 */

/** 校区显示名称；未知校区（或列表尚未加载）回落到原始 id */
export function campusLabel(schools: readonly School[], campusId: string | null | undefined): string {
  if (!campusId) return '';
  for (const school of schools) {
    const campus = school.campuses.find((c) => c.id === campusId);
    if (campus) return campus.name;
  }
  return campusId;
}

/** 校区所属的学校；未知校区为 null */
export function schoolOfCampus(schools: readonly School[], campusId: string | null | undefined): School | null {
  if (!campusId) return null;
  return schools.find((school) => school.campuses.some((c) => c.id === campusId)) ?? null;
}

/** 某学校的全部可见校区（按服务端顺序）；未知学校为空数组 */
export function campusesOfSchool(schools: readonly School[], schoolId: string | null | undefined): CampusInfo[] {
  if (!schoolId) return [];
  return schools.find((school) => school.id === schoolId)?.campuses ?? [];
}

/**
 * 校区是否有启用的楼栋。只有服务端明确给出 hasBuildings=false 才返回 false；
 * 未知校区或列表未加载时返回 true（不提前隐藏任何入口，由 /v1/buildings 的实际结果决定）。
 */
export function hasBuildings(schools: readonly School[], campusId: string | null | undefined): boolean {
  if (!campusId) return true;
  for (const school of schools) {
    const campus = school.campuses.find((c) => c.id === campusId);
    if (campus) return campus.hasBuildings;
  }
  return true;
}

/**
 * 校区选择器的选项：只列本人学校的校区。
 * 找不到本人学校时（列表未加载、接口不可用、或这个校区已不可见），至少保留本人当前的校区，
 * 让表单的当前值始终是一个可选项，而不是凭空列出别的学校的校区。
 */
export function campusChoicesFor(schools: readonly School[], userCampusId: string | null | undefined): CampusInfo[] {
  const school = schoolOfCampus(schools, userCampusId);
  if (school) return school.campuses;
  return userCampusId ? [{ id: userCampusId, name: userCampusId, hasBuildings: true }] : [];
}

/** 表单默认校区：本人校区；本人还没有校区时取本人学校的第一个校区（都没有时为空串） */
export function defaultCampusFor(schools: readonly School[], userCampusId: string | null | undefined, schoolId?: string | null): string {
  if (userCampusId) return userCampusId;
  return campusesOfSchool(schools, schoolId)[0]?.id ?? '';
}
