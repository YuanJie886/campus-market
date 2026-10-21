import type { Request } from '@playwright/test';
import { apiOk, expect, open, test } from '../fixtures';
import { solidPng } from '../png';

/**
 * 头像（与小程序一致：12 个本地绘制的预设头像 + 上传图片）：
 *   #A1 在个人资料里选「预设头像 N」并保存 → 导航栏立即显示这个预设（本地绘制）；整个过程没有任何请求发往测试栈以外的主机；
 *   #A2 上传一张 PNG（浏览器里生成的内存缓冲区）并保存 → 导航栏的头像是同源的短时签名地址 /v1/images/…，图片真正加载出来。
 */

const PRESET = 7;

function thirdPartyRecorder(baseURL: string) {
  const origin = new URL(baseURL).origin;
  const offenders: string[] = [];
  const listener = (req: Request) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) offenders.push(url);
  };
  return { offenders, listener };
}

test('#A1 选择预设头像 → 导航栏显示该预设；没有任何第三方请求', async ({ party }) => {
  const me = await party('预设头像');
  const { offenders, listener } = thirdPartyRecorder(process.env.E2E_BASE_URL!);
  me.page.on('request', listener);
  await open(me, '/profile');
  const navAvatar = me.page.getByRole('button', { name: '用户菜单' }).locator('[data-avatar-kind]');
  // 还没有头像：由用户 id 决定的本地预设，不是图片
  await expect(navAvatar).toHaveAttribute('data-avatar-kind', 'preset');
  // 单选框是视觉隐藏的（sr-only），用户点的是它外面的头像标签
  const radio = me.page.getByRole('radio', { name: `预设头像 ${PRESET}`, exact: true });
  await me.page.locator('label').filter({ has: radio }).click();
  await expect(radio).toBeChecked();
  await me.page.getByRole('button', { name: '保存修改' }).click();
  await expect(me.page.getByText('资料已更新')).toBeVisible();
  await expect(navAvatar).toHaveAttribute('data-avatar-preset', String(PRESET));
  await expect(navAvatar).toHaveAttribute('data-avatar-kind', 'preset');
  expect((await apiOk(me, 'GET', '/v1/auth/me')).avatar).toBe(`preset:${PRESET}`);
  // 刷新后仍然是这个预设（来自服务端，不是本地缓存）
  await open(me, '/');
  await expect(me.page.getByRole('button', { name: '用户菜单' }).locator('[data-avatar-kind]')).toHaveAttribute('data-avatar-preset', String(PRESET));
  await expect(me.page.getByRole('button', { name: '用户菜单' }).locator('img')).toHaveCount(0);
  expect(offenders).toEqual([]);
});

test('#A2 上传 PNG 头像 → 导航栏显示同源签名地址 /v1/images/… 并真正加载出来', async ({ party }) => {
  const me = await party('上传头像');
  const { offenders, listener } = thirdPartyRecorder(process.env.E2E_BASE_URL!);
  me.page.on('request', listener);
  await open(me, '/profile');
  await me.page.getByLabel('上传头像', { exact: true }).setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(solidPng(32, [40, 120, 200])) });
  await expect(me.page.getByText('头像已上传，保存修改后生效')).toBeVisible();
  await me.page.getByRole('button', { name: '保存修改' }).click();
  await expect(me.page.getByText('资料已更新')).toBeVisible();
  const img = me.page.getByRole('button', { name: '用户菜单' }).locator('img[data-avatar-kind="image"]');
  await expect(img).toHaveAttribute('src', /^\/v1\/images\/[0-9a-f-]{36}\?.*sig=/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(32);
  const stored = (await apiOk(me, 'GET', '/v1/auth/me')).avatar as string;
  expect(stored).toMatch(/^\/v1\/images\/[0-9a-f-]{36}\?/);
  expect(offenders).toEqual([]);
});
