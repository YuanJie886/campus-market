import { describe, expect, it } from 'vitest';
import { PRICE_GUIDANCE_NOTE, PRICE_GUIDANCE_MIN_SAMPLE, BATCH_MAX_ITEMS, BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS } from './api/contracts';
import { ASSISTANT_FIELDS, PAYLOAD_FIELDS } from './api/mock/supplyRules';
import { VALIDATION_LABEL } from './utils/supply';

/**
 * 十五、模块 5 源码守卫：文案边界、隐私与权限、邀请码不进 URL、前后端常量一致、双模式构建配置。
 * 用 Vite 的 glob 原样读取源码文本，不需要 node 类型。
 */
const raw = (pattern: Record<string, string>) => pattern;
const sources = raw(import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const app = Object.entries(sources).filter(([path]) => !path.includes('.test.') && !path.endsWith('test-axe.ts') && !path.startsWith('./test/'));
const supplyFiles = app.filter(([path]) => /supply|Supply|Assist|assist/.test(path));
const backend = import.meta.glob('../../campus-market-backend/src/main/java/com/lulu/campusmarketbackend/supply/*.java', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const javaOf = (name: string) => Object.entries(backend).find(([path]) => path.endsWith(`/${name}.java`))?.[1] ?? '';
const V7 = Object.values(import.meta.glob('../../campus-market-backend/src/main/resources/db/migration/V7__graduation_supply_engine.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const config = import.meta.glob(['../package.json', '../vite.config.ts', '../deploy/web.Dockerfile', '../scripts/check-bundles.mjs'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const cfg = (suffix: string) => Object.entries(config).find(([path]) => path.endsWith(suffix))?.[1] ?? '';

/** 去掉注释后再匹配：文档注释里说明「为什么不这样做」不算违规 */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (files: Array<[string, string]>, pattern: RegExp) => files.filter(([, text]) => pattern.test(stripComments(text))).map(([path]) => path);

describe('十五 文案边界', () => {
  it('「协助整理发布」从不写成代卖或平台代理', () => {
    expect(offenders(app, /代卖|平台代理|代为出售/)).toEqual([]);
  });
  it('价格参考从不自称估价、官方指导价或成交保证', () => {
    expect(offenders(app, /AI\s*估价|官方指导价|保证成交|必须按此定价|建议必须/)).toEqual([]);
    expect(PRICE_GUIDANCE_NOTE).toBe('这是校内历史已完成交易的统计参考，不是平台估价或成交保证。');
  });
  it('发布确认页写明协助整理的固定文字；协助人页面没有发布按钮', () => {
    const workbench = sources['./pages/SupplyWorkbenchPage.tsx'];
    expect(workbench).toContain('内容由他人协助整理，商品所有者已检查并确认发布。');
    const assist = sources['./pages/AssistPage.tsx'];
    expect(assist).not.toMatch(/publishListingBatch|createAssistInvite|revokeAssistInvite/);
  });
});

describe('十五 隐私与权限', () => {
  it('模块 5 的界面不使用 localStorage / sessionStorage / IndexedDB（邀请码只在组件内存里）', () => {
    expect(offenders(supplyFiles.filter(([p]) => !p.startsWith('./api/')), /localStorage|sessionStorage|indexedDB/)).toEqual([]);
  });
  it('不申请相机、定位或通知权限，不读取相册', () => {
    expect(offenders(app, /getUserMedia|geolocation|Notification\.requestPermission|capture=|showOpenFilePicker/)).toEqual([]);
    expect(offenders(supplyFiles, /type=["']file["']/)).toEqual([]);
  });
  it('邀请码从不进入 URL query：只放在 # 片段或请求体里', () => {
    expect(offenders(app, /[?&](code|token|invite)=\$\{/)).toEqual([]);
    expect(offenders(app, /searchParams\.get\(['"](code|token|invite)['"]\)|params\.get\(['"](code|token|invite)['"]\)/)).toEqual([]);
    expect(sources['./api/restCampusMarketApi.ts']).toContain("'/v1/listing-assist-invites/redeem', { token }");
  });
  it('幂等键只走 Idempotency-Key 请求头', () => {
    const rest = sources['./api/restCampusMarketApi.ts'];
    expect(rest).toMatch(/listing-batches\/\$\{encodeURIComponent\(id\)\}\/publish`, undefined,\s*\{ 'Idempotency-Key': idempotencyKey \}/);
  });
  it('验货声明、分类、成色都不预选：工作台与打包编辑器里没有默认的 NORMAL 或默认分类', () => {
    expect(offenders(supplyFiles, /condition:\s*['"]NORMAL['"]|category:\s*['"](数码电子|生活用品|教材书籍)['"]/)).toEqual([]);
  });
});

describe('十五 前后端常量一致', () => {
  it('价格参考说明文字、最小样本数与后端相同', () => {
    const java = javaOf('PriceGuidanceService');
    expect(java).toContain(`NOTE = "${PRICE_GUIDANCE_NOTE}"`);
    expect(java).toContain(`MIN_SAMPLE = ${PRICE_GUIDANCE_MIN_SAMPLE};`);
  });
  it('批次 / 打包上限、草稿白名单、协助人可整理字段与后端相同', () => {
    expect(javaOf('ListingBatchService')).toContain(`MAX_ITEMS = ${BATCH_MAX_ITEMS};`);
    expect(javaOf('BundleService')).toContain(`MIN_ITEMS = ${BUNDLE_MIN_ITEMS};`);
    expect(javaOf('BundleService')).toContain(`MAX_ITEMS = ${BUNDLE_MAX_ITEMS};`);
    const payload = javaOf('ListingPayload');
    const setOf = (name: string) => [...(new RegExp(`${name} = Set\\.of\\(([^)]*)\\)`).exec(payload)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(setOf('FIELDS')).toEqual([...PAYLOAD_FIELDS].sort());
    expect(setOf('ASSISTANT_FIELDS')).toEqual([...ASSISTANT_FIELDS].sort());
  });
  it('逐项校验码：前端能展示后端给出的每一个码', () => {
    const java = javaOf('ListingValidator') + javaOf('ListingBatchService');
    const codes = new Set([...java.matchAll(/new (?:ListingValidator\.)?Result\("([A-Z_]+)"/g)].map((m) => m[1]));
    codes.add('VALID');
    expect([...codes].sort()).toEqual(Object.keys(VALIDATION_LABEL).sort());
  });
  it('V7 不重定义 V6 的 ISBN 函数，也不删除任何数据', () => {
    expect(V7).toContain('listing_drafts');
    expect(V7).not.toMatch(/CREATE OR REPLACE FUNCTION isbn13_is_valid|DROP FUNCTION|DELETE FROM|TRUNCATE/i);
  });
});

describe('4.8B 双模式构建', () => {
  it('build:rest / build:mock 都先做类型检查，并用显式 mode；不调高 chunkSizeWarningLimit；部署镜像用 build:rest', () => {
    const pkg = JSON.parse(cfg('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:rest']).toMatch(/^tsc --noEmit && vite build --mode rest/);
    expect(pkg.scripts['build:mock']).toMatch(/^tsc --noEmit && vite build --mode mock/);
    expect(pkg.scripts['build:all']).toContain('check:bundles');
    // 5.7B：默认 npm run build 不再读取本机 .env 决定模式，而是确定性地产出两份产物
    expect(pkg.scripts.build).toBe('npm run build:all');
    expect(pkg.scripts['check:deterministic']).toBe('node scripts/check-deterministic-build.mjs');
    const vite = cfg('vite.config.ts');
    expect(vite).toContain('chunkSizeWarningLimit: 1500,');
    expect(vite).toMatch(/envDir: 'build-modes'/);
    expect(vite).toContain("'import.meta.env.VITE_API_MODE': JSON.stringify(mode)");
    expect(cfg('web.Dockerfile')).toContain('RUN npm run build:rest');
    expect(cfg('check-bundles.mjs')).toContain('mock_database_v1');
  });
  it('API 客户端的模式判断是可常量折叠的字面量比较', () => {
    expect(sources['./api/client.ts']).toContain("const MOCK_MODE = import.meta.env.VITE_API_MODE === 'mock' || import.meta.env.VITE_API_MODE === 'MOCK';");
  });
});
