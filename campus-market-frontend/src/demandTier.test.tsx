// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import type { CampusMarketApi, DemandMatch, DemandMatchPage } from './api/contracts';
import DemandSubscribeDialog from './components/demand/DemandSubscribeDialog';
import { reasonLabel, tierLabel } from './utils/demand';

/**
 * 3.0A：档位与理由码只做映射，不在前端重新计算；3.0B：订阅限制提示。
 */

function renderDemands() {
  return render(
    <MemoryRouter initialEntries={['/demands']}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <DemandUnreadProvider>
              <App />
            </DemandUnreadProvider>
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

function match(overrides: Partial<DemandMatch>): DemandMatch {
  return {
    id: 'm1', score: 10, tier: 'NORMAL', reasonCodes: ['KEYWORD_DESCRIPTION'], read: false, valid: true,
    invalidReason: null, createdAt: Date.now(),
    product: {
      id: 'p1', title: '服务端给的商品', description: 'd', price: 999, category: '数码电子', condition: '全新',
      campus: '东校区', images: [], contact: '', sellerId: 's', status: '在售', views: 0, createdAt: Date.now(),
    },
    subscription: { id: 's1', keyword: '台灯', category: null, minPrice: null, maxPrice: null, geoScope: 'SCHOOL',
      campusId: null, buildingId: null, zone: null, buildingName: null },
    ...overrides,
  };
}

/** 以一个真实登录的 Mock 为底，只替换收件箱接口，模拟 REST 返回。 */
async function withInbox(items: DemandMatch[]): Promise<void> {
  const base = new MockCampusMarketApi();
  await base.register({ account: `t-${Math.random().toString(36).slice(2)}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
  const page: DemandMatchPage = { items, total: items.length, page: 1, pageSize: 50 };
  setApiClient(new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'listDemandMatches') return async () => page;
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as CampusMarketApi);
}

beforeEach(() => window.localStorage.clear());

describe('3.0A 档位只来自服务端', () => {
  it('1. REST 返回 tier=HIGH、score=10：界面原样展示「高匹配」，不按分数改成「一般」', async () => {
    await withInbox([match({ score: 10, tier: 'HIGH' })]);
    renderDemands();
    const chip = await screen.findByText('高匹配', undefined, { timeout: 5000 });
    expect(chip.closest('[data-tier]')?.getAttribute('data-tier')).toBe('HIGH');
    expect(screen.queryByText('一般匹配')).toBeNull();
  });

  it('2. 反过来：score=100 但 tier=NORMAL，仍显示「一般匹配」——前端不重新推导', async () => {
    await withInbox([match({ score: 100, tier: 'NORMAL', reasonCodes: ['KEYWORD_TITLE_EXACT', 'CATEGORY', 'SAME_BUILDING', 'PRICE_CLOSE'] })]);
    renderDemands();
    expect(await screen.findByText('一般匹配', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('高匹配')).toBeNull();
  });

  it('3. 修改商品数据（价格、标题）不会让前端重新推导档位', async () => {
    await withInbox([match({ tier: 'NORMAL', product: { ...match({}).product, title: '标题与关键词台灯完全一致', price: 1 } })]);
    renderDemands();
    expect(await screen.findByText('一般匹配', undefined, { timeout: 5000 })).toBeTruthy();
  });

  it('4. 未知理由码与未知档位安全降级，不报错、不显示空白', async () => {
    expect(reasonLabel('SOME_FUTURE_CODE')).toBe('其他匹配理由');
    expect(tierLabel('SUPER')).toBe('匹配');
    await withInbox([match({ reasonCodes: ['SOME_FUTURE_CODE', 'CATEGORY'] })]);
    renderDemands();
    expect(await screen.findByText(/匹配理由：其他匹配理由、分类相符/, undefined, { timeout: 5000 })).toBeTruthy();
  });

  it('5. 原始分数不与档位同时展示给用户', async () => {
    await withInbox([match({ score: 87, tier: 'HIGH' })]);
    renderDemands();
    await screen.findByText('高匹配', undefined, { timeout: 5000 });
    await waitFor(() => expect(document.body.textContent).not.toMatch(/\b87\b/));
  });
});

describe('3.0B 订阅限制提示', () => {
  it('6. 确认界面简洁说明：字面匹配、只匹配之后的商品、不保证收到', () => {
    render(
      <MemoryRouter>
        <DemandSubscribeDialog open title="订阅" submitLabel="确认订阅" initial={{}} userCampus="东校区"
          onCancel={() => {}} onSubmit={() => {}} />
      </MemoryRouter>,
    );
    const notes = screen.getByRole('list', { name: '订阅说明' });
    expect(notes.textContent).toContain('字面匹配');
    expect(notes.textContent).toContain('只匹配之后新发布或新编辑的商品');
    expect(notes.textContent).toContain('不保证一定能收到匹配');
    // 不是阻塞式协议：没有需要勾选的复选框
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
