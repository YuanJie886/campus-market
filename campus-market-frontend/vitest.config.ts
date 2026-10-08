import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // .tsx 用例需要 DOM：路由懒加载与 ErrorBoundary 只能在真实渲染中验证
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 默认仍是 node，渲染用例在文件头用 `@vitest-environment jsdom` 单独声明，
    // 免得纯逻辑用例都去付 jsdom 的启动开销
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
    // 渲染整页的用例在全量并行时会互相抢 CPU，单个用例偶尔超过默认的 5 秒；
    // 这里只放宽超时，不改变任何断言（单独运行时这些用例都在 1 秒左右完成）
    testTimeout: 20_000,
  },
});
