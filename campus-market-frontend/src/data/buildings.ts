import type { Building } from '../types';

/**
 * Mock 内部保存的楼栋：比公共投影多出 active 与 sortOrder 两个字段，
 * 对外返回时会剥掉，保证与 REST 的 6 个字段完全一致。
 */
export interface MockBuilding extends Building {
  active: boolean;
  sortOrder: number;
}

/**
 * 离线演示用的楼栋数据。
 *
 * <p>与后端 V3 迁移（`V3__building_market.sql`）中的种子数据<b>逐条对应</b>：
 * id、园区、楼名、坐标全部一致。Mock 与 REST 必须是同一个世界，
 * 否则「本楼有 3 件商品」这种结论会随运行模式变化，测试也就失去意义。
 *
 * <p>坐标是虚构的演示数据，以 (31.0000, 121.0000) 为原点按校区和园区偏移，
 * 不对应任何真实校园，也不是导航数据。
 */
export const seedBuildings: MockBuilding[] = [
  // 东校区
  { id: 'east-qinyuan-1', campusId: '东校区', zone: '沁园', name: '1号楼', latitude: 31.0, longitude: 121.0, active: true, sortOrder: 1 },
  { id: 'east-qinyuan-2', campusId: '东校区', zone: '沁园', name: '2号楼', latitude: 31.0009, longitude: 121.0, active: true, sortOrder: 2 },
  { id: 'east-qinyuan-3', campusId: '东校区', zone: '沁园', name: '3号楼', latitude: 31.0018, longitude: 121.0, active: true, sortOrder: 3 },
  { id: 'east-songyuan-4', campusId: '东校区', zone: '松园', name: '4号楼', latitude: 31.0, longitude: 121.0042, active: true, sortOrder: 4 },
  { id: 'east-songyuan-5', campusId: '东校区', zone: '松园', name: '5号楼', latitude: 31.0009, longitude: 121.0042, active: true, sortOrder: 5 },
  // 与后端 V4 一致的停用演示楼：不可再被选择，但旧数据仍可引用
  { id: 'east-songyuan-6', campusId: '东校区', zone: '松园', name: '6号楼', latitude: 31.0018, longitude: 121.0042, active: false, sortOrder: 6 },
  // 西校区
  { id: 'west-zhuyuan-1', campusId: '西校区', zone: '竹园', name: '1号楼', latitude: 31.0, longitude: 120.979, active: true, sortOrder: 1 },
  { id: 'west-zhuyuan-2', campusId: '西校区', zone: '竹园', name: '2号楼', latitude: 31.0009, longitude: 120.979, active: true, sortOrder: 2 },
  { id: 'west-meiyuan-3', campusId: '西校区', zone: '梅园', name: '3号楼', latitude: 31.0, longitude: 120.9832, active: true, sortOrder: 3 },
  { id: 'west-meiyuan-4', campusId: '西校区', zone: '梅园', name: '4号楼', latitude: 31.0009, longitude: 120.9832, active: true, sortOrder: 4 },
  { id: 'west-meiyuan-5', campusId: '西校区', zone: '梅园', name: '5号楼', latitude: 31.0018, longitude: 120.9832, active: true, sortOrder: 5 },
  // 南校区
  { id: 'south-lanyuan-1', campusId: '南校区', zone: '兰园', name: '1号楼', latitude: 30.982, longitude: 121.0, active: true, sortOrder: 1 },
  { id: 'south-lanyuan-2', campusId: '南校区', zone: '兰园', name: '2号楼', latitude: 30.9829, longitude: 121.0, active: true, sortOrder: 2 },
  { id: 'south-guiyuan-3', campusId: '南校区', zone: '桂园', name: '3号楼', latitude: 30.982, longitude: 121.0042, active: true, sortOrder: 3 },
  { id: 'south-guiyuan-4', campusId: '南校区', zone: '桂园', name: '4号楼', latitude: 30.9829, longitude: 121.0042, active: true, sortOrder: 4 },
  { id: 'south-guiyuan-5', campusId: '南校区', zone: '桂园', name: '5号楼', latitude: 30.9838, longitude: 121.0042, active: true, sortOrder: 5 },
  // 北校区
  { id: 'north-fengyuan-1', campusId: '北校区', zone: '枫园', name: '1号楼', latitude: 31.018, longitude: 121.0, active: true, sortOrder: 1 },
  { id: 'north-fengyuan-2', campusId: '北校区', zone: '枫园', name: '2号楼', latitude: 31.0189, longitude: 121.0, active: true, sortOrder: 2 },
  { id: 'north-fengyuan-3', campusId: '北校区', zone: '枫园', name: '3号楼', latitude: 31.0198, longitude: 121.0, active: true, sortOrder: 3 },
  { id: 'north-xingyuan-4', campusId: '北校区', zone: '杏园', name: '4号楼', latitude: 31.018, longitude: 121.0042, active: true, sortOrder: 4 },
  { id: 'north-xingyuan-5', campusId: '北校区', zone: '杏园', name: '5号楼', latitude: 31.0189, longitude: 121.0042, active: true, sortOrder: 5 },
];

/**
 * 按 Unicode 码点比较，对应后端的 {@code COLLATE "C"}。
 *
 * <p>不用 localeCompare：它的结果取决于运行环境的语言设置，
 * 同一份数据在不同浏览器里园区先后会不一样。JS 的 < 比较 UTF-16 码元，
 * 对楼栋名用到的基本多文种平面字符而言与码点序一致。
 */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 楼栋列表的唯一排序：园区 → 序号 → 楼名 → id，与后端 BuildingMapper 一致。 */
export function compareBuildings(a: MockBuilding, b: MockBuilding): number {
  return (
    compareCodePoints(a.zone, b.zone) ||
    a.sortOrder - b.sortOrder ||
    compareCodePoints(a.name, b.name) ||
    compareCodePoints(a.id, b.id)
  );
}

/** 剥掉 Mock 内部字段，只留与 REST 一致的公共投影。 */
export function publicBuilding(building: MockBuilding): Building {
  const { id, campusId, zone, name, latitude, longitude } = building;
  return { id, campusId, zone, name, latitude, longitude };
}

/** 面交点的演示坐标，同样与 V3 迁移中的 UPDATE 语句逐条对应。 */
export const seedMeetingPointCoordinates: Record<string, { latitude: number; longitude: number }> = {
  '东校区-library': { latitude: 31.0009, longitude: 121.0021 },
  '东校区-canteen': { latitude: 31.0023, longitude: 121.001 },
  '东校区-express': { latitude: 30.9995, longitude: 121.0033 },
  '西校区-library': { latitude: 31.0009, longitude: 120.9811 },
  '西校区-canteen': { latitude: 31.0023, longitude: 120.98 },
  '西校区-express': { latitude: 30.9995, longitude: 120.9823 },
  '南校区-library': { latitude: 30.9829, longitude: 121.0021 },
  '南校区-canteen': { latitude: 30.9843, longitude: 121.001 },
  '南校区-express': { latitude: 30.9815, longitude: 121.0033 },
  '北校区-library': { latitude: 31.0189, longitude: 121.0021 },
  '北校区-canteen': { latitude: 31.0203, longitude: 121.001 },
  '北校区-express': { latitude: 31.0175, longitude: 121.0033 },
};
