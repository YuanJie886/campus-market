import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 精确清理本次 E2E 创建的对象：两个子进程与那一个带本次标签的容器（连同它的匿名卷）。
 * 标签不匹配就拒绝删除；从不 prune，不碰其他容器、卷、网络或镜像。
 */
export default async function globalTeardown() {
  const runDir = resolve(dirname(fileURLToPath(import.meta.url)), '../.run');
  const statePath = join(runDir, 'state.json');
  if (!existsSync(statePath)) return;
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as { runId: string; container: string; backendPid?: number; webPid?: number };
  for (const pid of [state.webPid, state.backendPid]) {
    if (!pid) continue;
    try { process.kill(pid, 'SIGTERM') } catch { /* 已退出 */ }
  }
  let label = '';
  try {
    label = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "campus-market-e2e"}}', state.container], { encoding: 'utf8' }).trim();
  } catch { /* 容器不存在 */ }
  if (label && label === state.runId) {
    execFileSync('docker', ['rm', '-f', '-v', state.container], { stdio: 'ignore' });
  } else if (label) {
    throw new Error(`拒绝删除容器 ${state.container}：标签与本次运行不一致`);
  }
  rmSync(statePath, { force: true });
}
