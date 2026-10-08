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
});
