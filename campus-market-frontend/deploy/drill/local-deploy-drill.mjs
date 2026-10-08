#!/usr/bin/env node
// 模块 8.2 本地部署与恢复演练。用生产编排 docker-compose.yml + 演练覆盖文件，在唯一的 Compose 项目里：
//   构建镜像 → 启动 → 逐项检查（启动顺序、Flyway、健康检查、SPA 深链接、/v1 代理、Cookie 策略、端口、缺密钥、重启保留数据）
//   → 备份并恢复到一个新的一次性数据库 → 精确清理本次创建的对象。
//
// 约束：唯一项目名；只绑定 127.0.0.1；一次性随机凭据只经环境变量传给 docker-compose，不写文件、不打印；
//       用空的 --env-file 取代 deploy/.env（既不读取也不创建它）；不 prune；只删除本次创建的容器 / 卷 / 网络 / 镜像。
//
// 用法（在 campus-market-frontend 目录）：node deploy/drill/local-deploy-drill.mjs <报告输出目录>
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = resolve(HERE, '..');
const OUT = resolve(process.argv[2] ?? join(tmpdir(), 'cm-drill'));
mkdirSync(OUT, { recursive: true });
const COMPOSE = process.env.COMPOSE_BIN ?? 'docker-compose';
const PROJECT = `cmdrill-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
const RESTORE = `${PROJECT}-restore`;
const EMPTY_ENV = join(mkdtempSync(join(tmpdir(), 'cm-drill-env-')), 'empty.env');
writeFileSync(EMPTY_ENV, '');
const secrets = { POSTGRES_PASSWORD: randomBytes(24).toString('hex'), JWT_SECRET: randomBytes(48).toString('base64'), RESTORE_PASSWORD: randomBytes(24).toString('hex') };
const results = [];
const record = (name, pass, evidence) => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence ? ` — ${evidence}` : ''}`);
};

function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) });
}
const WEB_PORT = await freePort();
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const baseEnv = (extra = {}) => ({
  ...process.env, POSTGRES_PASSWORD: secrets.POSTGRES_PASSWORD, JWT_SECRET: secrets.JWT_SECRET, SECURE_COOKIES: 'false',
  WEB_ORIGIN: ORIGIN, DRILL_WEB_PORT: String(WEB_PORT), ...extra,
});
function compose(args, env = baseEnv(), opts = {}) {
  const r = spawnSync(COMPOSE, ['-p', PROJECT, '--env-file', EMPTY_ENV, '-f', join(DEPLOY, 'docker-compose.yml'), '-f', join(HERE, 'docker-compose.drill.yml'), ...args],
    { cwd: DEPLOY, env, encoding: opts.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30, timeout: opts.timeout ?? 1_800_000 });
  return r;
}
function mustCompose(args, env, opts) {
  const r = compose(args, env, opts);
  if (r.status !== 0) throw new Error(`docker-compose ${args.join(' ')} 失败：${String(r.stderr).slice(-2000)}`);
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, ms, probe) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await probe()) return true } catch { /* retry */ } await sleep(1000) }
  throw new Error(`等待 ${what} 超时`);
}
const psql = (sql) => mustCompose(['exec', '-T', 'postgres', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'campus', '-d', 'campus_market', '-c', sql]).stdout.trim();
const psqlRestore = (sql) => execFileSync('docker', ['exec', RESTORE, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'restore_check', '-c', sql], { encoding: 'utf8' }).trim();
async function api(method, path, body, token, headers = {}) {
  const res = await fetch(`${ORIGIN}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function register(label) {
  const r = await api('POST', '/v1/auth/register', { account: `d${randomBytes(6).toString('hex')}`, password: `pw-${randomBytes(9).toString('base64url')}`, nickname: label, campus: '东校区', contact: '13800000000' });
  if (r.status !== 200) throw new Error(`注册失败 ${r.status}`);
  return { id: r.json.data.user.id, token: r.json.data.accessToken, cookie: r.headers.get('set-cookie') ?? '' };
}

const imagesBefore = new Set(execFileSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).split('\n').filter(Boolean));
let sentinel = {};
try {
  // ---------------------------------------------------------------- 0. 缺密钥：编排与应用都拒绝启动
  const noJwt = compose(['config', '--quiet'], baseEnv({ JWT_SECRET: '' }));
  record('缺少 JWT_SECRET：docker-compose 拒绝渲染配置', noJwt.status !== 0 && /JWT_SECRET/.test(noJwt.stderr), `exit=${noJwt.status}`);
  const noCookie = compose(['config', '--quiet'], baseEnv({ SECURE_COOKIES: '' }));
  record('缺少 SECURE_COOKIES：docker-compose 拒绝渲染配置', noCookie.status !== 0 && /SECURE_COOKIES/.test(noCookie.stderr), `exit=${noCookie.status}`);
  const noDbPw = compose(['config', '--quiet'], baseEnv({ POSTGRES_PASSWORD: '' }));
  record('缺少 POSTGRES_PASSWORD：docker-compose 拒绝渲染配置', noDbPw.status !== 0, `exit=${noDbPw.status}`);
  const prod = spawnSync(COMPOSE, ['-p', PROJECT, '--env-file', EMPTY_ENV, '-f', join(DEPLOY, 'docker-compose.yml'), 'config', '--format', 'json'], { cwd: DEPLOY, env: baseEnv(), encoding: 'utf8' });
  const prodCfg = JSON.parse(prod.stdout);
  const pgPorts = prodCfg.services.postgres.ports ?? [];
  const webPorts = prodCfg.services.web.ports ?? [];
  record('生产编排：PostgreSQL 与 Web 端口只绑定 127.0.0.1（不对公网发布）',
    pgPorts.every((p) => p.host_ip === '127.0.0.1') && webPorts.every((p) => p.host_ip === '127.0.0.1'),
    `postgres=${pgPorts.map((p) => `${p.host_ip}:${p.published}`).join(',')} web=${webPorts.map((p) => `${p.host_ip}:${p.published}`).join(',')}`);

  // ---------------------------------------------------------------- 1. 构建与启动
  const t0 = Date.now();
  mustCompose(['build'], baseEnv(), { timeout: 3_600_000 });
  record('构建 api / web 镜像（web 使用 build:rest）', true, `${Math.round((Date.now() - t0) / 1000)}s`);
  mustCompose(['up', '-d']);
  await waitFor('API 经 Web 代理可用', 240_000, async () => (await api('GET', '/v1/health')).status === 200);

  // ---------------------------------------------------------------- 2. 启动顺序与 Flyway
  const ids = Object.fromEntries(['postgres', 'api', 'web'].map((s) => [s, mustCompose(['ps', '-q', s]).stdout.trim()]));
  const inspect = (id) => JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }))[0];
  const pg = inspect(ids.postgres);
  const apiC = inspect(ids.api);
  const healthyAt = (pg.State.Health?.Log ?? []).filter((l) => l.ExitCode === 0).map((l) => Date.parse(l.End)).sort((a, b) => a - b)[0];
  const apiStarted = Date.parse(apiC.State.StartedAt);
  record('数据库就绪（健康检查首次通过）之后 API 才启动', healthyAt !== undefined && apiStarted >= healthyAt - 1000,
    `pg healthy ${new Date(healthyAt).toISOString()} · api started ${apiC.State.StartedAt}`);
  const logs = mustCompose(['logs', '--no-color', 'api']).stdout;
  const flywayAt = logs.indexOf('Successfully applied');
  const tomcatAt = logs.indexOf('Tomcat started');
  const flywayLine = logs.split('\n').find((l) => l.includes('Successfully applied')) ?? '';
  record('Flyway 迁移成功之后 Web 服务才开始接受请求', flywayAt >= 0 && tomcatAt > flywayAt, flywayLine.replace(/^.*Successfully/, 'Successfully').trim());
  const history = psql("SELECT count(*) || ':' || max(version::int) || ':' || bool_and(success) FROM flyway_schema_history WHERE version IS NOT NULL");
  record('flyway_schema_history：V1～V11 全部成功', /^11:11:(t|true)$/.test(history), history);

  // ---------------------------------------------------------------- 3. 健康检查、SPA、/v1 代理
  const health = await api('GET', '/v1/health');
  const leaked = /jdbc|password|secret|postgres|campus_market|version|java|spring/i.test(health.text);
  record('API 健康检查只返回状态，不泄露配置', health.status === 200 && JSON.stringify(health.json?.data) === '{"status":"ok"}' && !leaked, health.text.replace(/"requestId":"[^"]+"/, '"requestId":"…"'));
  for (const path of ['/profile/orders', `/product/${crypto.randomUUID()}`, '/circles/join']) {
    const r = await api('GET', path);
    record(`SPA 深链接刷新 ${path.replace(/[0-9a-f-]{36}/, '<id>')} → index.html`, r.status === 200 && /<div id="root">/.test(r.text) && (r.headers.get('content-type') ?? '').includes('text/html'), `status=${r.status}`);
  }
  const notFound = await api('GET', '/v1/no-such-endpoint');
  record('/v1 由 nginx 代理到 API（未知路径得到 API 的 JSON 404，而不是 SPA 页面或 500）', notFound.status === 404 && notFound.json?.code === 404, `status=${notFound.status}`);
  const wrongMethod = await api('DELETE', '/v1/health');
  record('框架层请求错误保留状态码（错误方法 405，不是 500）', wrongMethod.status === 405, `status=${wrongMethod.status}`);

  // ---------------------------------------------------------------- 4. Cookie 策略
  const u = await register('drill-cookie');
  record('本地 http（SECURE_COOKIES=false）：刷新 Cookie HttpOnly + SameSite=Strict + Path=/v1/auth，且不带 Secure',
    /cm_refresh=/.test(u.cookie) && /HttpOnly/i.test(u.cookie) && /SameSite=Strict/i.test(u.cookie) && /Path=\/v1\/auth/i.test(u.cookie) && !/;\s*Secure/i.test(u.cookie),
    u.cookie.replace(/cm_refresh=[^;]+/, 'cm_refresh=[REDACTED]'));
  const refreshBad = await api('POST', '/v1/auth/refresh', undefined, undefined, { Cookie: u.cookie.split(';')[0], Origin: 'http://evil.example' });
  record('刷新接口拒绝其他来源（Origin 不等于 WEB_ORIGIN）', refreshBad.status === 403, `status=${refreshBad.status}`);

  mustCompose(['up', '-d', '--no-deps', 'api'], baseEnv({ SECURE_COOKIES: 'true', WEB_ORIGIN: 'https://drill.example.test' }));
  await waitFor('API（Secure 配置）', 180_000, async () => (await api('GET', '/v1/health')).status === 200);
  const secure = await register('drill-secure');
  record('HTTPS 配置（SECURE_COOKIES=true）：刷新 Cookie 带 Secure', /;\s*Secure/i.test(secure.cookie) && /HttpOnly/i.test(secure.cookie), secure.cookie.replace(/cm_refresh=[^;]+/, 'cm_refresh=[REDACTED]'));

  mustCompose(['up', '-d', '--no-deps', 'api'], baseEnv({ SECURE_COOKIES: 'false', WEB_ORIGIN: 'https://drill.example.test' }));
  await waitFor('矛盾配置下 API 退出', 120_000, () => inspect(mustCompose(['ps', '-a', '-q', 'api']).stdout.trim()).State.Status === 'exited'
    || inspect(mustCompose(['ps', '-a', '-q', 'api']).stdout.trim()).State.Restarting);
  const badLogs = mustCompose(['logs', '--no-color', '--tail', '200', 'api']).stdout;
  record('HTTPS 的 WEB_ORIGIN + SECURE_COOKIES=false：API 拒绝启动', /SECURE_COOKIES=false 与 HTTPS 的 WEB_ORIGIN 不兼容/.test(badLogs), '日志含拒绝原因');

  // 应用层缺 JWT_SECRET：直接用本次构建的 api 镜像、连同一个数据库，不给 JWT_SECRET
  // api 容器在上面被重建过：重新取当前的容器 id
  const apiImage = inspect(mustCompose(['ps', '-a', '-q', 'api']).stdout.trim()).Config.Image;
  const network = Object.keys(inspect(ids.postgres).NetworkSettings.Networks)[0];
  const noSecret = spawnSync('docker', ['run', '--rm', '--network', network, '--label', `campus-market-drill=${PROJECT}`,
    '-e', 'DATABASE_URL=jdbc:postgresql://postgres:5432/campus_market', '-e', 'DATABASE_USERNAME=campus', '-e', 'DATABASE_PASSWORD',
    '-e', 'SECURE_COOKIES=false', '-e', 'WEB_ORIGIN=http://127.0.0.1', apiImage], { env: { ...process.env, DATABASE_PASSWORD: secrets.POSTGRES_PASSWORD }, encoding: 'utf8', timeout: 180_000 });
  record('应用层：没有 JWT_SECRET 时 API 进程启动失败（不回落到任何默认密钥）', noSecret.status !== 0 && /JWT_SECRET|jwt-secret/i.test(noSecret.stdout + noSecret.stderr), `exit=${noSecret.status}`);

  mustCompose(['up', '-d', '--no-deps', 'api']);
  await waitFor('API 恢复正常配置', 180_000, async () => (await api('GET', '/v1/health')).status === 200);

  // ---------------------------------------------------------------- 5. 端口
  const pgPublished = Object.values(inspect(ids.postgres).NetworkSettings.Ports ?? {}).flat().filter(Boolean);
  const webPublished = Object.values(inspect(mustCompose(['ps', '-q', 'web']).stdout.trim()).NetworkSettings.Ports ?? {}).flat().filter(Boolean);
  record('演练栈：PostgreSQL 没有发布任何主机端口；Web 只绑定 127.0.0.1', pgPublished.length === 0 && webPublished.every((p) => p.HostIp === '127.0.0.1'),
    `postgres=${pgPublished.length} web=${webPublished.map((p) => `${p.HostIp}:${p.HostPort}`).join(',')}`);

  // ---------------------------------------------------------------- 6. 哨兵数据
  const seller = await register('drill-seller');
  const buyer = await register('drill-buyer');
  const product = await api('POST', '/v1/products', { title: `演练哨兵商品 ${PROJECT}`, description: '备份恢复哨兵', price: 42, category: '其他', condition: '几乎全新',
    campus: '东校区', images: ['https://example.invalid/a.png'], contact: '13800000000' }, seller.token);
  const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0);
  const order = await api('POST', '/v1/orders', { productId: product.json.data.id, meetingPointId: '东校区-library', meetingAtIso: at.toISOString(), contact: '1',
    idempotencyKey: crypto.randomUUID() }, buyer.token, { 'Idempotency-Key': crypto.randomUUID() });
  await api('POST', `/v1/orders/${order.json.data.id}/transitions`, { to: 'PENDING_MEETING' }, seller.token);
  const circle = await api('POST', '/v1/circles', { type: 'CLUB', name: `演练圈${Date.now().toString(36).slice(-4)}`, description: '哨兵', visibility: 'PRIVATE' }, seller.token);
  const staff = await register('drill-staff');
  psql(`INSERT INTO staff_members(user_id, school_id, role) VALUES ('${staff.id}', 'pilot', 'SENIOR_MODERATOR')`);
  await api('POST', '/v1/moderation-reports', { targetType: 'USER', targetId: seller.id, reasonCode: 'SPAM' }, buyer.token);
  const caseId = psql(`SELECT id FROM moderation_cases WHERE target_id = '${seller.id}'`);
  const decided = await api('POST', `/v1/moderation/cases/${caseId}/decision`, { action: 'RESTRICT_PUBLISHING', reasonCode: 'POLICY_VIOLATION', durationHours: 24 }, staff.token);
  sentinel = { product: product.json.data.id, order: order.json.data.id, circle: circle.json.data.id, case: caseId, seller: seller.id };
  const ok = [product, order, circle, decided].every((r) => r.status === 200);
  record('写入哨兵：商品、订单（已接单，含档期快照）、圈子、治理记录（举报 / 案件 / 动作 / 限制）', ok, `status=${[product, order, circle, decided].map((r) => r.status).join(',')}`);
  const sentinelSql = `SELECT concat_ws('|',
    (SELECT count(*) FROM products WHERE id = '${sentinel.product}'),
    (SELECT status FROM orders WHERE id = '${sentinel.order}'),
    (SELECT count(*) FROM order_slot_agreements WHERE order_id = '${sentinel.order}'),
    (SELECT count(*) FROM circles WHERE id = '${sentinel.circle}'),
    (SELECT status FROM moderation_cases WHERE id = '${sentinel.case}'),
    (SELECT count(*) FROM moderation_reports WHERE case_id = '${sentinel.case}'),
    (SELECT count(*) FROM moderation_actions WHERE case_id = '${sentinel.case}'),
    (SELECT count(*) FROM user_restrictions WHERE user_id = '${sentinel.seller}'))`;
  const before = psql(sentinelSql);

  // ---------------------------------------------------------------- 7. 重启保留数据（删除并重建容器，保留命名卷）
  mustCompose(['down']);
  mustCompose(['up', '-d']);
  await waitFor('重启后 API', 240_000, async () => (await api('GET', '/v1/health')).status === 200);
  const after = psql(sentinelSql);
  const viaApi = await api('GET', `/v1/products/${sentinel.product}`, undefined, buyer.token);
  record('down（不带 -v）+ up：容器重建后哨兵数据与登录后读取都保留', after === before && viaApi.status === 200, `${before} → ${after}`);

  // ---------------------------------------------------------------- 8. 备份与恢复到新的一次性数据库
  const dumpPath = join(OUT, 'drill-backup.dump');
  const dump = mustCompose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'campus', '-d', 'campus_market', '-Fc'], baseEnv(), { binary: true });
  writeFileSync(dumpPath, dump.stdout);
  record('pg_dump（自定义格式）备份', statSync(dumpPath).size > 10_000, `${statSync(dumpPath).size} bytes`);
  execFileSync('docker', ['run', '-d', '--name', RESTORE, '--label', `campus-market-drill=${PROJECT}`, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=restore_check', 'postgres:16-alpine'],
    { env: { ...process.env, POSTGRES_PASSWORD: secrets.RESTORE_PASSWORD }, stdio: 'ignore' });
  await waitFor('恢复用数据库', 90_000, () => { execFileSync('docker', ['exec', RESTORE, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'restore_check'], { stdio: 'ignore' }); return true });
  const restore = spawnSync('docker', ['exec', '-i', RESTORE, 'pg_restore', '-U', 'postgres', '-d', 'restore_check', '--no-owner', '--no-privileges', '--exit-on-error'],
    { input: dump.stdout, encoding: 'utf8', maxBuffer: 1 << 30 });
  record('pg_restore 到新的临时数据库（不对既有数据库执行 restore）', restore.status === 0, restore.status === 0 ? '无错误' : restore.stderr.slice(-500));
  const restored = psqlRestore(sentinelSql);
  record('恢复后哨兵数据一致', restored === after, `${after} ⇔ ${restored}`);
  const hist = "SELECT string_agg(version || ':' || checksum || ':' || success, ',' ORDER BY installed_rank) FROM flyway_schema_history";
  const srcHist = psql(hist);
  const dstHist = psqlRestore(hist);
  record('恢复后 Flyway 历史（版本 / checksum / 成功标记）与源库完全一致', srcHist === dstHist && srcHist.split(',').length === 11, `${srcHist.split(',').length} 条`);
  const guard = spawnSync('docker', ['exec', RESTORE, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'restore_check', '-c', `DELETE FROM moderation_actions WHERE case_id = '${sentinel.case}'`], { encoding: 'utf8' });
  record('恢复后数据库约束与触发器仍然生效（治理动作只增不改）', guard.status !== 0 && /append-only/.test(guard.stderr), 'DELETE 被拒绝');
} catch (e) {
  record('演练异常中止', false, String(e.message ?? e).slice(0, 500));
} finally {
  // ---------------------------------------------------------------- 9. 精确清理
  spawnSync('docker', ['rm', '-f', '-v', RESTORE], { stdio: 'ignore' });
  const down = compose(['down', '-v', '--rmi', 'local', '--remove-orphans']);
  const left = execFileSync('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '-q'], { encoding: 'utf8' }).trim();
  const leftVolumes = execFileSync('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`], { encoding: 'utf8' }).trim();
  const leftDrill = execFileSync('docker', ['ps', '-a', '--filter', `label=campus-market-drill=${PROJECT}`, '-q'], { encoding: 'utf8' }).trim();
  // 本次拉取的基础镜像（运行前不存在）一并删除；运行前就有的镜像一律不动
  const imagesAfter = execFileSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const pulled = imagesAfter.filter((i) => !imagesBefore.has(i) && !i.startsWith('<none>'));
  for (const image of pulled) spawnSync('docker', ['rmi', image], { stdio: 'ignore' });
  const remaining = execFileSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).split('\n').filter((i) => i && !imagesBefore.has(i));
  record('精确清理：本次的容器、命名卷、网络、构建与拉取的镜像全部删除；运行前已有的镜像不动；不 prune',
    down.status === 0 && !left && !leftVolumes && !leftDrill && remaining.filter((i) => !i.startsWith('<none>')).length === 0,
    `删除镜像 ${pulled.length} 个；残留容器 ${left ? left.split('\n').length : 0}，卷 ${leftVolumes ? leftVolumes.split('\n').length : 0}`);
  rmSync(dirname(EMPTY_ENV), { recursive: true, force: true });
  const report = [`# 本地部署演练 ${PROJECT}`, '', `时间：${new Date().toISOString()}`, '', '| 结果 | 检查 | 证据 |', '| --- | --- | --- |',
    ...results.map((r) => `| ${r.pass ? 'PASS' : 'FAIL'} | ${r.name} | ${String(r.evidence ?? '').replace(/\|/g, '\\|')} |`)].join('\n');
  writeFileSync(join(OUT, 'drill-report.md'), `${report}\n`);
  rmSync(join(OUT, 'drill-backup.dump'), { force: true });
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} PASS · 报告：${join(OUT, 'drill-report.md')}`);
  process.exitCode = failed ? 1 : 0;
}
