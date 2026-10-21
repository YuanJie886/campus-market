import { defineConfig } from '@playwright/test';

/**
 * 模块 8.1 真实浏览器 E2E。测试栈（一次性 PostgreSQL 16 + 后端 jar + 前端 REST 构建）由 global-setup 启动、
 * global-teardown 精确清理。先决条件：campus-market-backend 已 package、本目录已 build:rest。
 *
 * 浏览器：默认使用本机已安装的 Google Chrome（channel=chrome，不下载任何浏览器）；
 * CI 里设置 E2E_BROWSER_CHANNEL=chromium 并用 `npx playwright install --with-deps chromium` 安装 Playwright 自带的 Chromium。
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e/specs',
  globalSetup: './e2e/stack/global-setup.ts',
  globalTeardown: './e2e/stack/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [['list'], ['./e2e/redact-reporter.ts']],
  outputDir: 'test-results',
  use: {
    ...(channel === 'chromium' ? {} : { channel }),
    headless: true,
    // 截图与 trace 由 e2e/fixtures.ts 在失败时生成并脱敏；这里关闭内置采集，避免保存未脱敏的网络记录
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
