// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import type { ProductCreateInput } from './api/contracts';
import { authTokenStore } from './utils/authTokenStore';
import Avatar from './components/Avatar';
import ImageWithFallback from './components/ImageWithFallback';
import { AVATAR_EXTERNAL_NOT_ALLOWED, AVATAR_INVALID, fallbackPresetFor } from './utils/avatar';
import { axeViolations } from './test-axe';

/**
 * 头像（UI）：一个 Avatar 组件画所有形式；资料编辑页的 12 个预设 / 上传 / 不使用头像；提交的值与错误原话。
 * Mock 部分走 MockCampusMarketApi；REST 部分用假的 fetch 走真实的 HttpTransport + RestCampusMarketApi，断言 HTTP 请求体。
 */
const PALETTE = ['#2F6B5B', '#3D5A80', '#8A4F7D', '#A0522D', '#4B6F2F', '#6B5B95', '#B5651D', '#2E7D8C', '#8C3B3B', '#4A4E69', '#7A6C2F', '#5C6F82'];
const UUID = '0b6a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const SIGNED = `/v1/images/${UUID}?exp=1893456000&sig=abc`;
const LEGACY = ['https://picsum.photos/seed/cm-avatar-demo/200/200', 'http://picsum.photos/seed/2021001/200/200', 'https://i.picsum.photos/id/1/200/200.jpg', 'HTTPS://PICSUM.PHOTOS/seed/x/200/200'];

/** jsdom 把 style 里的十六进制颜色读成 rgb(...) */
const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
/** 一个画出来的预设头像：编号、底色、字色与文字 */
function drawn(el: Element) {
  const h = el as HTMLElement;
  return { preset: Number(h.dataset.avatarPreset), background: h.style.backgroundColor, color: h.style.color, text: h.textContent };
}
const expectDrawn = (el: Element, preset: number, text: string) =>
  expect(drawn(el)).toEqual({ preset, background: rgb(PALETTE[preset - 1]), color: rgb('#FFFFFF'), text });

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(nickname: string, mock = api) {
  return (await mock.register({ account: `face-${rnd()}`, password: 'test-password', nickname, campus: '东校区', contact: '13800000000' })).user;
}
function png() {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, 2);
  view.setUint32(20, 3);
  return b;
}
const pngFile = (name = 'face.png') => new File([png()], name, { type: 'image/png' });
const choose = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } });
const listing = (title: string): ProductCreateInput => ({
  title, description: '头像渲染测试用的商品', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['data:image/png;base64,AA=='], contact: '13800000000',
});
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}
const presetRadios = () => screen.getAllByRole('radio', { name: /^预设头像 \d+$/ });
const editor = () => screen.findByRole('group', { name: '选择头像' }, { timeout: 5000 });
const save = () => fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
const noPicsum = (root: ParentNode = document) => {
  expect([...root.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '').filter((s) => /picsum/i.test(s))).toEqual([]);
  expect((root as Element).innerHTML ?? document.body.innerHTML).not.toMatch(/picsum/i);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authTokenStore.clearAccessToken() });

describe('Avatar 组件：每一种头像值', () => {
  it('preset:1..12：本地绘制，底色是调色板第 N-1 个，白色昵称首字，不产生任何 <img>', () => {
    const { container } = render(<>{PALETTE.map((_, i) => <Avatar key={i} avatar={`preset:${i + 1}`} nickname="林小满" userId="u1" alt={`头像${i + 1}`} />)}</>);
    PALETTE.forEach((_, i) => expectDrawn(screen.getByRole('img', { name: `头像${i + 1}` }), i + 1, '林'));
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('昵称为空时画「同」；emoji 昵称不被拆成半个字符', () => {
    render(<><Avatar avatar="preset:2" nickname="" alt="甲" /><Avatar avatar="preset:2" alt="乙" /><Avatar avatar="preset:3" nickname="🐱猫" alt="丙" /></>);
    expect(screen.getByRole('img', { name: '甲' }).textContent).toBe('同');
    expect(screen.getByRole('img', { name: '乙' }).textContent).toBe('同');
    expect(screen.getByRole('img', { name: '丙' }).textContent).toBe('🐱');
  });

  it('""、null 与无法识别的值：用由用户 id 决定的预设画出来；同一 id 两次渲染结果相同', () => {
    const ids = ['u_demo', 'u_lin', 'u_zhao', 'u-1234', '42'];
    const values = ['', null, undefined, 'upload:not-resolved', '//cdn.example/a.png', 'javascript:alert(1)', 'preset:0', 'preset:13', 'ftp://x/a.png'];
    for (const id of ids) {
      for (const value of values) {
        const { container, unmount } = render(<Avatar avatar={value} nickname="赵一鸣" userId={id} alt="头像" />);
        expectDrawn(screen.getByRole('img', { name: '头像' }), fallbackPresetFor(id), '赵');
        expect(container.querySelector('img')).toBeNull();
        unmount();
      }
    }
    // 至少有两个 id 落在不同颜色上（兜底不是一个固定颜色）
    expect(new Set(ids.map(fallbackPresetFor)).size).toBeGreaterThan(1);
  });

  it('旧演示数据的外部头像（演示图床）：当作 ""，从不加载——没有 <img>，DOM 里没有这个地址', () => {
    for (const legacy of LEGACY) {
      const { container, unmount } = render(<Avatar avatar={legacy} nickname="小鹿同学" userId="u_demo" alt="小鹿同学的头像" />);
      expect(container.querySelector('img')).toBeNull();
      expectDrawn(screen.getByRole('img', { name: '小鹿同学的头像' }), fallbackPresetFor('u_demo'), '小');
      noPicsum(container);
      unmount();
    }
  });

  it('签名的相对地址 /v1/images/…：与商品图片同样补全（ImageWithFallback 得到同一个 src）', () => {
    render(<><Avatar avatar={SIGNED} nickname="陈" userId="u1" alt="上传的头像" /><ImageWithFallback src={SIGNED} alt="商品图" /></>);
    const avatar = screen.getByRole('img', { name: '上传的头像' });
    expect(avatar.tagName).toBe('IMG');
    expect(avatar.getAttribute('src')).toBe(screen.getByRole('img', { name: '商品图' }).getAttribute('src'));
    expect(avatar.getAttribute('src')).toBe(SIGNED);
  });

  it('外部 http(s) 头像：作为图片加载（不带 Referer）；加载失败后换成由 id 决定的预设', () => {
    const { container } = render(<Avatar avatar="https://example.invalid/me.png" nickname="王小米" userId="u_wang" alt="王小米的头像" />);
    const img = screen.getByRole('img', { name: '王小米的头像' });
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('https://example.invalid/me.png');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expectDrawn(screen.getByRole('img', { name: '王小米的头像' }), fallbackPresetFor('u_wang'), '王');
  });

  it('签名地址加载失败（过期）：同样退回由 id 决定的预设', () => {
    const { container } = render(<Avatar avatar={SIGNED} nickname="林" userId="u_lin" alt="林的头像" />);
    fireEvent.error(container.querySelector('img')!);
    expectDrawn(screen.getByRole('img', { name: '林的头像' }), fallbackPresetFor('u_lin'), '林');
  });

  it('可访问性：给了 alt 是有名字的图片；没给 alt 是装饰（读屏跳过）；axe 无严重问题', async () => {
    const { container } = render(<div>
      <Avatar avatar="preset:1" nickname="甲" alt="甲的头像" />
      <Avatar avatar={SIGNED} nickname="乙" alt="乙的头像" />
      <Avatar avatar="" nickname="丙" userId="u3" />
      <Avatar avatar="https://example.invalid/x.png" nickname="丁" />
    </div>);
    expect(screen.getAllByRole('img').map((e) => e.getAttribute('aria-label') ?? e.getAttribute('alt'))).toEqual(['甲的头像', '乙的头像']);
    expect(container.querySelectorAll('[aria-hidden="true"][data-avatar-kind]')).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('所有出现头像的地方都用同一个组件', () => {
  it('个人中心：导航栏、资料卡、编辑页里，旧演示头像都不加载；资料卡画的是由 id 决定的预设', async () => {
    const me = await user('小鹿同学');
    await api.updateProfile({ avatar: LEGACY[0] });
    renderApp('/profile');
    await editor();
    const card = await screen.findByRole('img', { name: '小鹿同学的头像' });
    expectDrawn(card, fallbackPresetFor(me.id), '小');
    noPicsum();
    // 导航栏的用户菜单里也是本地绘制
    const menu = screen.getByRole('button', { name: '用户菜单' });
    expect(menu.querySelector('img')).toBeNull();
    expect(drawn(menu.querySelector('[data-avatar-kind]')!).preset).toBe(fallbackPresetFor(me.id));
  });

  it('商品详情：卖家与留言作者按各自的预设画出来', async () => {
    const seller = await user('林小满');
    await api.updateProfile({ avatar: 'preset:5' });
    const product = await api.createProduct(listing('头像商品'));
    await api.addComment({ productId: product.id, content: '卖家自己的留言' });
    renderApp(`/product/${product.id}`);
    const card = await screen.findByRole('img', { name: '林小满的头像' }, { timeout: 5000 });
    expectDrawn(card, 5, '林');
    const comment = (await screen.findByText('卖家自己的留言')).closest('.rounded-xl')!;
    expectDrawn(comment.querySelector('[data-avatar-kind]')!, 5, '林');
    expect(seller.id).toBeTruthy();
    noPicsum();
  });

  it('私信：对方与消息气泡旁的头像（买家没有头像 → 由 id 决定的预设；卖家 preset:9）', async () => {
    await user('卖家');
    await api.updateProfile({ avatar: 'preset:9' });
    const product = await api.createProduct(listing('私信头像商品'));
    await user('买家');
    const conversation = await api.getOrCreateConversation(product.id);
    renderApp(`/messages/${conversation.id}`);
    expectDrawn(await screen.findByRole('img', { name: '卖家的头像' }, { timeout: 5000 }), 9, '卖');
    noPicsum();
  });
});

describe('资料编辑页（Mock）', () => {
  it('12 个预设是一个单选组（「预设头像 1」…「预设头像 12」），另有「不使用头像」与「上传头像」；axe 通过', async () => {
    await user('编辑者');
    const { container } = renderApp('/profile');
    const group = await editor();
    expect(group.tagName).toBe('FIELDSET');
    expect(presetRadios().map((r) => r.getAttribute('aria-label'))).toEqual(Array.from({ length: 12 }, (_, i) => `预设头像 ${i + 1}`));
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).name)).toEqual(Array(13).fill('avatar-choice'));
    const none = within(group).getByRole('radio', { name: '不使用头像' }) as HTMLInputElement;
    expect(none.checked).toBe(true);
    const upload = within(group).getByLabelText('上传头像') as HTMLInputElement;
    expect(upload.type).toBe('file');
    expect(upload.accept).toBe('image/jpeg,image/png');
    // 预览：每个预设按调色板画出当前昵称的首字
    presetRadios().forEach((radio, i) => expectDrawn(radio.parentElement!.querySelector('[data-avatar-kind]')!, i + 1, '编'));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('选「预设头像 7」保存：提交的 avatar 正好是 "preset:7"；保存后导航栏与资料卡改用预设 7', async () => {
    await user('七号');
    const update = vi.spyOn(api, 'updateProfile');
    renderApp('/profile');
    await editor();
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 7' }));
    expect((screen.getByRole('radio', { name: '预设头像 7' }) as HTMLInputElement).checked).toBe(true);
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].avatar).toBe('preset:7');
    await waitFor(() => expect(drawn(screen.getByRole('img', { name: '七号的头像' })).preset).toBe(7));
    expectDrawn(screen.getByRole('button', { name: '用户菜单' }).querySelector('[data-avatar-kind]')!, 7, '七');
  });

  it('「不使用头像」：提交 ""', async () => {
    await user('清空');
    await api.updateProfile({ avatar: 'preset:3' });
    const update = vi.spyOn(api, 'updateProfile');
    renderApp('/profile');
    await editor();
    expect((screen.getByRole('radio', { name: '预设头像 3' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '不使用头像' }));
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].avatar).toBe('');
    expect((await api.getCurrentUser())!.avatar).toBe('');
  });

  it('头像没改：保存其他字段时不提交 avatar；旧演示头像打开即显示为「不使用头像」，保存时提交 "" 清掉它', async () => {
    await user('不改头像');
    await api.updateProfile({ avatar: 'preset:3' });
    const update = vi.spyOn(api, 'updateProfile');
    const view = renderApp('/profile');
    await editor();
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '新昵称' } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect('avatar' in update.mock.calls[0][0]).toBe(false);
    view.unmount();

    await api.updateProfile({ avatar: LEGACY[1] });
    update.mockClear();
    renderApp('/profile');
    await editor();
    expect((screen.getByRole('radio', { name: '不使用头像' }) as HTMLInputElement).checked).toBe(true);
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].avatar).toBe('');
  });

  it('上传头像：先上传（同一个图片上传接口），选中「自定义头像」并预览；保存时提交 upload:<id> 引用', async () => {
    await user('上传者');
    const upload = vi.spyOn(api, 'uploadImage');
    const update = vi.spyOn(api, 'updateProfile');
    renderApp('/profile');
    await editor();
    choose(screen.getByLabelText('上传头像'), pngFile());
    const custom = await screen.findByRole('radio', { name: '自定义头像' });
    expect((custom as HTMLInputElement).checked).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    const uploaded = await upload.mock.results[0].value;
    expect(custom.parentElement!.querySelector('img')!.getAttribute('src')).toBe(uploaded.url);
    expect(screen.getByText('头像已上传，保存修改后生效')).toBeTruthy();
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0].avatar).toBe(uploaded.ref);
    expect(uploaded.ref).toMatch(/^upload:/);
    // 保存后资料卡显示上传的图片
    await waitFor(() => expect(screen.getByRole('img', { name: '上传者的头像' }).getAttribute('src')).toBe(uploaded.url));
  });

  it('上传前本地检查：不是 JPEG / PNG、超过 5 MB 都不上传，原因显示在上传框旁', async () => {
    await user('检查者');
    const upload = vi.spyOn(api, 'uploadImage');
    renderApp('/profile');
    await editor();
    choose(screen.getByLabelText('上传头像'), new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' }));
    expect((await screen.findByRole('alert')).textContent).toBe('只支持 JPEG 或 PNG 图片');
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    choose(screen.getByLabelText('上传头像'), big);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('图片不能超过 5 MB'));
    expect(upload).not.toHaveBeenCalled();
  });

  it('Mock、externalAllowed=false：编辑页没有外部链接输入（只有 12 个预设、自定义上传与不使用头像）；接口拒绝外链的原话与后端相同', async () => {
    const strict = new MockCampusMarketApi({ externalImagesAllowed: false });
    setApiClient(strict);
    await user('外链', strict);
    renderApp('/profile');
    await editor();
    expect(screen.queryByRole('textbox', { name: /头像/ })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(13);
    await expect(strict.updateProfile({ avatar: 'https://example.invalid/a.png' })).rejects.toMatchObject({ code: 400, message: AVATAR_EXTERNAL_NOT_ALLOWED });
  });
});

/* ------------------------------------ REST ------------------------------------ */

interface Call { method: string; path: string; body: unknown }
function restBackend(opts: { avatar?: string; patchError?: string; externalAllowed?: boolean } = {}) {
  const calls: Call[] = [];
  let me = { id: 'u_rest', account: '2021009', nickname: '远端同学', avatar: opts.avatar ?? '', campus: '东校区', contact: '13800000000', createdAt: 1, dormBuildingId: null as string | null };
  const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof FormData ? 'FormData' : undefined;
    calls.push({ method, path, body });
    if (path === '/v1/auth/refresh') return ok({ accessToken: 'rest-token', expiresAtIso: new Date(Date.now() + 900_000).toISOString(), user: me });
    if (path === '/v1/auth/me' && method === 'GET') return ok(me);
    if (path === '/v1/auth/me' && method === 'PATCH') {
      // 与后端相同：externalAllowed=false 时，请求体里只要带着外部 http(s) 头像（哪怕没改）就 400
      const external = !(opts.externalAllowed ?? false) && typeof (body as { avatar?: unknown }).avatar === 'string' && /^https?:/i.test((body as { avatar: string }).avatar);
      const error = opts.patchError ?? (external ? AVATAR_EXTERNAL_NOT_ALLOWED : undefined);
      if (error) return new Response(JSON.stringify({ code: 400, data: null, message: error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const patch = body as Partial<typeof me>;
      // 与后端相同：保存 upload:<id>，响应给签名地址
      me = { ...me, ...patch, avatar: patch.avatar?.startsWith('upload:') ? `/v1/images/${patch.avatar.slice(7)}?exp=1893456000&sig=new` : patch.avatar ?? me.avatar };
      return ok(me);
    }
    if (path === '/v1/config') return ok({ images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: opts.externalAllowed ?? false }, messages: { freeTextEnabled: false } });
    if (path === '/v1/images' && method === 'POST') return ok({ id: UUID, ref: `upload:${UUID}`, url: SIGNED, width: 2, height: 3 });
    if (path.startsWith('/v1/products')) return ok({ items: [], total: 0, page: 1, size: 100 });
    if (path === '/v1/messages/unread' || path === '/v1/demand-matches/unread-count') return ok({ count: 0 });
    if (path === '/v1/contact-requests/unread-count') return ok({ received: 0, updates: 0, total: 0 });
    return ok(path.startsWith('/v1/buildings') || path === '/v1/favorites' || path === '/v1/conversations' || path.startsWith('/v1/circles') ? [] : null);
  });
  setApiClient(new RestCampusMarketApi(new HttpTransport({ fetchImpl })));
  return { calls, patches: () => calls.filter((c) => c.method === 'PATCH' && c.path === '/v1/auth/me').map((c) => c.body) };
}

describe('资料编辑页（REST：断言 HTTP 请求体）', () => {
  it('选「预设头像 2」：PATCH /v1/auth/me 的请求体逐字段相同', async () => {
    const backend = restBackend();
    renderApp('/profile');
    await editor();
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 2' }));
    save();
    await waitFor(() => expect(backend.patches()).toHaveLength(1));
    expect(backend.patches()[0]).toEqual({ nickname: '远端同学', campus: '东校区', contact: '13800000000', avatar: 'preset:2', dormBuildingId: null });
  });

  it('上传头像：POST /v1/images（multipart），预览签名地址，PATCH 里是 upload:<uuid>；保存后资料卡显示响应里的签名地址', async () => {
    const backend = restBackend();
    renderApp('/profile');
    await editor();
    choose(screen.getByLabelText('上传头像'), pngFile());
    const custom = await screen.findByRole('radio', { name: '自定义头像' });
    expect(backend.calls.filter((c) => c.path === '/v1/images')).toEqual([{ method: 'POST', path: '/v1/images', body: 'FormData' }]);
    expect(custom.parentElement!.querySelector('img')!.getAttribute('src')).toBe(SIGNED);
    save();
    await waitFor(() => expect(backend.patches()).toHaveLength(1));
    expect(backend.patches()[0]).toEqual({ nickname: '远端同学', campus: '东校区', contact: '13800000000', avatar: `upload:${UUID}`, dormBuildingId: null });
    await waitFor(() => expect(screen.getByRole('img', { name: '远端同学的头像' }).getAttribute('src')).toBe(`/v1/images/${UUID}?exp=1893456000&sig=new`));
  });

  it('当前头像是签名地址、没有改动：显示为「自定义头像」并预览；保存其他字段时 PATCH 里没有 avatar', async () => {
    const backend = restBackend({ avatar: SIGNED });
    renderApp('/profile');
    await editor();
    const custom = screen.getByRole('radio', { name: '自定义头像' }) as HTMLInputElement;
    expect(custom.checked).toBe(true);
    expect(custom.parentElement!.querySelector('img')!.getAttribute('src')).toBe(SIGNED);
    save();
    await waitFor(() => expect(backend.patches()).toHaveLength(1));
    expect(backend.patches()[0]).toEqual({ nickname: '远端同学', campus: '东校区', contact: '13800000000', dormBuildingId: null });
  });

  it('当前头像是旧的外部链接、externalAllowed=false：只改昵称时 PATCH 不带 avatar，保存成功（后端对带着外链的请求一律 400）', async () => {
    const OLD = 'https://example.invalid/old-face.png';
    const backend = restBackend({ avatar: OLD, externalAllowed: false });
    renderApp('/profile');
    await editor();
    const custom = screen.getByRole('radio', { name: '自定义头像' }) as HTMLInputElement;
    expect(custom.checked).toBe(true);
    expect(custom.parentElement!.querySelector('img')!.getAttribute('src')).toBe(OLD);
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: '改个昵称' } });
    save();
    await waitFor(() => expect(backend.patches()).toHaveLength(1));
    expect(backend.patches()[0]).toEqual({ nickname: '改个昵称', campus: '东校区', contact: '13800000000', dormBuildingId: null });
    expect(await screen.findByText('资料已更新')).toBeTruthy();
    const card = screen.getByRole('button', { name: '保存修改' }).closest('.rounded-2xl') as HTMLElement;
    expect(within(card).queryByRole('alert')).toBeNull();
  });

  it('先选预设、再改回「自定义头像」：等于没改，PATCH 不带 avatar', async () => {
    const OLD = 'https://example.invalid/old-face.png';
    const backend = restBackend({ avatar: OLD, externalAllowed: false });
    renderApp('/profile');
    await editor();
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 2' }));
    expect((screen.getByRole('radio', { name: '自定义头像' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: '自定义头像' }));
    save();
    await waitFor(() => expect(backend.patches()).toHaveLength(1));
    expect('avatar' in (backend.patches()[0] as object)).toBe(false);
  });

  it.each([AVATAR_INVALID, AVATAR_EXTERNAL_NOT_ALLOWED])('400「%s」：原话显示在保存按钮旁', async (message) => {
    restBackend({ patchError: message });
    renderApp('/profile');
    await editor();
    fireEvent.click(screen.getByRole('radio', { name: '预设头像 4' }));
    save();
    const card = screen.getByRole('button', { name: '保存修改' }).closest('.rounded-2xl') as HTMLElement;
    await waitFor(() => expect(within(card).getAllByRole('alert').map((a) => a.textContent)).toEqual([message]));
  });

  it('REST 构建、externalAllowed=false：整页没有任何指向演示图床的地址', async () => {
    restBackend({ avatar: LEGACY[0] });
    renderApp('/profile');
    await editor();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) });
    // 页面完整渲染（没有落到错误边界），资料卡与导航栏都画了由 id 决定的预设
    expect(screen.queryByText('页面加载失败')).toBeNull();
    expectDrawn(screen.getByRole('img', { name: '远端同学的头像' }), fallbackPresetFor('u_rest'), '远');
    expect((screen.getByRole('radio', { name: '不使用头像' }) as HTMLInputElement).checked).toBe(true);
    noPicsum();
  });
});
