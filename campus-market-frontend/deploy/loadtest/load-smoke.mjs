// 冒烟压测（阶段 6 准备）：注册一批一次性测试用户、发布商品，然后按「浏览为主」的比例并发请求，输出各接口的 p50 / p95 / p99、错误率与吞吐。
//
// 用法（在 campus-market-frontend 目录）：
//   node deploy/loadtest/load-smoke.mjs <站点地址> [--users 20] [--products 3] [--concurrency 50] [--seconds 60]
// 也被部署演练以 DRILL_LOAD=1 调用（对一次性演练栈）。
//
// 只能对本机或测试环境运行：会注册测试账号、发布测试商品。地址不是 localhost / 127.0.0.1 时必须加 --test-environment 明确确认。
// 不使用真实用户数据；不输出令牌或口令。
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// 试运行期的目标（按试点规模，可调整）：读接口 p95 < 500 ms；非 2xx（不含 429）< 1%
export const TARGETS = { readP95Ms: 500, errorRate: 0.01 };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export async function runLoad({ origin, users = 20, productsPerUser = 3, concurrency = 50, seconds = 60, log = console.log }) {
  async function call(method, path, { token, body, form } = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const started = performance.now();
    const res = await fetch(`${origin}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await res.text();
    const ms = performance.now() - started;
    let json = null; try { json = JSON.parse(text) } catch { /* 图片或 HTML */ }
    return { status: res.status, json, ms };
  }

  // ---- 准备数据：校区取自 /v1/schools（第一所可见学校的第一个校区），不写死任何学校
  const schools = await call('GET', '/v1/schools');
  const campus = schools.json?.data?.[0]?.campuses?.[0]?.id;
  if (!campus) throw new Error('站点没有可注册的校区（GET /v1/schools 为空）');
  // 测试用户各上传一张图片，发布若干商品
  log(`准备：${users} 个测试用户 × ${productsPerUser} 件商品`);
  const people = [];
  for (let i = 0; i < users; i += 1) {
    const r = await call('POST', '/v1/auth/register', { body: { account: `load${randomBytes(6).toString('hex')}`, password: `pw-${randomBytes(9).toString('base64url')}`,
      nickname: `压测用户${i + 1}`, campus, contact: '13800000000' } });
    if (r.status !== 200) throw new Error(`注册测试用户失败：${r.status}`);
    people.push({ token: r.json.data.accessToken, products: [] });
  }
  const productIds = [];
  for (const person of people) {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'load.png');
    const up = await call('POST', '/v1/images', { token: person.token, form });
    if (up.status !== 200) throw new Error(`上传测试图片失败：${up.status}`);
    for (let j = 0; j < productsPerUser; j += 1) {
      const p = await call('POST', '/v1/products', { token: person.token, body: { title: `压测商品 ${productIds.length + 1}`, description: '冒烟压测用的测试商品，请忽略',
        price: 10 + j, category: '其他', condition: '几乎全新', campus, images: [up.json.data.ref], contact: '13800000000' } });
      if (p.status !== 200) throw new Error(`发布测试商品失败：${p.status}`);
      productIds.push(p.json.data.id);
      person.products.push(p.json.data.id);
    }
  }
  const imageUrls = [];
  for (const id of productIds.slice(0, 10)) {
    const d = await call('GET', `/v1/products/${id}`, { token: people[0].token });
    if (d.json?.data?.images?.[0]) imageUrls.push(d.json.data.images[0]);
  }

  // ---- 场景比例：浏览为主
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const scenarios = [
    { name: '商品列表', weight: 40, read: true, run: (u) => call('GET', `/v1/products?page=${1 + Math.floor(Math.random() * 3)}&pageSize=20`, { token: u.token }) },
    { name: '关键词搜索', weight: 10, read: true, run: (u) => call('GET', `/v1/products?keyword=${encodeURIComponent('压测')}&pageSize=20`, { token: u.token }) },
    { name: '商品详情', weight: 25, read: true, run: (u) => call('GET', `/v1/products/${pick(productIds)}`, { token: u.token }) },
    { name: '楼栋 feed', weight: 8, read: true, run: (u) => call('GET', '/v1/products/feed', { token: u.token }) },
    { name: '联系申请未读数', weight: 10, read: true, run: (u) => call('GET', '/v1/contact-requests/unread-count', { token: u.token }) },
    { name: '图片', weight: 5, read: true, run: () => call('GET', pick(imageUrls)) },
    { name: '申请联系方式', weight: 2, read: false, run: (u) => {
      const others = productIds.filter((id) => !u.products.includes(id));
      return call('POST', `/v1/products/${pick(others)}/contact-request`, { token: u.token, body: {} });
    } },
  ].filter((s) => s.name !== '图片' || imageUrls.length);
  const totalWeight = scenarios.reduce((n, s) => n + s.weight, 0);
  const choose = () => { let r = Math.random() * totalWeight; for (const s of scenarios) { r -= s.weight; if (r < 0) return s } return scenarios[0] };

  const samples = new Map(scenarios.map((s) => [s.name, { ms: [], errors: 0, limited: 0, read: s.read }]));
  const deadline = Date.now() + seconds * 1000;
  log(`开始：并发 ${concurrency}，持续 ${seconds} 秒`);
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
    const user = people[i % people.length];
    while (Date.now() < deadline) {
      const s = choose();
      const bucket = samples.get(s.name);
      try {
        const r = await s.run(user);
        bucket.ms.push(r.ms);
        if (r.status === 429) bucket.limited += 1;
        else if (r.status < 200 || r.status >= 300) bucket.errors += 1;
      } catch {
        bucket.errors += 1;
      }
    }
  }));
  const elapsed = (Date.now() - started) / 1000;

  // ---- 汇总
  const rows = [];
  let total = 0, errors = 0, limited = 0, readP95 = 0;
  for (const [name, b] of samples) {
    const sorted = [...b.ms].sort((x, y) => x - y);
    const row = { name, count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), errors: b.errors, limited: b.limited };
    rows.push(row);
    total += row.count; errors += b.errors; limited += b.limited;
    if (b.read) readP95 = Math.max(readP95, row.p95);
  }
  const summary = { total, rps: total / elapsed, errorRate: total ? errors / total : 1, limited, readP95, seconds: elapsed, concurrency, users, products: productIds.length };
  summary.pass = summary.errorRate < TARGETS.errorRate && readP95 < TARGETS.readP95Ms;
  log('| 接口 | 请求数 | p50 ms | p95 ms | p99 ms | 错误 | 429 |');
  log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) log(`| ${r.name} | ${r.count} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.errors} | ${r.limited} |`);
  log(`合计 ${total} 次，${summary.rps.toFixed(1)} 次/秒；错误率 ${(summary.errorRate * 100).toFixed(2)}%（429 另计 ${limited} 次）；读接口最慢 p95 ${readP95.toFixed(0)} ms`);
  log(`${summary.pass ? 'PASS' : 'FAIL'}（目标：读接口 p95 < ${TARGETS.readP95Ms} ms，错误率 < ${TARGETS.errorRate * 100}%）`);
  return { rows, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const origin = args.find((a) => !a.startsWith('--'))?.replace(/\/$/, '');
  const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback };
  if (!origin) { console.error('用法：node deploy/loadtest/load-smoke.mjs <站点地址> [--users 20] [--products 3] [--concurrency 50] [--seconds 60] [--test-environment]'); process.exit(2) }
  const host = new URL(origin).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) && !args.includes('--test-environment')) {
    console.error(`${host} 不是本机地址：压测会注册测试账号并发布测试商品，只能对测试环境运行。确认后加 --test-environment。`);
    process.exit(2);
  }
  const { summary } = await runLoad({ origin, users: opt('users', 20), productsPerUser: opt('products', 3), concurrency: opt('concurrency', 50), seconds: opt('seconds', 60) });
  process.exitCode = summary.pass ? 0 : 1;
}
