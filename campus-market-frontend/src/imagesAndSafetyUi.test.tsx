// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import { CONTENT_BLOCKED_MESSAGE, type ProductCreateInput } from './api/contracts';
import ProductForm from './components/ProductForm';
import BundleProductForm from './components/supply/BundleProductForm';
import VisibilityPicker from './components/circle/VisibilityPicker';
import ImageWithFallback from './components/ImageWithFallback';
import { resolveImageSrc } from './utils/images';
import { LEAVE_CONSEQUENCES } from './utils/circle';
import { ASSIST_SCOPE_TEXT } from './components/supply/AssistInviteDialog';
import { ASSISTANT_ROLE_TEXT } from './pages/AssistPage';
import { axeViolations } from './test-axe';

/**
 * 阶段 4 图片上传与内容安全的界面（docs/images-and-content-safety.md），阶段 2 的 CONTACT_PARTY 回避原因，
 * 移动端底部导航的联系申请角标，以及「订单」文案改写为联系模型后的界面。全部基于 Mock 适配层的真实行为。
 */

const DB = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
let lastPath = '';
function PathProbe() { lastPath = useLocation().pathname; return null }
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App /><PathProbe />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
const ids = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  ids.set(label, s.user.id);
  return s.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const listing = (title: string, extra: Partial<ProductCreateInput> = {}): ProductCreateInput => ({
  title, description: '阶段四界面测试的商品描述', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000', ...extra,
});
function png(width = 2, height = 3) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}
const pngFile = (name = 'photo.png') => new File([png()], name, { type: 'image/png' });
const choose = (input: HTMLElement, ...files: File[]) => fireEvent.change(input, { target: { files } });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
/** 页面内联的错误：服务端原话原样出现（Mock 的错误会在后面附上可复制的错误编号） */
const alertWith = (text: string, scope: HTMLElement = document.body) => waitFor(() => {
  const found = within(scope).getAllByRole('alert').find((el) => el.textContent?.includes(text));
  expect(found, text).toBeTruthy();
  return found!;
});
function renderForm(onSubmit = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <NotificationProvider>
        <ProductForm
          initial={{ title: '上传图片的商品', description: '这里是完整的商品情况描述', price: '20', category: '其他', contact: 'wechat:seller' }}
          onSubmit={onSubmit}
        />
      </NotificationProvider>
    </MemoryRouter>,
  );
  return { ...view, onSubmit };
}
async function formReady() {
  await screen.findByText('该分类暂无结构化验货清单，可以直接发布。');
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('图片上传（单件发布 / 编辑表单）', () => {
  // REWRITTEN：单件发布的上限从 5 张改为 GET /v1/config 的 maxCount（默认 9），计数显示为 1/9
  it('文件输入框有标签、只接受 JPEG / PNG；成功后显示缩略图（替代文字）并播报；提交的是 upload:<id> 引用；axe 通过（REWRITTEN：上限 9）', async () => {
    await user('seller');
    const upload = vi.spyOn(api, 'uploadImage');
    const { container, onSubmit } = renderForm();
    await formReady();
    const input = screen.getByLabelText('上传图片') as HTMLInputElement;
    expect([input.type, input.accept]).toEqual(['file', 'image/jpeg,image/png']);
    choose(input, pngFile());
    const thumb = await screen.findByRole('img', { name: '商品图片第 1 张（封面）' });
    expect(thumb.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await waitFor(() => expect(screen.queryByText('「photo.png」上传中…')).toBeNull());
    const live = [...container.querySelectorAll('[role="status"][aria-live="polite"]')].find((el) => el.textContent?.includes('上传成功'));
    expect(live?.textContent).toBe('「photo.png」上传成功');
    expect(screen.getByText('商品图片（1/9）')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const ref = (await upload.mock.results[0].value).ref;
    expect(ref).toMatch(/^upload:[0-9a-f-]{36}$/);
    expect(onSubmit.mock.calls[0][0].images).toEqual([ref]);
  });

  // REWRITTEN：计数改为 0/9
  it('本地检查：不是 JPEG / PNG、超过 5 MB 的文件不上传，逐张给出原因（REWRITTEN：上限 9）', async () => {
    await user('seller');
    const upload = vi.spyOn(api, 'uploadImage');
    renderForm();
    await formReady();
    const big = new File([new Uint8Array(1)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    choose(screen.getByLabelText('上传图片'), new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }), big);
    const progress = await screen.findByRole('list', { name: '上传进度' });
    expect(within(progress).getByText('「anim.gif」上传失败：只支持 JPEG 或 PNG 图片')).toBeTruthy();
    expect(within(progress).getByText('「big.jpg」上传失败：图片不能超过 5 MB')).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByText('商品图片（0/9）')).toBeTruthy();
  });

  it('服务端错误逐张显示：413 一律「图片不能超过 5 MB」，400 / 429 原样（含等待时间）', async () => {
    await user('seller');
    vi.spyOn(api, 'uploadImage')
      .mockRejectedValueOnce(new ApiError({ code: 413, httpStatus: 413, message: 'Payload Too Large' }))
      .mockRejectedValueOnce(new ApiError({ code: 400, message: '图片已损坏或无法识别' }))
      .mockRejectedValueOnce(new ApiError({ code: 429, message: '请求过于频繁，请稍后再试', retryAfterSeconds: 30 }));
    renderForm();
    await formReady();
    choose(screen.getByLabelText('上传图片'), pngFile('a.png'), pngFile('b.png'), pngFile('c.png'));
    const progress = screen.getByRole('list', { name: '上传进度' });
    expect(await within(progress).findByText('「a.png」上传失败：图片不能超过 5 MB')).toBeTruthy();
    expect(await within(progress).findByText('「b.png」上传失败：图片已损坏或无法识别')).toBeTruthy();
    expect(await within(progress).findByText('「c.png」上传失败：请求过于频繁，请稍后再试（约 30 秒后可重试）')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /商品图片第/ })).toBeNull();
  });

  // REWRITTEN：上限从 5 张改为 9 张（单件、整套、批量一致）；第 10 张示例图点不进去
  it('上移、下移、移除改变提交的顺序；预置示例图与上传图片可以混用；达到上限后文件输入框不可用（REWRITTEN：上限 9）', async () => {
    await user('seller');
    const { onSubmit } = renderForm();
    await formReady();
    fireEvent.click(await screen.findByRole('button', { name: '选择图片 1' }));
    choose(screen.getByLabelText('上传图片'), pngFile('one.png'));
    await screen.findByRole('img', { name: '商品图片第 2 张' });
    fireEvent.click(screen.getByRole('button', { name: '上移第 2 张图片' }));
    expect(await screen.findByText('第 2 张已移到第 1 张')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [first, second] = onSubmit.mock.calls[0][0].images as string[];
    expect(first).toMatch(/^upload:/);
    expect(second).toMatch(/^https:\/\/picsum\.photos\//);
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 张图片' }));
    await waitFor(() => expect(screen.getByText('商品图片（1/9）')).toBeTruthy());
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) fireEvent.click(screen.getByRole('button', { name: `选择图片 ${n}` }));
    expect(screen.getByText('商品图片（9/9）')).toBeTruthy();
    expect((screen.getByLabelText('上传图片') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '选择图片 10' }));
    expect(screen.getByText('商品图片（9/9）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择图片 10' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('上传中显示进度条与播报，完成前不能提交（按钮不可用），完成后才能提交', async () => {
    await user('seller');
    let finish: (v: Awaited<ReturnType<MockCampusMarketApi['uploadImage']>>) => void = () => {};
    vi.spyOn(api, 'uploadImage').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }));
    renderForm();
    await formReady();
    choose(screen.getByLabelText('上传图片'), pngFile('slow.png'));
    await screen.findByText('「slow.png」上传中…');
    expect(screen.getByRole('progressbar', { name: '「slow.png」上传进度' })).toBeTruthy();
    expect(screen.getByText('正在上传 1 张图片').getAttribute('aria-live')).toBe('polite');
    expect((screen.getByRole('button', { name: '立即发布' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ id: 'x', ref: 'upload:00000000-0000-0000-0000-000000000000', url: 'data:image/png;base64,AA==', width: 1, height: 1 }));
    await waitFor(() => expect((screen.getByRole('button', { name: '立即发布' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('发布后商品详情页显示上传的图片（Mock 是 data: 地址；REST 是签名地址）', async () => {
    await user('seller');
    const image = await api.uploadImage(pngFile());
    const product = await api.createProduct(listing('详情页显示上传图片', { images: [image.ref] }));
    renderApp(`/product/${product.id}`);
    const img = await screen.findByRole('img', { name: '详情页显示上传图片' }, { timeout: 5000 });
    expect(img.getAttribute('src')).toBe(image.url);
  });

  it('签名地址是相对路径：按应用使用的 API 基址补全；外部地址、data: 与协议相对地址原样', () => {
    expect(resolveImageSrc('/v1/images/abc?exp=1&sig=s', 'https://api.campus.example')).toBe('https://api.campus.example/v1/images/abc?exp=1&sig=s');
    expect(resolveImageSrc('/v1/images/abc?exp=1&sig=s', '')).toBe('/v1/images/abc?exp=1&sig=s');
    expect(resolveImageSrc('https://picsum.photos/x', 'https://api.campus.example')).toBe('https://picsum.photos/x');
    expect(resolveImageSrc('data:image/png;base64,AA==', 'https://api.campus.example')).toBe('data:image/png;base64,AA==');
    expect(resolveImageSrc('//cdn.example/x.png', 'https://api.campus.example')).toBe('//cdn.example/x.png');
    render(<ImageWithFallback src="/v1/images/abc?exp=1&sig=s" alt="签名图片" />);
    // 测试环境没有配置 VITE_API_BASE_URL（同源部署），相对地址原样交给浏览器
    expect(screen.getByRole('img', { name: '签名图片' }).getAttribute('src')).toBe('/v1/images/abc?exp=1&sig=s');
  });
});

describe('图片上传（整套打包、批量发布共用同一个组件）', () => {
  it('整套打包：同一个上传组件，上传后显示缩略图并计入 1/9，预置图按钮保留原来的名称', async () => {
    await user('seller');
    const submit = vi.fn();
    render(
      <MemoryRouter><NotificationProvider>
        <BundleProductForm initial={{ contact: '13800000000', campus: '东校区', buildingId: null }} onSubmit={submit} />
      </NotificationProvider></MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '整套选择图片 1' })).toBeTruthy();
    choose(screen.getByLabelText('上传图片'), pngFile('bundle.png'));
    expect(await screen.findByRole('img', { name: '商品图片第 1 张（封面）' })).toBeTruthy();
    expect(screen.getByText('商品图片（1/9）')).toBeTruthy();
  });

  // REWRITTEN：与后端新契约一致，草稿响应里是可显示的地址（Mock 为 data:），草稿里保存的仍是 upload:<id>
  it('批量发布的每一件：上传后「保存这件」把 upload:<id> 写进草稿（REWRITTEN：响应返回显示地址）', async () => {
    await user('seller');
    renderApp('/publish/batch');
    fireEvent.click(await screen.findByRole('button', { name: '新建批次' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: '添加单件' }));
    const editor = await screen.findByRole('region', { name: /第 1 件/ });
    choose(within(editor).getByLabelText('上传图片'), pngFile('draft.png'));
    expect(await within(editor).findByRole('img', { name: '商品图片第 1 张（封面）' })).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: '保存这件' }));
    await within(editor).findByText(/已保存/);
    const drafts = await api.listListingDrafts();
    expect(drafts[0].payload.images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
    const stored = JSON.parse(window.localStorage.getItem(DB)!).listingDrafts[0].payload.images;
    expect(stored).toEqual([expect.stringMatching(/^upload:[0-9a-f-]{36}$/)]);
  });
});

describe('内容安全：被拦截时在表单旁原样显示「内容可能包含违规信息，请修改后再提交」', () => {
  it('发布商品：提示出现在表单里（提交按钮旁），商品没有发布，填写的内容保留', async () => {
    await user('seller');
    renderApp('/publish');
    await screen.findByRole('heading', { name: '发布闲置' }, { timeout: 5000 });
    await screen.findByRole('heading', { name: /数码电子验货清单/ });
    type(screen.getByLabelText(/商品标题/), '四六级代考服务');
    type(screen.getByLabelText(/商品描述/), '这里是足够长的商品描述内容。');
    type(screen.getByLabelText(/出售价格/), '30');
    fireEvent.click(screen.getByRole('button', { name: '选择图片 1' }));
    for (const group of screen.getAllByRole('radiogroup')) fireEvent.click(within(group).getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    const alert = await alertWith(CONTENT_BLOCKED_MESSAGE);
    expect(alert.closest('.MuiStack-root')?.contains(screen.getByRole('button', { name: '立即发布' }))).toBe(true);
    expect(lastPath).toBe('/publish');
    expect((screen.getByLabelText(/商品标题/) as HTMLInputElement).value).toBe('四六级代考服务');
    expect((await api.listProducts({ sort: 'latest', page: 1, pageSize: 50 })).items.some((p) => p.title === '四六级代考服务')).toBe(false);
  });

  it('编辑商品：提示出现在编辑弹窗里', async () => {
    await user('seller');
    await api.createProduct(listing('要编辑的商品'));
    renderApp('/profile/listings');
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '编辑商品' });
    const description = await within(dialog).findByLabelText(/商品描述/);
    type(description, '另外可以帮忙办证，价格好商量。');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));
    await alertWith(CONTENT_BLOCKED_MESSAGE, dialog);
  });

  it('留言：提示出现在留言框下方，留言没有发出', async () => {
    await user('seller');
    const product = await api.createProduct(listing('被留言的商品'));
    await user('buyer');
    renderApp(`/product/${product.id}`);
    const box = await screen.findByPlaceholderText('想问点什么？例如：还在吗？能小刀吗？', undefined, { timeout: 5000 });
    type(box, '有没有替考的渠道');
    fireEvent.click(screen.getByRole('button', { name: '留言' }));
    await alertWith(CONTENT_BLOCKED_MESSAGE);
    expect(await api.listComments(product.id)).toEqual([]);
  });

  // REWRITTEN（私信默认只能发送快捷消息）：只有服务端开放文字私信时才有输入框；这里显式打开后检查内容安全的提示
  it('私信（开放文字时）：提示出现在输入框上方，原文保留以便修改', async () => {
    api = new MockCampusMarketApi({ messageFreeTextEnabled: true });
    setApiClient(api);
    await user('seller');
    const product = await api.createProduct(listing('被私信的商品'));
    await user('buyer');
    const conversation = await api.getOrCreateConversation(product.id);
    renderApp(`/messages/${conversation.id}`);
    const box = await screen.findByPlaceholderText('输入消息，回车发送…', undefined, { timeout: 5000 });
    type(box, '顺便问下有没有冰毒');
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await alertWith(CONTENT_BLOCKED_MESSAGE);
    expect((box as HTMLTextAreaElement).value).toBe('顺便问下有没有冰毒');
  });

  it('昵称：提示出现在保存按钮旁，昵称没有被修改', async () => {
    await user('nick');
    renderApp('/profile');
    const nickname = await screen.findByLabelText('昵称', undefined, { timeout: 5000 });
    type(nickname, '赌博高手');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await alertWith(CONTENT_BLOCKED_MESSAGE);
    expect((await api.getCurrentUser())?.nickname).toBe('nick');
  });
});

describe('CONTACT_PARTY 回避原因', () => {
  it('工作人员申请过这件商品的联系方式：案件页显示回避原因「涉及你申请过联系方式的商品」，不显示细节', async () => {
    await user('seller');
    const product = await api.createProduct(listing('工作人员想要的商品'));
    const staffId = await user('staffbuyer');
    await api.requestContact(product.id);
    await user('reporter');
    await api.createModerationReport({ targetType: 'PRODUCT', targetId: product.id, reasonCode: 'MISLEADING' });
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    raw.staffMembers.push({ userId: staffId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() });
    window.localStorage.setItem(DB, JSON.stringify(raw));
    const caseId = raw.moderationCases[0].id;
    api = new MockCampusMarketApi();
    setApiClient(api);
    await as('staffbuyer');
    const { container } = renderApp(`/moderation/cases/${caseId}`);
    expect(await screen.findByRole('heading', { name: '这个案件需要回避' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/涉及你申请过联系方式的商品，你不能查看细节、领取或结案/)).toBeTruthy();
    expect(container.textContent).not.toContain('工作人员想要的商品');
  });
});

describe('移动端底部导航：联系申请未读角标', () => {
  it('卖家有未读的联系申请：「我的」带角标，可访问名称写明未读数', async () => {
    await user('seller');
    const product = await api.createProduct(listing('有人想要的商品'));
    await user('buyer');
    await api.requestContact(product.id);
    await as('seller');
    renderApp('/');
    const mine = await screen.findByRole('button', { name: '我的，联系申请 1 条未读' }, { timeout: 5000 });
    expect(within(mine).getByText('1')).toBeTruthy();
  });
});

describe('文案改写为联系模型（REWRITTEN：不再把订单说成现有功能）', () => {
  it('退出圈子的后果、协助邀请与协助页的说明不再提订单或确认码', async () => {
    expect(LEAVE_CONSEQUENCES.join('')).not.toMatch(/订单/);
    expect(ASSIST_SCOPE_TEXT).toContain('看不到你的联系方式、联系申请或其他草稿');
    expect(ASSIST_SCOPE_TEXT).not.toMatch(/订单|确认码/);
    await user('helper');
    renderApp('/assist');
    expect(await screen.findByText(ASSISTANT_ROLE_TEXT, undefined, { timeout: 5000 })).toBeTruthy();
    expect(ASSISTANT_ROLE_TEXT).not.toMatch(/订单|确认码/);
  });

  it('选择圈子可见：说明成员退出后联系申请与联系方式随之失效，不再提订单', async () => {
    await user('owner');
    const circle = await api.createCircle({ type: 'CLUB', name: '摄影社' });
    const change = vi.fn();
    render(<MemoryRouter><VisibilityPicker visibility="CIRCLE_ONLY" circleIds={[circle.id]} onChange={change} /></MemoryRouter>);
    const who = await screen.findByText(/只有「摄影社」的在籍成员和你自己能看到/);
    expect(who.textContent).toContain('成员退出或被移出后立即看不到，联系申请与已获同意的联系方式也随之失效');
    expect(who.textContent).not.toMatch(/订单/);
  });

  it('已归档的圈子与归档说明不再提订单', async () => {
    await user('owner');
    const circle = await api.createCircle({ type: 'CLUB', name: '要归档的社团' });
    const manage = renderApp(`/circles/${circle.id}/manage`);
    const archive = await screen.findByRole('region', { name: '归档圈子' }, { timeout: 5000 });
    expect(archive.textContent).toContain('归档后不能再发布、订阅或邀请；圈子订阅会停用，未使用的邀请码会作废。归档不能撤销。');
    expect(archive.textContent).not.toMatch(/订单/);
    manage.unmount();
    await api.archiveCircle(circle.id);
    renderApp(`/circles/${circle.id}`);
    const note = await screen.findByText(/这个圈子已归档：不能再发布、订阅或邀请新成员。/, undefined, { timeout: 5000 });
    expect(note.textContent).not.toMatch(/订单/);
  });
});
