// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import ImageUploader from './components/ImageUploader';
import ImageWithFallback from './components/ImageWithFallback';
import { CATEGORY_COVER } from './utils/constants';
import { IMAGE_PRESETS, isLegacyDemoImage } from './utils/externalDemoImages';
import { CATEGORIES } from './types';
import { DEMO_ACCOUNT, DEMO_PASSWORD } from './data/demoAccount';

/**
 * 网页端不向第三方主机请求（隐私政策：预设头像显示时不向任何第三方请求）：
 * - 分类封面在本地绘制（内联 SVG），不再指向演示图床；
 * - 发布页的外部示例图只在 GET /v1/config 返回 externalAllowed=true 时出现；
 * - 演示图床的主机名只允许出现在 src/utils/externalDemoImages.ts（源码守卫，补充上面的行为用例；构建产物另由 scripts/check-bundles.mjs 检查）。
 */
const hostsIn = (text: string) => [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setApiClient(new MockCampusMarketApi());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authTokenStore.clearAccessToken() });

describe('分类封面：本地绘制', () => {
  it('每个分类的封面都是内联 SVG（data:image/svg+xml），里面只有 SVG 命名空间，没有任何可请求的外部地址', () => {
    expect(Object.keys(CATEGORY_COVER).sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES) {
      const cover = CATEGORY_COVER[category];
      expect(cover.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
      const svg = decodeURIComponent(cover.slice(cover.indexOf(',') + 1));
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(hostsIn(svg)).toEqual(['www.w3.org']);
      expect(svg).not.toMatch(/<image|href=|url\((?!#)/);
      expect(svg).not.toMatch(/picsum/i);
    }
  });

  it('渲染分类封面：<img> 的地址是本地 data: SVG，不是演示图床', () => {
    render(<>{CATEGORIES.map((c) => <ImageWithFallback key={c} src={CATEGORY_COVER[c]} alt={`${c}封面`} />)}</>);
    for (const c of CATEGORIES) {
      const src = screen.getByRole('img', { name: `${c}封面` }).getAttribute('src')!;
      expect(src.startsWith('data:image/svg+xml')).toBe(true);
      expect(isLegacyDemoImage(src)).toBe(false);
    }
  });

  it('首页（登录后，含分类导航与商品列表）整页没有任何指向演示图床的地址', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.login({ account: DEMO_ACCOUNT, password: DEMO_PASSWORD });
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
      </MemoryRouter>,
    );
    // 等商品卡片的图片真正渲染出来，再检查整页
    await waitFor(() => expect(container.querySelectorAll('main img').length).toBeGreaterThan(3), { timeout: 5000 });
    expect(container.innerHTML).not.toMatch(/picsum/i);
  });
});

describe('外部示例图只在 externalAllowed=true 时出现（REST）', () => {
  function rest(externalAllowed: boolean | 'error') {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/v1/config' && externalAllowed === 'error') return new Response(JSON.stringify({ code: 500, data: null, message: '服务异常' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      const data = String(input) === '/v1/config' ? { images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed } } : null;
      return new Response(JSON.stringify({ code: 0, data, message: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    authTokenStore.setAccessToken('test-access-token', new Date(Date.now() + 900_000).toISOString());
    setApiClient(new RestCampusMarketApi(new HttpTransport({ fetchImpl })));
  }
  const renderUploader = () => render(<ImageUploader value={[]} onChange={() => {}} label="商品图片" inputId="img" presets={IMAGE_PRESETS} />);

  it.each([[false, 'externalAllowed=false'], ['error' as const, '配置拿不到（500）']])('%s（%s）：没有示例图，DOM 里没有演示图床地址', async (mode: boolean | 'error', _label: string) => {
    rest(mode);
    const { container } = renderUploader();
    await screen.findByText(/支持 JPEG 或 PNG/);
    await waitFor(() => expect(screen.getByLabelText('上传图片')).toBeTruthy());
    // 等配置请求结束（加载中本来也不显示示例图）
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: '选择图片 1' })).toBeNull();
    expect(container.innerHTML).not.toMatch(/picsum/i);
  });

  it('对照组 externalAllowed=true：示例图出现（检查不是空转）', async () => {
    rest(true);
    renderUploader();
    expect(await screen.findByRole('button', { name: '选择图片 1' })).toBeTruthy();
  });
});

describe('演示图床识别', () => {
  it('只认演示图床及其子域名的 http(s) 地址；其他主机、相对地址、data: 都不是', () => {
    for (const url of ['https://picsum.photos/seed/a/200/200', 'http://picsum.photos/x', 'https://i.picsum.photos/id/1/2/3.jpg', 'HTTPS://PICSUM.PHOTOS/a', ...IMAGE_PRESETS]) {
      expect(isLegacyDemoImage(url), url).toBe(true);
    }
    for (const url of ['https://notpicsum.photos/a', 'https://picsum.photos.evil.example/a', '/v1/images/x', 'data:image/png;base64,AA==', 'preset:1', '', null, undefined, 'https://example.invalid/picsum.photos/a']) {
      expect(isLegacyDemoImage(url), String(url)).toBe(false);
    }
  });
});

describe('源码守卫（补充）', () => {
  const sources = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const app = Object.entries(sources).filter(([path]) => !path.includes('.test.') && !path.endsWith('test-axe.ts') && !path.startsWith('./test/'));

  it('演示图床的主机名只出现在 utils/externalDemoImages.ts；unsplash 只出现在离线演示种子里', () => {
    expect(app.length).toBeGreaterThan(50);
    expect(app.filter(([, text]) => /picsum/i.test(text)).map(([p]) => p)).toEqual(['./utils/externalDemoImages.ts']);
    expect(app.filter(([, text]) => /unsplash/i.test(text)).map(([p]) => p)).toEqual(['./data/seed.ts']);
  });

  it('没有页面再直接用 MUI 的 Avatar：头像都经过 components/Avatar.tsx', () => {
    expect(app.filter(([, text]) => /@mui\/material\/Avatar|\bAvatar\b[^\n]*from ['"]@mui\/material['"]/.test(text)).map(([p]) => p)).toEqual([]);
    const users = app.filter(([, text]) => /import Avatar from ['"][./]+(components\/)?Avatar['"]/.test(text)).map(([p]) => p).sort();
    expect(users).toEqual(['./components/Navbar.tsx', './pages/MessagesPage.tsx', './pages/ProductDetailPage.tsx', './pages/profile/ProfileInfoPage.tsx', './pages/profile/ProfileLayout.tsx']);
  });
});
