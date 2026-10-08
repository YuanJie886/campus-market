#!/usr/bin/env node
/**
 * 5.7B 确定性构建检查：`npm run build` 的产物只由命令决定。
 *
 * 依次在三种环境下执行 `npm run build`（= build:rest + build:mock + check:bundles）：
 *   1. 删除 VITE_API_MODE；
 *   2. VITE_API_MODE=mock；
 *   3. VITE_API_MODE=rest；
 * 每次记录 dist/ 与 dist-mock/ 全部文件的 SHA-256，三次必须逐字节一致。
 * 本机 .env 无论写的是什么都不参与（显式模式的 envDir 指向不放 .env 的 build-modes/）。
 *
 * 只读源码、只写 dist/ 与 dist-mock/，不联网。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function digest(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(`${relative(dir, path)} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

const variants = [
  ['未设置 VITE_API_MODE', (env) => { delete env.VITE_API_MODE; return env }],
  ['VITE_API_MODE=mock', (env) => ({ ...env, VITE_API_MODE: 'mock' })],
  ['VITE_API_MODE=rest', (env) => ({ ...env, VITE_API_MODE: 'rest' })],
];

const results = [];
for (const [label, makeEnv] of variants) {
  execFileSync('npm', ['run', 'build'], { stdio: ['ignore', 'ignore', 'inherit'], env: makeEnv({ ...process.env }) });
  results.push([label, digest('dist'), digest('dist-mock')]);
  console.log(`已构建：${label}`);
}

const [baseLabel, baseRest, baseMock] = results[0];
let failed = false;
for (const [label, rest, mock] of results.slice(1)) {
  if (rest !== baseRest) { console.error(`✗ REST 产物与「${baseLabel}」不同：${label}`); failed = true }
  if (mock !== baseMock) { console.error(`✗ Mock 产物与「${baseLabel}」不同：${label}`); failed = true }
}
if (failed) process.exit(1);
console.log(`✓ 三种环境下 npm run build 的 dist/（${baseRest.split('\n').length} 个文件）与 dist-mock/（${baseMock.split('\n').length} 个文件）逐字节一致`);
