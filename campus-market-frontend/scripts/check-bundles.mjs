#!/usr/bin/env node
/**
 * 4.8B 构建产物检查：在 `npm run build:rest` 与 `npm run build:mock` 之后运行（npm run build:all 会依次执行）。
 *
 * - REST 产物（dist/）里不能出现离线 Mock：Mock 的存储键、演示种子、Mock 专用的历史交易收尾标识、演示邀请码面板与演示邀请码。
 * - Mock 产物（dist-mock/）里不能出现真实 REST 传输层：认证刷新、批量发布、协助邀请、联系申请未读 / 已读、找回密码、注销、图片上传、客户端配置、私信快捷消息、学校列表等 REST 路径。
 * - 每个标记都必须在另一份产物里出现，证明检查不是空转（例如标记拼错了永远找不到）。
 * - 入口 chunk 不超过 chunkSizeWarningLimit（1500 kB，未调高）。
 * - REST 产物里的 http(s) 主机只能是从不请求的命名空间 / 文档链接；演示图床只以受 externalAllowed 控制的主机名常量出现一次。
 *
 * 只读文件，不联网、不读 .env。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REST_DIR = 'dist';
const MOCK_DIR = 'dist-mock';
const ENTRY_LIMIT_KB = 1500;

/** REST 产物里不得出现的离线 Mock 标记 */
const MOCK_ONLY = ['mock_database_v1', 'demo-calculus-8', 'PLATFORM_TRADE_RETIRED', 'demo-staff-switch', 'demo-reset-code', 'mock_uploaded_images_v1',
  // 邀请制：注册页的「演示邀请码」面板（data-marker）、离线演示的邀请制开关与内存里的演示邀请码只属于 Mock；
  // 真实部署的邀请码由学校工作人员发放，REST 产物里不能有任何写死的邀请码
  'demo-invite-code', 'mock_invite_required_v1', 'CAMP-US23-4567'];
/** Mock 产物里不得出现的 REST 传输层标记 */
const REST_ONLY = ['/v1/auth/refresh', '/v1/listing-batches', '/v1/listing-assist-invites', '/v1/contact-requests/unread-count', '/v1/contact-requests/read',
  // 阶段 3 / 4：账号生命周期与图片上传只走真实后端；离线演示用本机的 data: 图片与内存里的演示重置码
  '/v1/auth/password-reset', '/v1/auth/me/deletion', '/v1/images',
  // 客户端配置（图片张数 / 大小 / 类型 / 是否允许外部图片）：REST 请求后端，Mock 直接给出离线演示的固定配置
  '/v1/config',
  // 私信快捷消息列表：REST 请求后端，Mock 直接给出离线演示的同一套模板
  '/v1/message-templates',
  // 学校与校区列表：REST 请求后端，Mock 由离线演示数据（演示学校 pilot）直接给出同一个形状
  '/v1/schools'];

function bundle(dir) {
  const assets = join(dir, 'assets');
  if (!existsSync(assets)) {
    console.error(`缺少 ${assets}：请先运行 npm run build:rest 与 npm run build:mock`);
    process.exit(2);
  }
  const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
  return files.map((f) => ({ name: f, text: readFileSync(join(assets, f), 'utf8'), size: statSync(join(assets, f)).size }));
}

/** 产物里的 CSS 与 index.html（第三方主机检查用） */
function extraTexts(dir) {
  const assets = join(dir, 'assets');
  return [
    ...readdirSync(assets).filter((f) => f.endsWith('.css')).map((f) => ({ name: f, text: readFileSync(join(assets, f), 'utf8') })),
    { name: 'index.html', text: readFileSync(join(dir, 'index.html'), 'utf8') },
  ];
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
// 第三方主机：REST 产物（JS / CSS / index.html）里出现的 http(s) 主机只能是下面这些「从不请求」的字符串
//   - www.w3.org：SVG / XML 命名空间标识（React DOM、MUI 图标、本地绘制的分类封面），浏览器不会请求；
//   - reactjs.org、mui.com、bugs.webkit.org：React / MUI 报错信息与源码注释里的文档链接，只是文字。
// 演示图床只允许以 src/utils/externalDemoImages.ts 里的主机名常量出现一次（预置示例图只在 externalAllowed=true 时显示，
// 旧演示头像只用它来识别、从不加载），不允许出现任何写死的完整地址。
const NEVER_REQUESTED_HOSTS = ['www.w3.org', 'reactjs.org', 'mui.com', 'bugs.webkit.org'];
const DEMO_HOST = 'picsum.photos';
const restTexts = [...rest, ...extraTexts(REST_DIR)];
for (const f of restTexts) {
  for (const m of f.text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (!NEVER_REQUESTED_HOSTS.includes(host)) failures.push(`REST 产物 ${f.name} 引用了第三方主机「${host}」`);
  }
}
const demoHits = restTexts.flatMap((f) => [...f.text.matchAll(/(.)picsum\.photos(.)/g)].map((m) => ({ name: f.name, before: m[1], after: m[2] })));
if (demoHits.length !== 1) failures.push(`REST 产物里演示图床主机名应只出现 1 次（externalDemoImages.ts 的常量），实际 ${demoHits.length} 次`);
for (const h of demoHits) {
  if (!['"', "'", '`'].includes(h.before) || h.before !== h.after) failures.push(`REST 产物 ${h.name} 里演示图床不是以主机名常量出现（前后字符 ${h.before}${h.after}）`);
  else if (!rest.find((f) => f.name === h.name)?.text.includes('/seed/cm-preset-')) failures.push(`REST 产物 ${h.name} 的演示图床常量不在预置示例图模块旁`);
}
if (!contains(mock, DEMO_HOST).length) failures.push(`Mock 产物里找不到「${DEMO_HOST}」，演示图床检查已失效`);

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
console.log(`✓ REST 产物只引用从不请求的主机（${NEVER_REQUESTED_HOSTS.join('、')}）；演示图床只以受 externalAllowed 控制的主机名常量出现 1 次`);
