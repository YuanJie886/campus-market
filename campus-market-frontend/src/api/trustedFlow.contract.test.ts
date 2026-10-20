// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { seedInspectionTemplates } from '../data/inspectionTemplates';
import { fullDisclosure } from '../test/inspectionFixtures';
import type { Category } from '../types';

/**
 * 模块 3 的 Mock 契约：与后端 TrustedMeetingFlowIT / ProductInspectionIT 的关键断言逐条对应，
 * 保证「Mock 能做、REST 不能做」的关键路径不存在，反之亦然。
 *
 * <p>平台已改为只展示商品与联系方式：订单快照与验货（3.3）、档期握手（3.4）、出发与到达（3.5）、
 * 交易履历（3.6）的接口已从前端适配层移除，对应用例随功能移除；商品声明（3.2）仍然有效。
 */

// 直接读后端 V5 迁移源码做一致性比对：Mock 模板是从这份 SQL 生成的，任何一边漂移都会失败
const V5_SQL = Object.values(import.meta.glob('../../../campus-market-backend/src/main/resources/db/migration/V5__trusted_meeting_flow.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)[0] ?? '';

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function code(p: Promise<unknown>): Promise<number> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}

describe('3.2 模板与商品声明', () => {
  it('Mock 模板与 V5 种子逐项一致（分类、版本、条目码、必填）', () => {
    expect(V5_SQL).toContain('inspection_template_items');
    // 解析 SQL 种子：('模板:码', '模板', '码', '标签', '说明', 必填, 顺序)
    const rows = [...V5_SQL.matchAll(/\('([\w-]+):(\w+)',\s*'([\w-]+)',\s*'(\w+)',\s*'([^']*)',\s*'([^']*)',\s*(true|false),\s*(\d+)\)/g)]
      .map((m) => ({ template: m[3], code: m[4], label: m[5], description: m[6], required: m[7] === 'true', order: Number(m[8]) }));
    for (const t of seedInspectionTemplates) {
      expect(V5_SQL).toMatch(new RegExp(`\\('${t.id}',\\s*'${t.category}',\\s*${t.version},\\s*'${t.title}'\\)`));
      const sqlItems = rows.filter((r) => r.template === t.id).sort((a, b) => a.order - b.order);
      expect(t.items.map((i) => [i.code, i.label, i.description, i.required]))
        .toEqual(sqlItems.map((r) => [r.code, r.label, r.description, r.required]));
    }
    expect(rows).toHaveLength(28);
    expect(seedInspectionTemplates.map((t) => t.category).sort())
      .toEqual(['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外'].sort());
    expect(seedInspectionTemplates.reduce((n, t) => n + t.items.length, 0)).toBe(28);
  });

  it('模板查询：受支持分类返回当前版本，「其他」为 null，非法分类 400', async () => {
    const t = await api.getInspectionTemplate('数码电子');
    expect(t?.version).toBe(1);
    expect(Object.keys(t!).sort()).toEqual(['category', 'items', 'title', 'version']);
    expect(Object.keys(t!.items[0]).sort()).toEqual(['code', 'description', 'label', 'required']);
    expect(await api.getInspectionTemplate('其他')).toBeNull();
    expect(await code(api.getInspectionTemplate('不存在的分类' as Category))).toBe(400);
  });

  it('受支持分类：缺必填 / 未知条目 / 重复条目 / 非法状态 / 未知字段 → 400，且商品不落库', async () => {
    await user('seller');
    const base = { title: `声明 ${rnd()}`, description: 'd', price: 10, category: '生活用品' as const, condition: '全新' as const,
      campus: '东校区' as const, images: ['https://example.invalid/a.png'], contact: '1' };
    const full = fullDisclosure('生活用品')!;
    const before = (await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total;
    const bad: unknown[] = [
      undefined,
      full.slice(1),
      [...full, { itemCode: 'NOPE', condition: 'NORMAL' }],
      [...full, full[0]],
      full.map((d, i) => (i === 0 ? { ...d, condition: 'GOOD' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, sellerId: 'x' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, templateVersion: 1 } : d)),
      full.map((d, i) => (i === 0 ? { ...d, note: '<b>x</b>' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, note: 'x'.repeat(201) } : d)),
    ];
    for (const inspection of bad) {
      expect(await code(api.createProduct({ ...base, inspection: inspection as never }))).toBe(400);
    }
    expect((await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total).toBe(before);
  });

  it('不默认 NORMAL：声明原样保存；「其他」分类提交清单被拒，不提交则可发布', async () => {
    await user('seller');
    const declared = fullDisclosure('生活用品', 'NOT_TESTED')!;
    const p = await api.createProduct({ title: `原样 ${rnd()}`, description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: [], contact: '1', inspection: declared });
    const detail = await api.getProduct(p.id);
    expect(detail.inspection!.items.every((i) => i.condition === 'NOT_TESTED')).toBe(true);

    const other = { title: `其他 ${rnd()}`, description: 'd', price: 10, category: '其他' as const, condition: '全新' as const,
      campus: '东校区' as const, images: [], contact: '1' };
    expect(await code(api.createProduct({ ...other, inspection: declared }))).toBe(400);
    const plain = await api.createProduct(other);
    expect((await api.getProduct(plain.id)).inspection).toBeNull();
  });

  it('切换分类必须提供新分类的声明；不带 inspection 只改其他字段时声明不变', async () => {
    await user('seller');
    const p = await api.createProduct({ title: `切换 ${rnd()}`, description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: [], contact: '1', inspection: fullDisclosure('生活用品') });
    expect(await code(api.updateProduct(p.id, { category: '数码电子' }))).toBe(400);
    // 旧分类的声明不能被复用到新分类
    expect(await code(api.updateProduct(p.id, { category: '数码电子', inspection: fullDisclosure('生活用品') }))).toBe(400);
    await api.updateProduct(p.id, { title: `切换后 ${rnd()}` });
    expect((await api.getProduct(p.id)).inspection?.category).toBe('生活用品');
    await api.updateProduct(p.id, { category: '数码电子', inspection: fullDisclosure('数码电子') });
    expect((await api.getProduct(p.id)).inspection?.category).toBe('数码电子');
  });
});

describe('REST 适配层', () => {
  it('卖家声明只剩模板查询这一个接口；订单验货 / 档期 / 到达 / 交易履历的方法已从适配层移除', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(url), init?.body as string | undefined]);
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.getInspectionTemplate('数码电子');
    expect(calls.map(([m, u]) => `${m} ${u.replace(/^https?:\/\/[^/]+/, '')}`)).toEqual([
      `GET /v1/inspection-templates?category=${encodeURIComponent('数码电子')}`,
    ]);
    for (const retired of ['getOrderFlow', 'saveInspectionDraft', 'submitInspection', 'proposeMeeting', 'acceptMeeting', 'rejectMeeting',
      'withdrawMeeting', 'updatePresence', 'getOwnTradeHistory', 'getPublicTradeSummary']) {
      expect(retired in RestCampusMarketApi.prototype, retired).toBe(false);
      expect(retired in api, retired).toBe(false);
    }
  });
});
