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
import { ApiError } from './api/errors';
import { PRICE_GUIDANCE_NOTE, type ListingPayload } from './api/contracts';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';
import PriceGuidanceCard from './components/supply/PriceGuidanceCard';
import type { Category } from './types';

/**
 * 模块 5 的界面：毕业季快速发布工作台、整套打包发布与展示、协助整理邀请与协助页、价格参考。
 * axe 严重 / 致命为 0（jsdom 不检查颜色对比度，不等于 WCAG 合规）；键盘可达；焦点管理；role=status。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
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
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') });

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label = 'u') {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });
function single(category: Category, title: string, price: number): ListingPayload {
  return {
    title, description: '毕业季界面测试', price, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}),
  };
}
async function pick(scope: HTMLElement, label: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
async function readyBatch(n: number, prefix: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push((await api.createListingDraft({ payload: single('生活用品', `${prefix}-${i + 1}`, 10 + i) })).id);
  return (await api.createListingBatch({ draftIds: ids })).id;
}

describe('5.3 毕业季快速发布工作台', () => {
  it('新建批次、添加单件：焦点到标题；分类 / 成色不预选；验货声明不预选「正常」；不读相册、不申请相机；axe 通过', async () => {
    await user('owner');
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const { container } = renderApp('/publish/batch');
    fireEvent.click(await screen.findByRole('button', { name: '新建批次' }, { timeout: 5000 }));
    const add = await screen.findByRole('button', { name: '添加单件' });
    fireEvent.click(add);
    const title = await screen.findByLabelText('标题');
    await waitFor(() => expect(document.activeElement).toBe(title));
    const editor = screen.getByRole('region', { name: /第 1 件/ });
    // MUI 的空选择框只渲染一个零宽占位符
    expect(within(editor).getByRole('combobox', { name: /^分类/ }).textContent?.replace(/\u200b/g, '').trim()).toBe('');
    expect(within(editor).getByRole('combobox', { name: /^成色/ }).textContent?.replace(/\u200b/g, '').trim()).toBe('');
    await pick(editor, /^分类/, '数码电子');
    await within(editor).findByRole('heading', { name: /数码电子验货清单/ });
    const radios = within(editor).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.length).toBeGreaterThan(0);
    expect(radios.some((r) => r.checked)).toBe(false);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('复制通用字段：只复制校区 / 取货楼栋 / 联系方式，不复制分类、价格、成色或验货声明', async () => {
    await user('owner');
    const first = await api.createListingDraft({ payload: { ...single('数码电子', '第一件', 99), campus: '西校区', contact: '13900000000' } });
    const batch = await api.createListingBatch({ draftIds: [first.id] });
    renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('checkbox', { name: /复制上一件的通用字段/ }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: '添加单件' }));
    await screen.findByRole('region', { name: /第 2 件/ });
    const stored = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts;
    const second = stored.find((d: { id: string }) => d.id !== first.id);
    expect(second.payload).toEqual({ campus: '西校区', contact: '13900000000' });
  });

  it('检查全部：缺项清单获得焦点，点击条目把焦点带到那一件的标题；逐件保存', async () => {
    await user('owner');
    const a = await api.createListingDraft({ payload: single('生活用品', '完整的一件', 10) });
    const b = await api.createListingDraft({ payload: { title: '只有标题' } });
    const batch = await api.createListingBatch({ draftIds: [a.id, b.id] });
    const { container } = renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '检查全部' }, { timeout: 5000 }));
    const summary = await screen.findByText('还有 1 件需要修改');
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    const entry = screen.getByRole('button', { name: /第 2 件：还有必填项没填（描述、价格、分类、成色、校区、图片）/ });
    fireEvent.click(entry);
    await waitFor(() => expect(within(screen.getByRole('region', { name: /第 2 件/ })).getByLabelText('标题')).toBe(document.activeElement));
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '补上描述' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这件' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts.find((d: { id: string }) => d.id === b.id).payload.description).toBe('补上描述'));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('发布：一次确认；有协助人参与时写明「内容由他人协助整理，商品所有者已检查并确认发布。」；成功后结果标题获得焦点', async () => {
    const owner = await user('owner');
    const batch = await readyBatch(3, '确认发布');
    const draftId = (await api.getListingBatch(batch)).items[0].draft.id;
    const { token } = await api.createAssistInvite({ batchId: batch });
    await user('helper');
    await api.redeemAssistInvite(token);
    const edit = single('生活用品', '协助整理过的第一件', 12);
    delete edit.contact;
    await api.updateListingDraft(draftId, { expectedVersion: 1, payload: edit });
    await as(owner);
    const spy = vi.spyOn(api, 'publishListingBatch');
    renderApp(`/publish/batch?batch=${batch}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 3 件' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '确认一次发布 3 件？' });
    expect(dialog.textContent).toContain('内容由他人协助整理，商品所有者已检查并确认发布。');
    expect(dialog.textContent).toContain('全部成功或全部不发布');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }));
    const heading = await screen.findByRole('heading', { name: '已发布 3 件' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/^batch-[0-9a-f]{32}$/);
    expect(screen.getAllByRole('link', { name: /查看第 \d 件/ })).toHaveLength(3);
  });

  it('发布被拒：不假装部分成功；逐件原因出现在清单里；已填写的其他条目都还在', async () => {
    await user('owner');
    const batch = await readyBatch(2, '会被拒');
    const draftId = (await api.getListingBatch(batch)).items[1].draft.id;
    vi.spyOn(api, 'publishListingBatch').mockRejectedValueOnce(ApiError.mock({
      code: 400, message: '有 1 件商品还不能发布，整个批次都没有发布',
      details: { items: [{ position: 2, draftId, code: 'INVALID_PRICE', field: 'price', message: '价格最多两位小数' }] },
    }));
    renderApp(`/publish/batch?batch=${batch}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 2 件' }, { timeout: 5000 }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText(/整个批次都没有发布/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: '第 2 件：价格无效' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /已发布/ })).toBeNull();
    const nav = screen.getByRole('navigation', { name: '批次中的商品' });
    expect(within(nav).getByRole('button', { name: /会被拒-1/ })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /会被拒-2/ })).toBeTruthy();
  });

  it('多标签页：另一页已保存更新的版本时 409，提示并提供「重新加载这件」，不静默覆盖、不自动合并', async () => {
    await user('owner');
    const d = await api.createListingDraft({ payload: single('生活用品', '原标题', 10) });
    const batch = await api.createListingBatch({ draftIds: [d.id] });
    renderApp(`/publish/batch?batch=${batch.id}`);
    const title = await screen.findByLabelText('标题', undefined, { timeout: 5000 });
    // 另一个标签页（同一份 localStorage）先保存了一版
    const otherTab = new MockCampusMarketApi();
    await otherTab.updateListingDraft(d.id, { expectedVersion: 1, payload: single('生活用品', '另一页的标题', 11) });
    fireEvent.change(title, { target: { value: '这一页的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这件' }));
    expect(await screen.findByText(/已在其他页面或被协助人保存过/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts[0].payload.title).toBe('另一页的标题');
    fireEvent.click(screen.getByRole('button', { name: '重新加载这件' }));
    await waitFor(() => expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('另一页的标题'));
  });
});

describe('5.4 整套打包', () => {
  it('发布页切换到整套打包：写明不支持单独下单；默认 2 行且不预选分类；添加 / 删除行的焦点；空提交错误摘要获得焦点；axe 通过', async () => {
    await user('seller');
    const { container } = renderApp('/publish');
    fireEvent.click(await screen.findByRole('button', { name: '整套打包' }, { timeout: 5000 }));
    expect(screen.getByRole('button', { name: '整套打包' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText(/整套出售，不支持单独下单/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('第 1 行名称')).toBeTruthy();
    expect(screen.getByLabelText('第 2 行名称')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '第 1 行分类' }).textContent?.replace(/\u200b/g, '').trim()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '添加一行' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('第 3 行名称')));
    fireEvent.click(screen.getByRole('button', { name: '删除第 3 行' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '添加一行' })));
    fireEvent.click(screen.getByRole('button', { name: '删除第 1 行' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('第 1 行名称')));
    fireEvent.click(screen.getByRole('button', { name: '发布整套' }));
    const summary = await screen.findByText(/还有内容需要补充/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    expect(summary.parentElement!.textContent).toContain('打包明细需要 2～30 行');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('填写完整后发布：提交体是 listingKind=BUNDLE + 明细；商品卡片写「整套转让 · 包含 N 类 / N 件」，详情列出明细与平均每件（仅展示）', async () => {
    await user('seller');
    const spy = vi.spyOn(api, 'createProduct');
    renderApp('/publish');
    fireEvent.click(await screen.findByRole('button', { name: '整套打包' }, { timeout: 5000 }));
    fireEvent.change(screen.getByLabelText('整套标题'), { target: { value: '宿舍整套带走' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '毕业清仓' } });
    fireEvent.change(screen.getByLabelText('整套总价（元）'), { target: { value: '90' } });
    await pick(document.body, /^主分类/, '其他 / 混合物品');
    await pick(document.body, /^整体成色/, '轻微使用痕迹');
    fireEvent.click(screen.getByRole('button', { name: '整套选择图片 1' }));
    const rows: Array<[string, string, string]> = [['台灯', '生活用品', '2'], ['高数教材', '教材书籍', '1']];
    for (const [i, [name, category, qty]] of rows.entries()) {
      fireEvent.change(screen.getByLabelText(`第 ${i + 1} 行名称`), { target: { value: name } });
      await pick(document.body, new RegExp(`^第 ${i + 1} 行分类`), category);
      await pick(document.body, new RegExp(`^第 ${i + 1} 行成色`), '全新');
      fireEvent.change(screen.getByLabelText(`第 ${i + 1} 行数量`), { target: { value: qty } });
    }
    fireEvent.click(screen.getByRole('button', { name: '发布整套' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(body.listingKind).toBe('BUNDLE');
    expect(body.bundleItems).toEqual([
      { name: '台灯', category: '生活用品', condition: '全新', quantity: 2 },
      { name: '高数教材', category: '教材书籍', condition: '全新', quantity: 1 },
    ]);
    expect(body).not.toHaveProperty('inspection');
    const created = await spy.mock.results[0].value;
    cleanup();

    const { container } = renderApp(`/product/${created.id}`);
    const section = await screen.findByRole('region', { name: '整套转让明细' }, { timeout: 5000 });
    expect(section.textContent).toContain('整套出售，不支持单独下单');
    expect(section.textContent).toContain('2 类 / 3 件');
    expect(section.textContent).toContain('平均每件约 ¥30.00（仅供参考，不能按件购买）');
    expect(within(section).getAllByRole('row')).toHaveLength(3);
    expect(await axeViolations(container)).toEqual([]);
    cleanup();

    renderApp('/');
    await waitFor(() => expect(document.querySelector('[data-listing-kind="BUNDLE"]')?.textContent).toContain('整套转让 · 包含 2 类 / 3 件'), { timeout: 5000 });
  });
});

describe('5.5 协助整理发布', () => {
  it('邀请弹窗：邀请码只显示一次并获得焦点；链接把邀请码放在 # 之后；不写入任何浏览器存储；关闭后无法再看到；axe 通过', async () => {
    await user('owner');
    const batch = await readyBatch(1, '邀请');
    const { baseElement } = renderApp(`/publish/batch?batch=${batch}`);
    const trigger = await screen.findByRole('button', { name: '邀请协助整理' }, { timeout: 5000 });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '邀请协助整理发布' });
    expect(dialog.textContent).toContain('不能发布');
    expect(dialog.textContent).not.toMatch(/代卖|平台代理/);
    fireEvent.click(within(dialog).getByRole('button', { name: '生成一次性邀请' }));
    const tokenInput = await within(dialog).findByLabelText('邀请码（只显示这一次）') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(tokenInput));
    const token = tokenInput.value;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(dialog.textContent).toContain(`/assist#code=${token}`);
    expect(dialog.textContent).not.toContain(`?code=${token}`);
    const storage = [...Object.keys(localStorage).map((k) => localStorage.getItem(k)), ...Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k))].join('\n');
    expect(storage).not.toContain(token);
    expect(await axeViolations(baseElement)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.body.textContent).not.toContain(token);
    expect(await screen.findByText('等待对方兑换')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销邀请' }));
    expect(await screen.findByText('已撤销')).toBeTruthy();
  });

  it('协助页：从 # 读取邀请码后立刻从地址栏抹掉；兑换后只能整理允许的字段，没有联系方式、图片或发布按钮；axe 通过', async () => {
    const owner = await user('owner');
    const draft = await api.createListingDraft({ payload: single('生活用品', '请帮我整理', 20) });
    const { token } = await api.createAssistInvite({ draftId: draft.id });
    await user('helper');
    window.history.replaceState(null, '', `/assist#code=${token}`);
    const { container } = renderApp('/assist');
    const input = await screen.findByLabelText('邀请码', undefined, { timeout: 5000 }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(token));
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    const heading = await screen.findByRole('heading', { name: '我正在协助的草稿' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(input.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /请帮我整理/ }));
    const editor = await screen.findByRole('region', { name: '协助整理' });
    expect(within(editor).queryByLabelText(/联系方式/)).toBeNull();
    expect(within(editor).queryByRole('button', { name: /选择图片/ })).toBeNull();
    expect(within(editor).queryByRole('combobox', { name: /^成色/ })).toBeNull();
    expect(within(editor).getByLabelText('价格建议（元）')).toBeTruthy();
    expect(screen.queryAllByRole('button').filter((b) => /发布这|确认发布|发布整套|立即发布/.test(b.textContent ?? ''))).toEqual([]);
    expect(container.textContent).not.toContain('13800000000');
    fireEvent.change(within(editor).getByLabelText('标题'), { target: { value: '协助整理后的标题' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存这件' }));
    expect(await within(editor).findByText('协助整理已保存')).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts[0];
    expect(stored.payload).toMatchObject({ title: '协助整理后的标题', contact: '13800000000', condition: '几乎全新' });
    expect(await axeViolations(container)).toEqual([]);
    void owner;
  });
});

describe('5.6 价格参考', () => {
  it('样本不足：不显示区间与样本数；样本足够：中位数与四分位区间；固定说明文字；没有「AI 估价 / 官方指导价 / 保证成交」', async () => {
    await user('viewer');
    const { container, unmount } = render(<PriceGuidanceCard category="生活用品" />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('不足 8 笔'));
    expect(container.textContent).toContain(PRICE_GUIDANCE_NOTE);
    expect(await axeViolations(container)).toEqual([]);
    unmount();

    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    for (let i = 1; i <= 10; i += 1) {
      raw.market.products.push({ id: `g${i}`, title: 't', description: 'd', price: i * 10, category: '生活用品', condition: '全新', campus: '东校区', images: [], contact: '', sellerId: 's', status: '已售出', views: 0, createdAt: 1, listingKind: 'SINGLE' });
      raw.market.orders.push({ id: `go${i}`, productId: `g${i}`, buyerId: 'b', sellerId: 's', price: i * 10, status: '已完成', canonicalStatus: 'COMPLETED', createdAt: 1, updatedAt: Date.now(), priceSnapshot: i * 10, currency: 'CNY',
        schoolIdSnapshot: 'pilot', categorySnapshot: '生活用品', conditionSnapshot: '全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: null });
    }
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    setApiClient(api);
    const second = render(<PriceGuidanceCard category="生活用品" />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('中位数约 ¥55'));
    expect(second.container.textContent).toContain('¥33～¥78');
    expect(second.container.textContent).toContain('至少 10 笔');
    expect(second.container.textContent).not.toMatch(/AI 估价|官方指导价|保证成交|必须按此定价/);
  });
});
