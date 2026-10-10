import { defineConfig } from '@tarojs/cli';
import path from 'node:path';

export default defineConfig({
  projectName: 'campus-market-miniapp',
  date: '2026-10-09',
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
  sourceRoot: 'src',
  outputRoot: process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist',
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: false },
  copy: { options: {}, patterns: [{ from: path.resolve(__dirname, '../src/assets'), to: path.resolve(__dirname, process.env.TARO_ENV === 'h5' ? '../dist-h5/assets' : '../dist/assets') }] },
  defineConstants: {
    __API_MODE__: JSON.stringify(process.env.MINIAPP_API_MODE === 'rest' ? 'rest' : 'mock'),
    __API_BASE_URL__: JSON.stringify(process.env.MINIAPP_API_BASE_URL ?? 'http://127.0.0.1:3000'),
    __UPLOAD_URL__: JSON.stringify(process.env.MINIAPP_UPLOAD_URL ?? ''),
  },
  mini: {
    postcss: { pxtransform: { enable: true }, url: { enable: true, config: { limit: 1024 } } },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: { mode: 'hash', enhanceAnimation: true },
    devServer: { host: '127.0.0.1', port: 5180 },
    postcss: { pxtransform: { enable: true } },
  },
});
