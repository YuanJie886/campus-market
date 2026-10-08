import { execFileSync, fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import globalTeardown from './global-teardown';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 真实浏览器 E2E 的一次性本地测试栈（模块 8.1）：
 *   PostgreSQL 16（一次性容器）+ 后端 jar（REST）+ 前端 REST 构建（静态服务器，规则与 nginx 相同）。
 *
 * 约束（与报告一致）：
 *   · 唯一的容器名与标签（campus-market-e2e=<runId>），不复用、不触碰任何已有容器、卷或 Compose 项目；
 *   · 只绑定 127.0.0.1 的临时端口（由系统分配）；
 *   · 一次性凭据：数据库密码与 JWT 密钥每次随机生成，只存在于本进程与子进程的环境变量里，
 *     不写文件、不出现在命令行参数里（docker run 只传变量名 -e NAME）；
 *   · 不读取、不创建 deploy/.env；
 *   · 清理只删除本次创建的那一个容器（连同它的匿名卷），不 prune。
 */

const FRONTEND = resolve(HERE, '../..');
const BACKEND = resolve(FRONTEND, '../campus-market-backend');
export const RUN_DIR = join(FRONTEND, 'e2e/.run');

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = net.createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => ok(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function waitFor(what: string, timeoutMs: number, probe: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`E2E 测试栈：等待 ${what} 超时`);
}

function backendJar(): string {
  const target = join(BACKEND, 'target');
  const jar = existsSync(target) ? readdirSync(target).find((f) => /^campus-market-backend-.*\.jar$/.test(f) && !f.endsWith('-plain.jar')) : undefined;
  if (!jar) throw new Error('找不到后端 jar：请先在 campus-market-backend 运行 ./mvnw -DskipTests package');
  return join(target, jar);
}

export default async function globalSetup() {
  try {
    await start();
  } catch (e) {
    // 启动到一半失败：同样只清理本次创建的对象，然后让运行失败
    await globalTeardown();
    throw e;
  }
}

async function start() {
  if (!existsSync(join(FRONTEND, 'dist/index.html'))) throw new Error('找不到 REST 构建：请先运行 npm run build:rest');
  mkdirSync(RUN_DIR, { recursive: true });
  const runId = `cm-e2e-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const dbUser = 'e2e_user';
  const dbName = 'campus_market_e2e';
  const secrets = { POSTGRES_PASSWORD: randomBytes(24).toString('hex'), JWT_SECRET: randomBytes(48).toString('base64') };

  // 1. 一次性 PostgreSQL：密码只经由环境变量传给 docker CLI
  docker(['run', '-d', '--name', runId, '--label', `campus-market-e2e=${runId}`,
    '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine'],
  { ...process.env, POSTGRES_USER: dbUser, POSTGRES_DB: dbName, POSTGRES_PASSWORD: secrets.POSTGRES_PASSWORD });
  process.env.E2E_RUN_ID = runId;
  process.env.E2E_DB_CONTAINER = runId;
  process.env.E2E_DB_USER = dbUser;
  process.env.E2E_DB_NAME = dbName;
  writeFileSync(join(RUN_DIR, 'state.json'), JSON.stringify({ runId, container: runId }, null, 2));
  // 初始化阶段的临时服务器只监听 unix socket；TCP 可用说明正式服务器已就绪
  await waitFor('PostgreSQL', 90_000, () => {
    docker(['exec', runId, 'pg_isready', '-h', '127.0.0.1', '-U', dbUser, '-d', dbName]);
    return true;
  });
  const dbPort = Number(docker(['port', runId, '5432/tcp']).split('\n')[0].split(':').pop());

  // 2. 后端 jar
  const apiPort = await freePort();
  const webPort = await freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
  const log = openSync(join(RUN_DIR, 'backend.log'), 'w');
  const backend = spawn(java, ['-jar', backendJar()], {
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME: process.env.JAVA_HOME,
      DATABASE_URL: `jdbc:postgresql://127.0.0.1:${dbPort}/${dbName}`, DATABASE_USERNAME: dbUser,
      DATABASE_PASSWORD: secrets.POSTGRES_PASSWORD, JWT_SECRET: secrets.JWT_SECRET,
      WEB_ORIGIN: origin, SECURE_COOKIES: 'false', PORT: String(apiPort), SPRING_FLYWAY_BASELINE_ON_MIGRATE: 'false',
    },
    stdio: ['ignore', log, log],
  });
  writeFileSync(join(RUN_DIR, 'state.json'), JSON.stringify({ runId, container: runId, backendPid: backend.pid }, null, 2));
  await waitFor('后端健康检查', 180_000, async () => {
    if (backend.exitCode !== null) throw new Error('后端进程已退出，见 e2e/.run/backend.log');
    const res = await fetch(`http://127.0.0.1:${apiPort}/v1/health`);
    return res.ok;
  }).catch((e) => { if (backend.exitCode !== null) throw new Error('后端启动失败，见 e2e/.run/backend.log'); throw e });

  // 3. 前端 REST 构建 + 代理（与 nginx 规则一致）
  const web = fork(join(HERE, 'static-server.mjs'), [], {
    env: { E2E_STATIC_ROOT: join(FRONTEND, 'dist'), E2E_WEB_PORT: String(webPort), E2E_API_ORIGIN: `http://127.0.0.1:${apiPort}` },
    stdio: 'ignore',
  });
  await new Promise<void>((ok, fail) => { web.once('message', () => ok()); web.once('exit', () => fail(new Error('静态服务器启动失败'))) });
  writeFileSync(join(RUN_DIR, 'state.json'), JSON.stringify({ runId, container: runId, backendPid: backend.pid, webPid: web.pid }, null, 2));

  process.env.E2E_BASE_URL = origin;
  backend.unref();
  web.unref();
  web.disconnect();
}
