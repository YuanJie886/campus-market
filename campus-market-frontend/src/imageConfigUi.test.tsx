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
import { RestCampusMarketApi } from './api/restCampusMarketApi';
import { HttpTransport } from './api/httpTransport';
import { authTokenStore } from './utils/authTokenStore';
import { DEFAULT_CLIENT_CONFIG, type ClientConfig, type ListingDraft } from './api/contracts';
import ProductForm from './components/ProductForm';
import BundleProductForm from './components/supply/BundleProductForm';
import ListingItemEditor from './components/supply/ListingItemEditor';
import ImageUploader from './components/ImageUploader';
import { IMAGE_PRESETS } from './utils/externalDemoImages';
import { axeViolations } from './test-axe';

/**
 * GET /v1/config 驱动的图片规则（张数、大小、类型、是否允许外部示例图），以及草稿响应里的签名地址。
 * REST 部分用假的 fetch 走真实的 HttpTransport + RestCampusMarketApi；其余基于 Mock 适配层。
 */
const DB = 'campus_market_mock_database_v1';
const UUID = '0b6a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const SIGNED = `/v1/images/${UUID}?exp=1893456000&sig=abc`;
const EXTERNAL = 'https://example.invalid/old-photo.png';

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
async function seller() {
  await api.register({ account: `seller-${rnd()}`, password: 'test-password', nickname: '卖家', campus: '东校区', contact: '13800000000' });
}
function png() {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, 2);
  view.setUint32(20, 3);
  return b;
}
const pngFile = (name = 'photo.png') => new File([png()], name, { type: 'image/png' });
const choose = (input: HTMLElement, ...files: File[]) => fireEvent.change(input, { target: { files } });
const config = (images: Partial<ClientConfig['images']>): ClientConfig => ({ images: { ...DEFAULT_CLIENT_CONFIG.images, ...images }, messages: { ...DEFAULT_CLIENT_CONFIG.messages } });

/** 假的后端：按路径返回 envelope；记录每一次请求 */
type Route = (method: string, path: string, body: unknown) => { status?: number; data?: unknown; raw?: string } | undefined;
function restApi(route: Route) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const hit = route(method, path, body) ?? { data: path.startsWith('/v1/buildings') || path.startsWith('/v1/circles/mine') ? [] : null };
    const status = hit.status ?? 200;
    if (hit.raw !== undefined) return new Response(hit.raw, { status, headers: { 'Content-Type': 'text/html' } });
    return new Response(JSON.stringify({ code: status === 200 ? 0 : status, data: hit.data ?? null, message: status === 200 ? 'ok' : '服务拒绝' }),
      { status, headers: { 'Content-Type': 'application/json' } });
  });
  authTokenStore.setAccessToken('test-access-token', new Date(Date.now() + 900_000).toISOString());
  const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
  return { rest, calls, fetchImpl };
}
const configCalls = (calls: Array<{ path: string }>) => calls.filter((c) => c.path === '/v1/config');

function renderProductForm(props: Partial<Parameters<typeof ProductForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const view = render(
    <MemoryRouter><NotificationProvider>
      <ProductForm
        initial={{ title: '图片规则测试', description: '这里是完整的商品情况描述', price: '20', category: '其他', contact: 'wechat:seller' }}
        onSubmit={onSubmit}
        {...props}
      />
    </NotificationProvider></MemoryRouter>,
  );
  return { ...view, onSubmit };
}
const draft = (payload: ListingDraft['payload'], extra: Partial<ListingDraft> = {}): ListingDraft => ({
  id: 'd1', draftType: 'SINGLE', status: 'DRAFT', version: 3, payload, access: 'OWNER', editedByAssistant: false,
  batchId: null, publishedProductId: null, expiresAt: Date.now() + 86_400_000, createdAt: 1, updatedAt: 1, ...extra,
});
function renderEditor(d: ListingDraft, onSaved = vi.fn()) {
  render(
    <MemoryRouter><NotificationProvider>
      <ListingItemEditor draft={d} label="第 1 件" onSaved={onSaved} onReload={() => {}} />
    </NotificationProvider></MemoryRouter>,
  );
  return onSaved;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authTokenStore.clearAccessToken() });

describe('GET /v1/config（REST 适配层）', () => {
  it('旧后端 404（JSON envelope 或网关的 HTML 页）：回落到 9 张 / 5 MB / JPEG、PNG / 允许外部图片', async () => {
    const json = restApi((m, p) => (p === '/v1/config' ? { status: 404 } : undefined));
    expect(await json.rest.getClientConfig()).toEqual({ images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: true }, messages: { freeTextEnabled: false } });
    expect(json.calls).toEqual([{ method: 'GET', path: '/v1/config', body: undefined }]);
    const html = restApi((m, p) => (p === '/v1/config' ? { status: 404, raw: '<html>Not Found</html>' } : undefined));
    expect(await html.rest.getClientConfig()).toEqual(DEFAULT_CLIENT_CONFIG);
  });

  it('新后端：按返回值使用；缺失或类型不对的字段回落到默认值；其他错误（500）不被当成默认值吞掉', async () => {
    const ok = restApi(() => ({ data: { images: { maxCount: 6, maxBytes: 2 * 1024 * 1024, accept: ['image/jpeg'], externalAllowed: false } } }));
    // 这个后端还没有 messages 字段：私信按只能发送快捷消息处理
    expect(await ok.rest.getClientConfig()).toEqual({ images: { maxCount: 6, maxBytes: 2 * 1024 * 1024, accept: ['image/jpeg'], externalAllowed: false }, messages: { freeTextEnabled: false } });
    const partial = restApi(() => ({ data: { images: { maxCount: '9', accept: [], externalAllowed: false } } }));
    expect(await partial.rest.getClientConfig()).toEqual(config({ externalAllowed: false }));
    const down = restApi(() => ({ status: 500 }));
    await expect(down.rest.getClientConfig()).rejects.toMatchObject({ httpStatus: 500 });
  });
});

describe('图片规则来自配置（只请求一次）', () => {
  it('旧后端 404：上传组件按默认规则工作（0/9、accept=JPEG/PNG、5 MB、显示示例图）；两个组件只请求一次 /v1/config', async () => {
    const { rest, calls } = restApi((m, p) => (p === '/v1/config' ? { status: 404 } : undefined));
    setApiClient(rest);
    render(<>
      <ImageUploader value={[]} onChange={() => {}} label="甲图片" inputId="a" presets={IMAGE_PRESETS.slice(0, 2)} />
      <ImageUploader value={[]} onChange={() => {}} label="乙图片" inputId="b" />
    </>);
    expect(await screen.findByRole('button', { name: '选择图片 1' })).toBeTruthy();
    expect(screen.getByText('甲图片（0/9）')).toBeTruthy();
    expect((screen.getByLabelText('上传图片', { selector: '#a' }) as HTMLInputElement).accept).toBe('image/jpeg,image/png');
    expect(screen.getAllByText(/支持 JPEG 或 PNG，单张不超过 5 MB，最多 9 张。/)).toHaveLength(2);
    expect(configCalls(calls)).toHaveLength(1);
  });

  it('自定义规则：张数、大小与类型都按配置检查（3 张、1 MB、只收 JPEG）', async () => {
    await seller();
    vi.spyOn(api, 'getClientConfig').mockResolvedValue(config({ maxCount: 3, maxBytes: 1024 * 1024, accept: ['image/jpeg'] }));
    const upload = vi.spyOn(api, 'uploadImage');
    renderProductForm();
    expect(await screen.findByText('商品图片（0/3）')).toBeTruthy();
    const input = screen.getByLabelText('上传图片') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg');
    expect(screen.getByText(/支持 JPEG，单张不超过 1 MB，最多 3 张。/)).toBeTruthy();
    const big = new File([new Uint8Array(1)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 1024 * 1024 + 1 });
    choose(input, pngFile('a.png'), big);
    const progress = await screen.findByRole('list', { name: '上传进度' });
    expect(within(progress).getByText('「a.png」上传失败：只支持 JPEG 图片')).toBeTruthy();
    expect(within(progress).getByText('「big.jpg」上传失败：图片不能超过 1 MB')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('张数上限 9（单件、整套、批量三个编辑器一致）', () => {
  it('单件发布一次选 10 张：只上传 9 张，第 10 张提示「最多 9 张图片」，上传框随后不可用；axe 通过', async () => {
    await seller();
    const upload = vi.spyOn(api, 'uploadImage');
    const { container, onSubmit } = renderProductForm();
    expect(await screen.findByText('商品图片（0/9）')).toBeTruthy();
    const files = Array.from({ length: 10 }, (_, i) => pngFile(`p${i + 1}.png`));
    choose(screen.getByLabelText('上传图片'), ...files);
    expect(await screen.findByText('「p10.png」上传失败：最多 9 张图片')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('商品图片（9/9）')).toBeTruthy());
    expect(upload).toHaveBeenCalledTimes(9);
    expect(screen.getAllByRole('img', { name: /^商品图片第 \d 张/ })).toHaveLength(9);
    expect((screen.getByLabelText('上传图片') as HTMLInputElement).disabled).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].images).toHaveLength(9);
  });

  it('整套打包与批量发布的每一件同样是 0/9（不再各自写死）', async () => {
    await seller();
    render(
      <MemoryRouter><NotificationProvider>
        <BundleProductForm initial={{ contact: '13800000000', campus: '东校区', buildingId: null }} onSubmit={vi.fn()} />
      </NotificationProvider></MemoryRouter>,
    );
    expect(await screen.findByText('商品图片（0/9）')).toBeTruthy();
    cleanup();
    const created = await api.createListingDraft({ draftType: 'SINGLE', payload: {} });
    renderEditor(created);
    expect(await screen.findByText('商品图片（0/9）')).toBeTruthy();
  });
});

describe('externalAllowed=false：不显示示例图，已有的外部图片照常显示、可保留可移除', () => {
  const noExternal = () => vi.spyOn(api, 'getClientConfig').mockResolvedValue(config({ externalAllowed: false, maxBytes: 4 * 1024 * 1024 }));

  it('发布：没有示例图选择，上传照常；对照组（允许时）有示例图；axe 通过', async () => {
    await seller();
    noExternal();
    const { container } = renderProductForm();
    // 等配置真正生效（4 MB 只可能来自配置），再断言示例图不存在
    expect(await screen.findByText(/单张不超过 4 MB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择图片/ })).toBeNull();
    expect(screen.queryByText(/或选择示例图/)).toBeNull();
    choose(screen.getByLabelText('上传图片'), pngFile());
    expect(await screen.findByRole('img', { name: '商品图片第 1 张（封面）' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    cleanup();
    api = new MockCampusMarketApi();
    setApiClient(api);
    renderProductForm();
    expect(await screen.findByRole('button', { name: '选择图片 1' })).toBeTruthy();
  });

  it('拿不到配置（500）：按默认的张数与大小工作，但不显示示例图（不在禁止外部图片的部署上给出必被拒绝的选项）', async () => {
    await seller();
    const failing = vi.spyOn(api, 'getClientConfig').mockRejectedValue(Object.assign(new Error('服务暂时不可用'), { status: 500 }));
    renderProductForm();
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/单张不超过 5 MB，最多 9 张/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择图片/ })).toBeNull();
    choose(screen.getByLabelText('上传图片'), pngFile());
    expect(await screen.findByRole('img', { name: '商品图片第 1 张（封面）' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择图片/ })).toBeNull();
  });

  it('编辑已有商品：原有的外部图片仍显示并随保存保留；可以移除；没有示例图可加', async () => {
    await seller();
    noExternal();
    const { onSubmit } = renderProductForm({ mode: 'edit', submitLabel: '保存修改', initial: {
      title: '旧的台灯商品', description: '这里是完整的商品情况描述', price: '20', category: '其他', contact: 'wechat:seller', images: [EXTERNAL, SIGNED],
    } });
    expect(await screen.findByText(/单张不超过 4 MB/)).toBeTruthy();
    await screen.findByText(/该分类暂无结构化验货清单/);
    const cover = screen.getByRole('img', { name: '商品图片第 1 张（封面）' });
    expect(cover.getAttribute('src')).toBe(EXTERNAL);
    expect(screen.getByRole('img', { name: '商品图片第 2 张' }).getAttribute('src')).toBe(SIGNED);
    expect(screen.queryByRole('button', { name: /选择图片/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].images).toEqual([EXTERNAL, SIGNED]);
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 张图片' }));
    await waitFor(() => expect(screen.getByText('商品图片（1/9）')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].images).toEqual([SIGNED]);
  });

  it('REST 编辑请求：保留的外部图片原样提交，签名地址还原成 upload:<id>', async () => {
    const { rest, calls } = restApi((m, p) => (m === 'PATCH' ? { data: { id: 'p1' } } : undefined));
    await rest.updateProduct('p1', { images: [EXTERNAL, SIGNED] });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ images: [EXTERNAL, `upload:${UUID}`] });
  });

  it('整套打包与批量发布的每一件同样不显示示例图，草稿里已有的外部图片照常显示', async () => {
    await seller();
    noExternal();
    render(
      <MemoryRouter><NotificationProvider>
        <BundleProductForm initial={{ contact: '13800000000', campus: '东校区', buildingId: null }} onSubmit={vi.fn()} />
      </NotificationProvider></MemoryRouter>,
    );
    expect(await screen.findByText(/单张不超过 4 MB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /整套选择图片/ })).toBeNull();
    cleanup();
    const created = await api.createListingDraft({ draftType: 'SINGLE', payload: { images: [EXTERNAL] } });
    renderEditor(created);
    expect(await screen.findByText(/单张不超过 4 MB/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择图片/ })).toBeNull();
    expect(screen.getByRole('img', { name: '商品图片第 1 张（封面）' }).getAttribute('src')).toBe(EXTERNAL);
  });
});

describe('草稿：响应里的签名地址直接显示，保存时还原成引用', () => {
  it('REST：草稿里的签名地址显示为图片（不是占位图）；「保存这件」提交 upload:<id>；新建草稿同样还原', async () => {
    const saved = draft({ title: '台灯', images: [SIGNED] }, { version: 4 });
    const { rest, calls } = restApi((m, p) => {
      if (p === '/v1/config') return { data: { images: { maxCount: 9, maxBytes: 5242880, accept: ['image/jpeg', 'image/png'], externalAllowed: false } } };
      if (m === 'PATCH' && p === '/v1/listing-drafts/d1') return { data: saved };
      if (m === 'POST' && p === '/v1/listing-drafts') return { data: saved };
      return undefined;
    });
    setApiClient(rest);
    const onSaved = renderEditor(draft({ title: '台灯', images: [SIGNED, EXTERNAL] }));
    const img = await screen.findByRole('img', { name: '商品图片第 1 张（封面）' });
    expect(img.getAttribute('src')).toBe(SIGNED);
    fireEvent.click(screen.getByRole('button', { name: '保存这件' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ expectedVersion: 3, payload: { title: '台灯', images: [`upload:${UUID}`, EXTERNAL] } });
    await rest.createListingDraft({ draftType: 'SINGLE', payload: { images: [SIGNED] } });
    expect(calls.find((c) => c.method === 'POST' && c.path === '/v1/listing-drafts')?.body).toEqual({ draftType: 'SINGLE', payload: { images: [`upload:${UUID}`] } });
  });

  it('Mock：刷新页面后（新的适配层实例、内存里没有上传记录）打开批次，图片照常显示；再保存时草稿里仍是 upload:<id>', async () => {
    await seller();
    const image = await api.uploadImage(pngFile());
    const created = await api.createListingDraft({ draftType: 'SINGLE', payload: { title: '刷新后的台灯', images: [image.ref] } });
    expect(created.payload.images).toEqual([image.url]);
    const batch = await api.createListingBatch({ draftIds: [created.id] });
    // 模拟刷新：重新创建适配层（从 localStorage 读回数据）
    api = new MockCampusMarketApi();
    setApiClient(api);
    const update = vi.spyOn(api, 'updateListingDraft');
    render(
      <MemoryRouter initialEntries={[`/publish/batch?batch=${batch.id}`]}>
        <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
      </MemoryRouter>,
    );
    const editor = await screen.findByRole('region', { name: /第 1 件/ }, { timeout: 5000 });
    const img = await within(editor).findByRole('img', { name: '商品图片第 1 张（封面）' });
    expect(img.getAttribute('src')).toBe(image.url);
    fireEvent.click(within(editor).getByRole('button', { name: '保存这件' }));
    await within(editor).findByText(/已保存/);
    expect(update.mock.calls[0][1].payload?.images).toEqual([image.url]);
    const stored = JSON.parse(window.localStorage.getItem(DB)!).listingDrafts.find((d: { id: string }) => d.id === created.id).payload.images;
    expect(stored).toEqual([image.ref]);
  });
});
