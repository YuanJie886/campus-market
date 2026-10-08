import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome';
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    workers: 1,
    use: { headless: true, ...(channel === 'chromium' ? {} : { channel }) },
    projects: [
        { name: 'dev', use: { baseURL: 'http://127.0.0.1:5194' } },
        { name: 'production', use: { baseURL: 'http://127.0.0.1:5195' } },
    ],
    webServer: [
        { command: 'npm run dev -- --port 5194', url: 'http://127.0.0.1:5194/admin/', timeout: 30_000 },
        { command: 'npm exec vite -- preview --host 127.0.0.1 --port 5195 --strictPort', url: 'http://127.0.0.1:5195/admin/', timeout: 30_000 },
    ],
});
