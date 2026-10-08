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
 * 8.0 如实文案：学校身份由注册者自选、平台不核验，因此首页与商品卡片不能出现「实名认证」「认证同学」
 * 或没有来源的统计数字（「1,400+ 件」「2,300+ 名」「减少 1.8kg」「节省 65%」「100% 实名」）。
 */
let api: MockCampusMarketApi;
beforeEach(() => { window.localStorage.clear(); api = new MockCampusMarketApi(); setApiClient(api) });
afterEach(cleanup);

describe('8.0 如实文案', () => {
  it('登录后的首页与商品卡片：不宣称实名认证，不展示没有来源的统计数字；如实说明平台不核验学籍', async () => {
    await api.register({ account: `copy${Date.now()}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '13800000000' });
    await api.createProduct({ title: '文案台灯', description: 'd', price: 20, category: '其他', condition: '几乎全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '13800000000' } as ProductCreateInput);
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
      </MemoryRouter>,
    );
    expect((await screen.findAllByText('文案台灯', undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/实名|认证同学|统一身份认证|1,400\+|2,300\+|1\.8kg|65%|100%/);
    expect(text).toContain('平台目前不核验学籍或身份');
    expect(text).toContain('只和本校同学交易');
  });
});
