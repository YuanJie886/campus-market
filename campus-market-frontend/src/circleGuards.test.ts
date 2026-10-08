import { describe, expect, it } from 'vitest';
import { CIRCLE_MAX_PER_PRODUCT } from './api/contracts';
import { LEAVE_CONSEQUENCES } from './utils/circle';

/**
 * 模块 6 的补充源码守卫。行为结论以 circle.contract / circleUi 两组行为测试为准，
 * 这里只防止之后的修改引入明显的回退（文案自称官方、圈子信息进 URL query 或存储）。
 */
const sources = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const app = Object.entries(sources).filter(([path]) => !path.includes('.test.') && !path.endsWith('test-axe.ts') && !path.startsWith('./test/'));
const circleFiles = app.filter(([path]) => /circle|Circle/.test(path));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (files: Array<[string, string]>, pattern: RegExp) => files.filter(([, text]) => pattern.test(stripComments(text))).map(([path]) => path);
const backend = import.meta.glob('../../campus-market-backend/src/main/java/com/lulu/campusmarketbackend/circle/*.java', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const V9 = Object.values(import.meta.glob('../../campus-market-backend/src/main/resources/db/migration/V9__circle_market.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

describe('6 文案边界', () => {
  it('界面从不出现「官方认证 / 学校认证 / 已认证」一类说法（连否定句也不用，与模块 4 的红线一致）', () => {
    expect(offenders(app, /官方认证|学校认证|已认证|认证班级|认证社团|官方圈子|官方群/)).toEqual([]);
    expect(stripComments(sources['./pages/circles/CircleCreatePage.tsx'])).toContain('未经学校核实');
  });
  it('退出确认的三条后果与后端数量上限保持一致', () => {
    expect(LEAVE_CONSEQUENCES.join('')).toMatch(/圈子订阅将停用.*私密商品将不可见.*已经成立的订单不受影响/);
    expect(CIRCLE_MAX_PER_PRODUCT).toBe(5);
    expect(V9).toMatch(/BETWEEN 1 AND 5|<= 5|> 5/);
  });
  it('数据库没有「官方」列，也没有自动建立宿舍圈的逻辑', () => {
    expect(V9).not.toMatch(/\bofficial\b|\bverified\b/i);
    expect(V9).not.toMatch(/'DORM'/);
    for (const text of Object.values(backend)) expect(text).not.toMatch(/DORM|dormBuilding/);
  });
});

describe('6 隐私', () => {
  it('圈子邀请码只放在 # 片段与请求体：不出现在 URL query，不写入浏览器存储', () => {
    expect(offenders(circleFiles, /[?&](code|token)=/)).toEqual([]);
    expect(offenders(circleFiles, /localStorage|sessionStorage|indexedDB|document\.cookie/)).toEqual([]);
  });
  it('圈子页面不把圈子名、搜索词或成员信息写进地址栏 query，也不上报分析或打印日志', () => {
    expect(offenders(circleFiles, /setSearchParams|useSearchParams|\?q=\$\{|search:\s*`/)).toEqual([]);
    expect(offenders(circleFiles, /console\.(log|info|warn|error|debug)|analytics|gtag|track\(/)).toEqual([]);
  });
  it('用户类型（公开资料由它派生）与公开履历类型里没有圈子字段', () => {
    const types = Object.values(import.meta.glob('../packages/types/index.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
    const userType = /export interface User \{[\s\S]*?\n\}/.exec(types)?.[0] ?? '';
    expect(userType).toContain('nickname');
    expect(userType).not.toMatch(/circle/i);
    expect(types).toMatch(/export type PublicUser = Omit<User,/);
    const contracts = sources['./api/contracts.ts'];
    expect(/export interface PublicTradeSummary \{[^}]*\}/.exec(contracts)?.[0]).not.toMatch(/circle/i);
  });
});
