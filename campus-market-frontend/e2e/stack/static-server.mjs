// E2E 专用的静态服务器：等价于 deploy/nginx/default.conf 的规则——
//   /v1/*  反向代理到后端（带上 Host 与 X-Forwarded-Proto）；
//   其余   静态文件，找不到时回落到 index.html（SPA 深链接刷新）；
//   安全响应头直接读取 deploy/nginx/security-headers.conf，真实浏览器测试在同样的 CSP 下运行。
// 只监听 127.0.0.1；端口由父进程分配。不记录请求体、Cookie 或任何头部。
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.E2E_STATIC_ROOT ?? 'dist');
const port = Number(process.env.E2E_WEB_PORT);
const api = new URL(process.env.E2E_API_ORIGIN);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

// 解析 nginx 的 add_header 行：add_header Name "value" always;
const SECURITY_HEADERS = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../deploy/nginx/security-headers.conf'), 'utf8')
    .split('\n').map((line) => line.match(/^add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;$/)).filter(Boolean)
    .map((m) => [m[1], m[2]]));
if (!SECURITY_HEADERS['Content-Security-Policy']) throw new Error('security-headers.conf 没有解析出 CSP');

function serveFile(res, path) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/v1/') || url.pathname === '/v1') {
    const upstream = http.request({
      hostname: api.hostname, port: api.port, path: req.url, method: req.method,
      headers: { ...req.headers, host: req.headers.host, 'x-forwarded-proto': 'http' },
    }, (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...SECURITY_HEADERS });
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() });
    req.pipe(upstream);
    return;
  }
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(root, safe);
  if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) return serveFile(res, candidate);
  return serveFile(res, join(root, 'index.html'));
});

server.listen(port, '127.0.0.1', () => process.send?.('ready'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
