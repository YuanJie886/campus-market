/**
 * 学校与校区目录（纯逻辑，不依赖 Taro，便于测试）。
 * 唯一来源是 GET /v1/schools（公开接口）：[{ id, name, shortName, campuses: [{ id, name, hasBuildings }] }]，
 * 只含可见、启用的学校与校区。请求里始终提交校区 id；界面上一律显示校区名称（campusLabel），
 * 新学校的校区 id 是带命名空间的标识（例如 aust-huainan），不再等于显示名称。
 * 小程序里不再有任何写死的校区列表或默认校区。
 */
import type { Campus, School, SchoolCampus } from './model';

/** 本校区还没有启用的楼栋时，楼栋选择器（宿舍楼、取货楼栋）显示的文案。 */
export const BUILDINGS_PENDING = '本校楼栋信息还在录入中';
export const SCHOOLS_LOAD_FAILED = '学校列表读取失败，请重试';

/** GET /v1/schools 的防御性解析：id 必须是非空字符串；名称缺省时用 id；hasBuildings 只认 true。 */
export function parseSchools(raw: unknown): School[] {
  if (!Array.isArray(raw)) throw new Error('INVALID_SCHOOLS');
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  return raw.flatMap((item): School[] => {
    const s = (item ?? {}) as Record<string, unknown>;
    if (!text(s.id)) return [];
    const campuses = (Array.isArray(s.campuses) ? s.campuses : []).flatMap((c): SchoolCampus[] => {
      const x = (c ?? {}) as Record<string, unknown>;
      return text(x.id) ? [{ id: text(x.id), name: text(x.name) || text(x.id), hasBuildings: x.hasBuildings === true }] : [];
    });
    const name = text(s.name) || text(s.id);
    return [{ id: text(s.id), name, shortName: text(s.shortName) || name, campuses }];
  });
}

/** 某一时刻的学校目录（不可变快照）：所有显示与选择都从这里取。 */
export class SchoolCatalog {
  constructor(readonly schools: readonly School[] = [], readonly loaded = false) {}
  /** 有至少一个校区的学校（注册时可选的学校）。 */
  get selectableSchools(): School[] { return this.schools.filter((s) => s.campuses.length > 0); }
  campus(id: Campus | null | undefined): SchoolCampus | null {
    if (!id) return null;
    for (const s of this.schools) { const c = s.campuses.find((x) => x.id === id); if (c) return c; }
    return null;
  }
  /** 校区显示名称；目录里没有（未加载、已停用或未知）时原样显示 id。 */
  campusLabel(id: Campus | null | undefined): string { return id ? this.campus(id)?.name ?? id : ''; }
  /** 商品卡片 / 详情上的位置：「校区名称 · 楼栋」，没有楼栋时只有校区名称。 */
  locationLabel(campus: Campus | null | undefined, buildingName?: string | null): string {
    const label = this.campusLabel(campus);
    return buildingName ? `${label} · ${buildingName}` : label;
  }
  schoolOfCampus(id: Campus | null | undefined): School | null { return id ? this.schools.find((s) => s.campuses.some((c) => c.id === id)) ?? null : null; }
  campusesOfSchool(schoolId: string | null | undefined): SchoolCampus[] { return [...(this.schools.find((s) => s.id === schoolId)?.campuses ?? [])]; }
  /** 该校区是否已有启用的楼栋；目录里没有这个校区时按「没有」处理（不显示「本楼」）。 */
  hasBuildings(id: Campus | null | undefined): boolean { return this.campus(id)?.hasBuildings === true; }
  /**
   * 选择校区时可选的范围：只限本人所在学校的校区。目录还没有本人校区时只给出本人校区本身（显示 id），
   * 不会出现其他学校的校区。
   */
  campusOptions(userCampus: Campus | null | undefined): SchoolCampus[] {
    const school = this.schoolOfCampus(userCampus);
    if (school) return [...school.campuses];
    return userCampus ? [{ id: userCampus, name: userCampus, hasBuildings: false }] : [];
  }
}

/** 加载一次并缓存：并发调用共用同一个请求；失败不缓存（下次调用重新请求）。 */
export class SchoolsStore {
  private catalog = new SchoolCatalog();
  private pending: Promise<SchoolCatalog> | null = null;
  private readonly listeners = new Set<(catalog: SchoolCatalog) => void>();
  constructor(private readonly loader: () => Promise<School[]>) {}
  get current() { return this.catalog; }
  load(): Promise<SchoolCatalog> {
    if (this.catalog.loaded) return Promise.resolve(this.catalog);
    if (!this.pending) {
      this.pending = this.loader().then((schools) => {
        this.catalog = new SchoolCatalog(schools, true);
        this.listeners.forEach((listener) => listener(this.catalog));
        return this.catalog;
      }).finally(() => { this.pending = null; });
    }
    return this.pending;
  }
  subscribe(listener: (catalog: SchoolCatalog) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}

// ---------------- 注册：先选学校，再选校区 ----------------
export interface RegistrationChoice {
  /** 只有一所学校时不显示学校选择。 */
  showSchoolPicker: boolean;
  schools: School[]; school: School | null; campuses: SchoolCampus[]; campus: SchoolCampus | null;
}
/**
 * 注册时的学校 / 校区选择：只有一所学校时自动选中；所选学校只有一个校区时自动选中；
 * 其余情况必须由用户选择，不替用户默认。校区只能是所选学校的校区。
 */
export function registrationChoice(catalog: SchoolCatalog, schoolId: string | null, campusId: Campus | null): RegistrationChoice {
  const schools = catalog.selectableSchools;
  const school = schools.length === 1 ? schools[0] : schools.find((s) => s.id === schoolId) ?? null;
  const campuses = school ? [...school.campuses] : [];
  const campus = campuses.length === 1 ? campuses[0] : campuses.find((c) => c.id === campusId) ?? null;
  return { showSchoolPicker: schools.length > 1, schools, school, campuses, campus };
}
export const REGISTRATION_CAMPUS_REQUIRED = '请选择学校和校区';

// ---------------- 楼栋选择器 ----------------
/** 楼栋列表为空 = 本校区还没有启用的楼栋：不显示园区 / 楼栋选择，改为说明文案。 */
export function buildingPickerState(buildings: readonly unknown[]): { pending: true; text: string } | { pending: false } {
  return buildings.length ? { pending: false } : { pending: true, text: BUILDINGS_PENDING };
}
