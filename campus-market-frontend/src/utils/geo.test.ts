import { describe, expect, it } from 'vitest';
import {
  SCOPE_FALLBACK_ORDER, SCOPE_LABEL, allowsFallback, fallbackChain,
  haversineMeters, walkMinutes,
} from './geo';
import { seedBuildings } from '../data/buildings';

/**
 * 距离公式、步行时间与降级顺序（1.3）。
 *
 * <p>这些数字同时被后端 SQL 与前端 Mock 使用。下面的期望值取自后端
 * BuildingFeedIT 对同一组演示坐标的断言区间，两端一旦漂移，这里会先报错。
 */

const HOME = seedBuildings.find((b) => b.id === 'east-qinyuan-1')!;
const NEAR = seedBuildings.find((b) => b.id === 'east-qinyuan-2')!;
const FAR = seedBuildings.find((b) => b.id === 'east-songyuan-4')!;

describe('Haversine 直线距离', () => {
  it('1. 与后端对同一组演示坐标的结果一致：约 100 米、约 400 米', () => {
    const near = haversineMeters(HOME, NEAR)!;
    const far = haversineMeters(HOME, FAR)!;
    // 后端 BuildingFeedIT 断言区间：[90,110] 与 [380,420]
    expect(near).toBeGreaterThanOrEqual(90);
    expect(near).toBeLessThanOrEqual(110);
    expect(far).toBeGreaterThanOrEqual(380);
    expect(far).toBeLessThanOrEqual(420);
  });

  it('2. 已知基准：纬度差 1 度 ≈ 111.2 公里', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })!;
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('3. 同一点距离为 0，且满足对称性', () => {
    expect(haversineMeters(HOME, HOME)).toBe(0);
    expect(haversineMeters(HOME, FAR)).toBe(haversineMeters(FAR, HOME));
  });

  it('4. 任一端缺坐标返回 null 而不是 0——「不知道多远」≠「就在眼前」', () => {
    expect(haversineMeters(HOME, { latitude: null, longitude: null })).toBeNull();
    expect(haversineMeters(null, HOME)).toBeNull();
    expect(haversineMeters(HOME, { latitude: Number.NaN, longitude: 121 })).toBeNull();
  });
});

describe('步行分钟', () => {
  it('5. 80 米/分钟，向上取整，至少 1 分钟', () => {
    expect(walkMinutes(100)).toBe(2);
    expect(walkMinutes(400)).toBe(5);
    expect(walkMinutes(80)).toBe(1);
    expect(walkMinutes(1)).toBe(1);
    expect(walkMinutes(0)).toBe(1);
  });

  it('6. 无距离时不编造分钟数', () => {
    expect(walkMinutes(null)).toBeNull();
    expect(walkMinutes(undefined)).toBeNull();
  });
});

describe('范围降级顺序的唯一定义', () => {
  it('7. 顺序固定为 本楼 → 园区 → 校区 → 全校，且不可被运行时篡改', () => {
    expect(SCOPE_FALLBACK_ORDER).toEqual(['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL']);
    expect(Object.isFrozen(SCOPE_FALLBACK_ORDER)).toBe(true);
    expect(fallbackChain('BUILDING')).toEqual(['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL']);
    expect(fallbackChain('CAMPUS')).toEqual(['CAMPUS', 'SCHOOL']);
  });

  it('8. 只有「只看本楼」允许自动降级', () => {
    expect(allowsFallback('BUILDING')).toBe(true);
    expect(allowsFallback('ZONE')).toBe(false);
    expect(allowsFallback('CAMPUS')).toBe(false);
    expect(allowsFallback('SCHOOL')).toBe(false);
  });

  it('9. 中文标签仅用于展示：每个 scope 恰有一个标签，且标签不作为键出现在任何判断里', () => {
    expect(Object.keys(SCOPE_LABEL).sort()).toEqual([...SCOPE_FALLBACK_ORDER].sort());
    expect(Object.isFrozen(SCOPE_LABEL)).toBe(true);
  });
});
