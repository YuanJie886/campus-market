#!/usr/bin/env node
/**
 * 4.8B 构建产物检查：在 `npm run build:rest` 与 `npm run build:mock` 之后运行（npm run build:all 会依次执行）。
 *
 * - REST 产物（dist/）里不能出现离线 Mock：Mock 的存储键、演示种子、Mock 专用的打包验货模板标识。
 * - Mock 产物（dist-mock/）里不能出现真实 REST 传输层：认证刷新、批量发布、价格参考等 REST 路径。
 * - 每个标记都必须在另一份产物里出现，证明检查不是空转（例如标记拼错了永远找不到）。
 * - 入口 chunk 不超过 chunkSizeWarningLimit（1500 kB，未调高）。
 *
 * 只读文件，不联网、不读 .env。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REST_DIR = 'dist';
const MOCK_DIR = 'dist-mock';
const ENTRY_LIMIT_KB = 1500;

/** REST 产物里不得出现的离线 Mock 标记 */
const MOCK_ONLY = ['mock_database_v1', 'demo-calculus-8', 'tpl-bundle-v1', 'demo-staff-switch'];
/** Mock 产物里不得出现的 REST 传输层标记 */
const REST_ONLY = ['/v1/auth/refresh', '/v1/listing-batches', '/v1/price-guidance', '/v1/listing-assist-invites'];

function bundle(dir) {
  const assets = join(dir, 'assets');
  if (!existsSync(assets)) {
    console.error(`缺少 ${assets}：请先运行 npm run build:rest 与 npm run build:mock`);
    process.exit(2);
  }
  const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
  return files.map((f) => ({ name: f, text: readFileSync(join(assets, f), 'utf8'), size: statSync(join(assets, f)).size }));
}

const rest = bundle(REST_DIR);
const mock = bundle(MOCK_DIR);
const failures = [];
const contains = (files, marker) => files.filter((f) => f.text.includes(marker)).map((f) => f.name);

for (const marker of MOCK_ONLY) {
  const leaked = contains(rest, marker);
  if (leaked.length) failures.push(`REST 产物包含离线 Mock 标记「${marker}」：${leaked.join(', ')}`);
  if (!contains(mock, marker).length) failures.push(`Mock 产物里找不到「${marker}」，检查标记已失效`);
}
for (const marker of REST_ONLY) {
  const leaked = contains(mock, marker);
  if (leaked.length) failures.push(`Mock 产物包含 REST 传输层标记「${marker}」：${leaked.join(', ')}`);
  if (!contains(rest, marker).length) failures.push(`REST 产物里找不到「${marker}」，检查标记已失效`);
}
for (const [label, files] of [['REST', rest], ['Mock', mock]]) {
  const entry = files.find((f) => /^index-[\w-]+\.js$/.test(f.name));
  if (!entry) { failures.push(`${label} 产物没有入口 chunk`); continue; }
  const kb = entry.size / 1024;
  console.log(`${label} 入口 chunk ${entry.name}: ${kb.toFixed(2)} kB（未压缩）`);
  if (kb > ENTRY_LIMIT_KB) failures.push(`${label} 入口 chunk 超过 ${ENTRY_LIMIT_KB} kB`);
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log(`✓ REST 产物不含离线 Mock（${MOCK_ONLY.length} 个标记），Mock 产物不含 REST 传输层（${REST_ONLY.length} 个标记）`);
