import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 4.8B：显式的双模式构建。`vite build --mode rest` / `--mode mock`（即 npm run build:rest / build:mock）
 * 时 API 模式只由命令决定：不读取任何 .env 文件（envDir 指向一个不存放 .env 的目录），
 * VITE_API_MODE 在构建期写成字面量，client.ts 的分支因此被常量折叠，另一种实现整体摇掉。
 * 其他 mode（dev、vitest、旧的 npm run build）保持原来的 .env 行为。
 */
const EXPLICIT_API_MODES = ['rest', 'mock'];

// Vite 配置：React 插件 + 本地开发服务
export default defineConfig(({ mode }) => ({
  ...(EXPLICIT_API_MODES.includes(mode)
    ? {
        envDir: 'build-modes',
        define: { 'import.meta.env.VITE_API_MODE': JSON.stringify(mode) },
      }
    : {}),
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    open: false,
    proxy: { '/v1': 'http://localhost:3000', '/docs': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 刻意保持不变：调高阈值只会让告警消失，不会让用户少下载一个字节。
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 把长期不变的第三方库从入口 chunk 里分出去。
        // 业务代码每次发版都会变，而 React / MUI 只在升级依赖时变；
        // 分开后用户在版本迭代间可以继续命中这两个 chunk 的强缓存。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (/[\\/]node_modules[\\/](@mui|@emotion)[\\/]/.test(id)) {
            return 'vendor-mui';
          }
          return undefined;
        },
      },
    },
  },
}));
