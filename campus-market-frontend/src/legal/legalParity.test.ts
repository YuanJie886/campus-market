import { describe, expect, it } from 'vitest';
import * as web from './legalText';

/**
 * 网页端的用户协议与隐私政策必须与小程序 campus-market-miniapp/src/legal.ts 逐字相同（两端共用同一套账号，
 * 隐私政策第一条已写明网页端同样适用）。这里直接加载小程序的模块逐节比较，任何一端单独改动都会失败。
 * 网页端没有任何有意的措辞差异；如果将来需要差异，必须在 INTENDED_DIVERGENCES 里逐条写明，而不是放宽比较。
 */
type LegalModule = typeof web;
const loaded = import.meta.glob('../../../campus-market-miniapp/src/legal.ts', { eager: true }) as Record<string, LegalModule>;
const raw = import.meta.glob('../../../campus-market-miniapp/src/legal.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** 有意的差异：目前为空（网页端逐字沿用小程序文本） */
const INTENDED_DIVERGENCES: ReadonlyArray<{ doc: 'PRIVACY_POLICY' | 'USER_AGREEMENT'; heading: string; reason: string }> = [];

async function miniapp(): Promise<LegalModule> {
  const mod = Object.values(loaded)[0];
  expect(mod, '找不到 ../campus-market-miniapp/src/legal.ts').toBeTruthy();
  // 确实读到了小程序的源文件（而不是别的同名模块）
  expect(Object.values(raw)[0]).toContain('export const USER_AGREEMENT');
  return mod;
}

describe('协议文本与小程序一致（逐节）', () => {
  it('占位常量与草案横幅相同：「草案，待法务审核后生效」与【…】占位都保留', async () => {
    const m = await miniapp();
    expect(web.LEGAL_DRAFT_NOTICE).toBe('草案，待法务审核后生效');
    for (const key of ['LEGAL_DRAFT_NOTICE', 'OPERATOR', 'OPERATOR_CONTACT', 'OPERATOR_ADDRESS', 'EFFECTIVE_DATE'] as const) {
      expect(web[key], key).toBe(m[key]);
    }
    for (const key of ['OPERATOR', 'OPERATOR_CONTACT', 'OPERATOR_ADDRESS', 'EFFECTIVE_DATE'] as const) {
      expect(web[key]).toMatch(/^【.+】$/);
    }
  });

  for (const name of ['PRIVACY_POLICY', 'USER_AGREEMENT'] as const) {
    it(`${name}：标题、草案标记、运营者信息与每一节的标题和段落逐字相同`, async () => {
      const ours = web[name];
      const theirs = (await miniapp())[name];
      expect(ours.title).toBe(theirs.title);
      expect(ours.draft).toBe(theirs.draft);
      expect(ours.draft).toBe(web.LEGAL_DRAFT_NOTICE);
      expect(ours.meta).toEqual(theirs.meta);
      expect(ours.sections.map((s) => s.heading)).toEqual(theirs.sections.map((s) => s.heading));
      theirs.sections.forEach((section, i) => {
        if (INTENDED_DIVERGENCES.some((d) => d.doc === name && d.heading === section.heading)) return;
        expect(ours.sections[i].paragraphs, `${name} ${section.heading}`).toEqual(section.paragraphs);
      });
      expect(INTENDED_DIVERGENCES).toEqual([]);
      // 未确定的信息仍是【…】占位，没有被替换成编造的名称
      expect(JSON.stringify(ours)).toContain('【运营主体名称】');
    });
  }
});
