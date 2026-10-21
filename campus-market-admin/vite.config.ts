/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    base: '/admin/',
    plugins: [react()],
    resolve: {
        alias: [
            { find: '@campus/query-string-upstream', replacement: fileURLToPath(new URL('./node_modules/query-string/index.js', import.meta.url)) },
            { find: /^query-string$/, replacement: fileURLToPath(new URL('./src/queryStringCompat.ts', import.meta.url)) },
        ],
    },
    // 单元测试在 Node 里渲染 react-admin 页面：内联这些包，让它们也使用上面的 query-string 兼容别名。
    test: { server: { deps: { inline: ['react-admin', 'ra-core', 'ra-ui-materialui'] } } },
});
