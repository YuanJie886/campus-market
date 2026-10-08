import { describe, expect, it } from 'vitest';

/**
 * 模块 6.1 / 7 的补充源码守卫。行为结论以 governance.contract / governanceUi / inviteContinuity 与后端 IT 为准，
 * 这里只防止之后的修改引入明显的回退。
 */
const sources = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const app = Object.entries(sources).filter(([path]) => !path.includes('.test.') && !path.endsWith('test-axe.ts') && !path.startsWith('./test/'));
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (files: Array<[string, string]>, pattern: RegExp) => files.filter(([, text]) => pattern.test(stripComments(text))).map(([path]) => path);
const backend = import.meta.glob(['../../campus-market-backend/src/main/java/com/lulu/campusmarketbackend/**/*.java'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const javaOf = (name: string) => Object.entries(backend).find(([p]) => p.endsWith(`/${name}.java`))?.[1] ?? '';
const V10 = Object.values(import.meta.glob('../../campus-market-backend/src/main/resources/db/migration/V10__commitment_and_moderation.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const config = import.meta.glob(['../scripts/check-bundles.mjs'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('7 文案边界', () => {
  it('不公开信用分、不承诺赔付或真伪鉴定、不把「已到达」说成定位证据', () => {
    // 只允许否定句（「不计算信用分」），不允许任何展示或计算信用分的说法
    const scoreLines = app.flatMap(([path, text]) => stripComments(text).split('\n')
      .filter((l) => /信用分|信用积分|信誉分|credit ?score/i.test(l) && !/不计算[「]?信用分/.test(l)).map((l) => `${path}: ${l.trim()}`));
    expect(scoreLines).toEqual([]);
    expect(offenders(app, /平台赔付|先行赔付|保证退款|鉴定为真|鉴定为假|平台判定.*责任/)).toEqual([]);
    const governanceUi = app.filter(([p]) => /governance|moderation|NoShow/i.test(p));
    expect(governanceUi.length).toBeGreaterThan(0);
    const noShow = sources['./components/governance/NoShowPanel.tsx'];
    expect(noShow).toContain('不是定位证据');
    expect(noShow).toContain('单方报告不会产生任何处罚');
  });
});

describe('6.1B / 7 隐私', () => {
  it('暂存的邀请码只在模块内存里：不碰任何浏览器存储、Cookie 或日志', () => {
    const store = stripComments(sources['./utils/pendingInvite.ts']);
    expect(store).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|BroadcastChannel|postMessage/);
    for (const path of ['./pages/circles/CircleJoinPage.tsx', './pages/LoginPage.tsx', './pages/RegisterPage.tsx']) {
      expect(stripComments(sources[path]), path).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\.(log|info|warn|error)|[?&](code|token)=/);
    }
  });
  it('治理界面不把举报目标、案件或限制写进地址栏 query，也不打印日志', () => {
    const files = app.filter(([p]) => /governance|moderation/i.test(p));
    expect(offenders(files, /setSearchParams|useSearchParams|console\.(log|info|warn|error|debug)/)).toEqual([]);
  });
});

describe('7 工作人员与演示开关', () => {
  it('工作人员权限每次从数据库读取：JWT 里没有角色；注册接口不接受角色；迁移不植入任何工作人员', () => {
    expect(javaOf('JwtService')).not.toMatch(/role|staff/i);
    expect(javaOf('StaffGuard')).toContain('selectActiveStaff');
    expect(javaOf('AuthService')).toMatch(/REGISTER_FIELDS = java\.util\.Set\.of\("account", "password", "nickname", "campus", "contact"\)/);
    expect(V10).not.toMatch(/INSERT INTO staff_members/i);
    expect(V10).toMatch(/CHECK \(ends_at > starts_at AND ends_at <= starts_at \+ interval '30 days'\)/);
  });
  it('演示工作人员开关只在 Mock 构建里懒加载；REST 客户端没有对应能力；产物检查覆盖这个标记', () => {
    expect(stripComments(sources['./pages/profile/ProfileInfoPage.tsx'])).toMatch(/import\.meta\.env\.VITE_API_MODE === "mock" \? lazy\(/);
    expect(stripComments(sources['./api/restCampusMarketApi.ts'])).not.toContain('demoBecomeStaff');
    expect(sources['./components/demo/DemoStaffSwitch.tsx']).toContain('demo-staff-switch');
    expect(Object.values(config)[0]).toContain("'demo-staff-switch'");
  });
});
