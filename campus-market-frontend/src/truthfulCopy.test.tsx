// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import type { ProductCreateInput } from './api/contracts';

/**
 * 8.0 如实文案：学校身份由注册者自选、平台不核验，因此任何页面都不能出现「实名认证」「认证同学」「已认证」
 * 或没有来源的统计数字（「1,400+ 件」「2,300+ 名」「减少 1.8kg」「节省 65%」「100% 实名」）。
 *
 * <p>平台改为只展示商品与联系方式后，首页不再承载「不核验学籍或身份」的说明；这条说明放在买家申请联系方式的
 * 商品页联系区块里——那是用户决定是否联系对方的位置。
 */
const CLAIMS = /实名|认证同学|统一身份认证|已认证|官方认证|学校认证|1,400\+|2,300\+|1\.8kg|65%|100%/;
const listing = { title: '文案台灯', description: 'd', price: 20, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000' } as ProductCreateInput;

let api: MockCampusMarketApi;
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); api = new MockCampusMarketApi(); setApiClient(api) });
afterEach(cleanup);

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

describe('8.0 如实文案', () => {
  it('登录后的首页与商品卡片：不宣称实名 / 认证，不展示没有来源的统计数字', async () => {
    await api.register({ account: `copy${Date.now()}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '13800000000' });
    await api.createProduct(listing);
    const { container } = renderApp('/');
    expect((await screen.findAllByText('文案台灯', undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(container.textContent ?? '').not.toMatch(CLAIMS);
  });

  it('商品页联系区块（买家申请联系方式处）：如实说明平台不核验学籍或身份、只展示商品与联系方式；整页不宣称实名 / 认证', async () => {
    await api.register({ account: `seller${Date.now()}`, password: 'test-password', nickname: '卖家', campus: '东校区', contact: '13800000000' });
    const product = await api.createProduct(listing);
    await api.register({ account: `buyer${Date.now()}`, password: 'test-password', nickname: '买家', campus: '东校区', contact: '13800000001' });
    const { container } = renderApp(`/product/${product.id}`);
    const want = await screen.findByRole('button', { name: '我想要' }, { timeout: 5000 });
    const block = (await screen.findByText('注册时的学校与校区由用户自行选择，平台目前不核验学籍或身份。')).parentElement!;
    expect(block.textContent).toContain('平台仅展示商品与卖家提供的联系方式，不提供交易、预约或履约服务');
    expect(block.textContent).toContain('点击“我想要”申请，经卖家同意后展示');
    expect(want).toBeTruthy();
    expect(container.textContent ?? '').not.toMatch(CLAIMS);
  });
});
