import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const compiler = process.env.WECHAT_WXSS_COMPILER ?? '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc';
if (!existsSync(compiler)) {
  console.error('未找到微信官方 WXSS 编译器。请安装微信开发者工具，或设置 WECHAT_WXSS_COMPILER 为 wcsc 的绝对路径。');
  process.exit(1);
}
if (!existsSync(root)) {
  console.error('请先运行 npm run build:weapp，生成 dist/。');
  process.exit(1);
}
function styles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? styles(target) : entry.name.endsWith('.wxss') ? [target] : [];
  });
}
const files = styles(root);
if (!files.length) { console.error('dist/ 中没有 WXSS 产物，请重新构建。'); process.exit(1); }
const output = mkdtempSync(path.join(tmpdir(), 'campus-wxss-check-'));
try {
  for (const [index, file] of files.entries()) {
    const name = path.relative(root, file);
    const result = spawnSync(compiler, [name, '-o', path.join(output, `${index}.js`)], { cwd: root, encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      console.error(`WXSS 校验失败：${name}\n${result.error?.message ?? ''}${result.stderr ?? ''}${result.stdout ?? ''}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`微信官方 WXSS 编译校验通过：${files.length} 个样式文件。`);
} finally { rmSync(output, { recursive: true, force: true }); }
