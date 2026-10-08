import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * E2E 夹具：
 *   · 每个参与方一个独立的 browser context（买卖双方、工作人员不共享登录存储）；
 *   · 账号每次随机生成，不依赖固定账号或执行顺序；
 *   · 失败时保存截图（确认码区域打码）与脱敏 trace：删除网络记录与响应体，替换本次登记的全部敏感值
 *     （密码、access token、刷新 Cookie、邀请码、确认码）以及任何 JWT 形状的字符串；
 *   · 数据库夹具只通过 docker exec 在本次的一次性容器里执行（本地 socket，不需要密码）。
 */

export interface Party {
  label: string;
  context: BrowserContext;
  page: Page;
  account: string;
  password: string;
  id: string;
  nickname: string;
  token: string;
}

const rnd = () => randomBytes(4).toString('hex');

/** 本次测试登记的敏感值：失败时从 trace 中替换掉 */
class Secrets {
  readonly values = new Set<string>();
  add(v: string | undefined | null) { if (v && v.length >= 4) this.values.add(v) }
}

export function sql(query: string): string {
  const out = execFileSync('docker', ['exec', '-i', process.env.E2E_DB_CONTAINER!, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1',
    '-U', process.env.E2E_DB_USER!, '-d', process.env.E2E_DB_NAME!], { input: query, encoding: 'utf8' });
  return out.trim();
}

/** 测试专用时间旅行：订单当前档期（订单行 + 冻结快照）整体平移，结束于 minutesAgo 分钟前（与后端 SlotClock 相同） */
export function slotEndedMinutesAgo(orderId: string, minutesAgo: number) {
  sql(`BEGIN; SET LOCAL session_replication_role = replica;
    UPDATE orders SET meeting_at = now() - make_interval(mins => ${minutesAgo + 60}), meeting_ends_at = now() - make_interval(mins => ${minutesAgo}) WHERE id = '${orderId}';
    UPDATE order_slot_agreements a SET starts_at = o.meeting_at, ends_at = o.meeting_ends_at FROM orders o WHERE o.id = '${orderId}' AND a.order_id = o.id AND a.meeting_revision = o.meeting_revision;
    COMMIT;`);
}

/** 受控 SQL 夹具：与运维手册配置工作人员的语句相同 */
export function makeStaff(userId: string, role: 'MODERATOR' | 'SENIOR_MODERATOR' = 'SENIOR_MODERATOR') {
  sql(`INSERT INTO staff_members(user_id, school_id, role) SELECT u.id, c.school_id, '${role}' FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = '${userId}';`);
}

/** 第二所学校（多校部署只需要登记学校与校区） */
export function ensureSecondSchool(): string {
  sql(`INSERT INTO schools(id, name) VALUES ('e2e-lake', 'E2E 湖畔学校') ON CONFLICT DO NOTHING;
       INSERT INTO campuses(id, school_id, name) VALUES ('E2E湖畔校区', 'e2e-lake', 'E2E湖畔校区') ON CONFLICT DO NOTHING;
       INSERT INTO meeting_points(id, campus_id, name) VALUES ('E2E湖畔校区-library', 'E2E湖畔校区', '图书馆门口') ON CONFLICT DO NOTHING;`);
  return 'E2E湖畔校区';
}

function scrubTrace(zip: string, secrets: Secrets) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-e2e-trace-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    for (const file of walk(dir)) {
      // 网络记录与响应体里可能有令牌、Cookie、邀请码：整体删除
      if (/\.network$/.test(file) || file.includes(`${join(dir, 'resources')}`)) { rmSync(file); continue }
      let text = readFileSync(file, 'utf8');
      for (const v of secrets.values) text = text.split(v).join('[REDACTED]');
      text = text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED-JWT]')
        .replace(/cm_refresh=[^;"\s]+/g, 'cm_refresh=[REDACTED]');
      writeFileSync(file, text);
    }
    rmSync(zip);
    execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Fixtures = {
  secrets: Secrets;
  /** register=false：只创建一个独立的、未登录的 browser context（访客） */
  party: (label: string, opts?: { campus?: string; viewport?: { width: number; height: number }; register?: boolean }) => Promise<Party>;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  secrets: async ({}, use) => { await use(new Secrets()) },
  consoleErrors: async ({}, use) => { await use([]) },
  party: async ({ browser, secrets, consoleErrors }, use, testInfo) => {
    const parties: Party[] = [];
    const make = async (label: string, opts: { campus?: string; viewport?: { width: number; height: number }; register?: boolean } = {}) => {
      const context = await newTracedContext(browser, opts.viewport);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text()}`) });
      page.on('pageerror', (e) => consoleErrors.push(`[${label}] ${e.message}`));
      const account = `e2e${rnd()}${rnd()}`.slice(0, 20);
      const password = `pw-${randomBytes(9).toString('base64url')}`;
      const nickname = `${label}${rnd().slice(0, 4)}`;
      secrets.add(password);
      if (opts.register === false) {
        const guest: Party = { label, context, page, account: '', password: '', id: '', nickname: '', token: '' };
        parties.push(guest);
        return guest;
      }
      const res = await context.request.post('/v1/auth/register', {
        data: { account, password, nickname, campus: opts.campus ?? '东校区', contact: '13800000000' },
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      secrets.add(body.data.accessToken);
      for (const c of await context.cookies()) secrets.add(c.value);
      const p: Party = { label, context, page, account, password, id: body.data.user.id, nickname, token: body.data.accessToken };
      parties.push(p);
      return p;
    };
    await use(make);
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const p of parties) {
      for (const c of await p.context.cookies()) secrets.add(c.value);
      if (failed) {
        for (const pg of p.context.pages()) {
          await pg.screenshot({ path: testInfo.outputPath(`${p.label}-failure.png`), fullPage: true,
            mask: [pg.getByText(/交易确认码/)] }).catch(() => undefined);
        }
        const zip = testInfo.outputPath(`${p.label}-trace.zip`);
        await p.context.tracing.stop({ path: zip }).catch(() => undefined);
        if (existsSync(zip)) {
          try { scrubTrace(zip, secrets) } catch { rmSync(zip, { force: true }) }   // 无法脱敏就不保存
        }
      } else {
        await p.context.tracing.stop().catch(() => undefined);
      }
      await p.context.close();
    }
  },
});

async function newTracedContext(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: viewport ?? { width: 1280, height: 900 }, locale: 'zh-CN' });
  // 测试栈封闭运行：除本机测试栈外的请求一律拦截（预置示例图片来自外部站点，页面应回退为占位图）
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  return context;
}

/** 以 party 的身份调用 REST 接口（带 access token；与页面共享同一个 context 的 Cookie） */
export async function apiCall(p: Party, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await p.context.request.fetch(path, { method, data, headers: { Authorization: `Bearer ${p.token}`, ...headers } });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status(), body: json, data: json?.data };
}

export async function apiOk(p: Party, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown, headers: Record<string, string> = {}) {
  const r = await apiCall(p, method, path, data, headers);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.data;
}

/** 打开页面并等待登录恢复（刷新 Cookie → access token 只在内存） */
export async function open(p: Party, path: string) {
  await p.page.goto(path);
  await expect(p.page.getByRole('button', { name: '用户菜单' })).toBeVisible({ timeout: 15_000 });
}

export function hourStart(hoursFromNow: number): Date {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}

export function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export { expect };
export type { TestInfo };
