// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { axeViolations } from './test-axe';

/** 6.1C：圈子管理页分页加载成员（每页 20 人），不一次加载全部；翻页可用键盘操作，页码变化用 polite 区域播报。 */
const DB = 'campus_market_mock_database_v1';
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('6.1C 成员分页', () => {
  it('45 名成员：首页只取 20 人；显示总数、页码与人数上限；下一页取第 2 页；axe 通过', async () => {
    await api.register({ account: `owner-${Date.now()}`, password: 'test-password', nickname: '圈主', campus: '东校区', contact: '1' });
    const circle = await api.createCircle({ type: 'CLUB', name: '分页圈' });
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    for (let i = 0; i < 44; i += 1) {
      raw.users.push({ id: `m-${i}`, account: `m-${i}`, password: 'x', nickname: `成员${String(i).padStart(2, '0')}`, avatar: '', campus: '东校区', contact: '', createdAt: 1 });
      raw.circleMemberships.push({ circleId: circle.id, userId: `m-${i}`, role: 'MEMBER', status: 'ACTIVE', joinedAt: 1000 + i, updatedAt: 1000 + i, endedAt: null });
    }
    window.localStorage.setItem(DB, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    setApiClient(api);
    const spy = vi.spyOn(api, 'listCircleMembers');
    const { container } = renderApp(`/circles/${circle.id}/manage`);
    const list = await screen.findByRole('list', { name: '成员列表' }, { timeout: 5000 });
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('heading', { name: '成员（45）' })).toBeTruthy();
    expect(screen.getByText(/每个圈子最多 1000 名在籍成员/)).toBeTruthy();
    expect(spy).toHaveBeenCalledWith(circle.id, 1, 20);
    const nav = screen.getByRole('navigation', { name: '成员分页' });
    expect(within(nav).getByText('第 1 / 3 页').getAttribute('aria-live')).toBe('polite');
    expect(await axeViolations(container)).toEqual([]);
    const next = within(nav).getByRole('button', { name: '下一页' });
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(within(nav).getByText('第 2 / 3 页')).toBeTruthy());
    expect(spy).toHaveBeenLastCalledWith(circle.id, 2, 20);
    expect(within(screen.getByRole('list', { name: '成员列表' })).getByText(/成员19/)).toBeTruthy();
    expect(spy.mock.calls.every(([, , size]) => size === 20)).toBe(true);
  });
});
