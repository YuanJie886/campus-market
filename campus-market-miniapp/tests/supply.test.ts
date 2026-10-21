import { describe, expect, it } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import {
  ASSISTED_PUBLISH_TEXT, batchCheckProblems, batchPublishProblems, bundleFormProblems, bundleInput, copyCommonFields, draftFormFrom, draftPayload, emptyBundleRow,
  itemsFromRows, newIdempotencyKey, rowsSummary, tokenFromInput, versionConflict, type BundleForm,
} from '../src/supply';
import type { ListingPayload } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return { api: new MockApi(storage), storage };
}
const complete = (title: string): ListingPayload => ({ title, description: '自用，功能正常', price: '25.5', category: '生活用品', condition: '几乎全新', campus: '东校区', images: ['/assets/goods/lamp.png'], contact: '13800000000' });
const row = (name: string, quantity = '1') => ({ ...emptyBundleRow(), name, category: '生活用品', condition: '几乎全新', quantity });

describe('整套打包发布', () => {
  const form = (): BundleForm => ({ title: '宿舍整套', description: '毕业清仓', price: '120', category: '其他', condition: '轻微使用痕迹', campus: '东校区', buildingId: null, images: ['/assets/goods/box.png'], uploading: false, contact: '13800000000', contactPublic: false, rows: [row('台灯'), row('收纳盒', '2')], visibility: 'PUBLIC', circleIds: [] });
  it('本地检查与 Web 逐条一致：明细 2～30 行、每行名称 / 分类 / 成色 / 数量、价格最多两位小数、圈子可见需要圈子', () => {
    expect(bundleFormProblems(form())).toEqual([]);
    expect(bundleFormProblems({ ...form(), title: ' ', price: '1.234', category: '', rows: [row('台灯')], visibility: 'CIRCLE_ONLY' })).toEqual([
      '请填写整套标题', '请填写整套总价（最多两位小数）', '请选择主分类（混合物品请选「其他 / 混合物品」）', '打包明细需要 2～30 行', '圈子可见需要至少选择一个圈子',
    ]);
    expect(bundleFormProblems({ ...form(), rows: [row('台灯'), { ...row(''), quantity: 'x' }] })).toEqual(['第 2 行明细还没填完整（名称、分类、成色、数量）']);
    expect(rowsSummary(form().rows)).toBe('共 2 行（需要 2～30 行）· 包含 1 类 / 3 件');
  });
  it('发布请求体：listingKind = BUNDLE，明细数量为整数，没有验货声明与教材版本；演示发布后详情带明细与汇总', async () => {
    const input = bundleInput(form());
    expect(input).toMatchObject({ listingKind: 'BUNDLE', price: 120, bundleItems: [{ name: '台灯', category: '生活用品', condition: '几乎全新', quantity: 1 }, { name: '收纳盒', quantity: 2 }], visibility: 'PUBLIC' });
    expect(input).not.toHaveProperty('inspection');
    expect(input).not.toHaveProperty('textbookEditionId');
    const { api } = setup();
    await api.login('seller001', 'demo12345');
    const product = await api.detail((await api.publish({ ...input, campus: '西校区' })).id);
    expect(product).toMatchObject({ listingKind: 'BUNDLE', bundle: { itemCount: 2, totalQuantity: 3, categoryCount: 1 } });
    expect(product.bundleItems?.map((i) => [i.itemCode, i.name])).toEqual([['I01', '台灯'], ['I02', '收纳盒']]);
    await expect(api.publish({ ...input, campus: '西校区', bundleItems: itemsFromRows([row('台灯')]) })).rejects.toMatchObject({ code: 400, message: '整套打包需要 2～30 条明细' });
    await expect(api.publish({ ...input, campus: '西校区', inspection: [] })).rejects.toMatchObject({ code: 400, message: '整套打包商品按每条明细验货，不需要商品级验货清单' });
    await expect(api.publish({ ...input, campus: '西校区', listingKind: 'SINGLE' }, product.id)).rejects.toMatchObject({ code: 400, message: '商品发布后不能在单件与整套打包之间切换' });
  });
});

describe('毕业季批量发布：全部成功或全部不发布', () => {
  it('有一件不合格时整批 400，逐项原因在 details.items，一件都没有发布；修好后一次发布，同一个幂等键重放返回同一结果', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const before = (await api.myListings()).length;
    const a = await api.createDraft({ payload: complete('台灯') });
    const b = await api.createDraft({ draftType: 'BUNDLE', payload: { ...complete('整套'), bundleItems: [{ name: '杯子', category: '生活用品', condition: '全新', quantity: 1 }] } });
    const c = await api.createDraft({ payload: { title: '只填了标题' } });
    const batch = await api.createBatch({ draftIds: [a.id, b.id, c.id] });
    expect(batch.allValid).toBe(false);
    expect(batchCheckProblems(batch.items).map((p) => p.text)).toEqual(['第 2 件：打包明细有误', '第 3 件：还有必填项没填（描述、价格、分类、成色、校区、图片）']);
    const error = await api.publishBatch(batch.id, 'batch-key-0001').catch((e) => e);
    expect(error).toMatchObject({ code: 400, message: '有 2 件商品还不能发布，整个批次都没有发布' });
    expect(batchPublishProblems(error)?.map((p) => [p.position, p.draftId])).toEqual([[2, b.id], [3, c.id]]);
    expect((await api.myListings()).length).toBe(before);
    expect((await api.batch(batch.id)).status).toBe('OPEN');
    // 逐件修好（带版本号）
    const fixedB = await api.updateDraft(b.id, { expectedVersion: b.version, payload: { ...complete('整套'), bundleItems: [{ name: '杯子', category: '生活用品', condition: '全新', quantity: 1 }, { name: '碗', category: '生活用品', condition: '全新', quantity: 2 }] } });
    await api.updateDraft(c.id, { expectedVersion: c.version, payload: complete('书架'), status: 'READY' });
    expect(versionConflict(await api.updateDraft(b.id, { expectedVersion: b.version, payload: complete('旧版本') }).catch((e) => e))).toBe(fixedB.version);
    const fresh = await api.batch(batch.id);
    const result = await api.publishBatch(batch.id, 'batch-key-0002');
    expect(result).toMatchObject({ publishedCount: 3, replayed: false });
    expect((await api.myListings()).length).toBe(before + 3);
    expect(await api.publishBatch(batch.id, 'batch-key-0002')).toEqual({ ...result, replayed: true });
    expect(fresh.version).toBeLessThanOrEqual((await api.batch(batch.id)).version);
    expect((await api.batch(batch.id)).status).toBe('PUBLISHED');
    await expect(api.publishBatch(batch.id, 'batch-key-0003')).rejects.toMatchObject({ code: 409, message: '批次已发布或已丢弃' });
  });
  it('写入途中失败时演示库回到发布前（不会只发布一部分）', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const before = (await api.myListings()).length;
    const ok = await api.createDraft({ payload: complete('台灯') });
    // 校验阶段通过、写入阶段被内容安全拦截的一件
    const blocked = await api.createDraft({ payload: complete('代考服务') });
    const batch = await api.createBatch({ draftIds: [ok.id, blocked.id] });
    await expect(api.publishBatch(batch.id, 'batch-key-0101')).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
    expect((await api.myListings()).length).toBe(before);
    expect((await api.batch(batch.id)).status).toBe('OPEN');
  });
  it('批次最多 20 件；版本不一致 409；幂等键 8～100 位', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const batch = await api.createBatch({});
    await expect(api.updateBatch(batch.id, { expectedVersion: batch.version, draftIds: Array.from({ length: 21 }, (_, i) => `d${i}`) })).rejects.toMatchObject({ code: 400, message: '一个批次最多 20 件商品' });
    await expect(api.updateBatch(batch.id, { expectedVersion: batch.version + 1, draftIds: [] })).rejects.toMatchObject({ code: 409, message: '批次已被其他页面更新，请重新加载' });
    await expect(api.publishBatch(batch.id, 'short')).rejects.toMatchObject({ code: 400, message: '请提供 8～100 位的 Idempotency-Key' });
    expect(newIdempotencyKey(() => 0.5, () => 255)).toBe(`batch-ff-${'8'.repeat(24)}`);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
  it('复制上一件的通用字段只复制校区、取货楼栋与联系方式', () => {
    expect(copyCommonFields({ ...complete('x'), buildingId: 'b1', contact: '' })).toEqual({ campus: '东校区', buildingId: 'b1' });
  });
});

describe('协助整理发布', () => {
  it('所有者邀请 → 协助人兑换：只能整理白名单字段，看不到联系方式，不能标记可发布；所有者发布时如实写明协助整理；撤销后协助人看不到', async () => {
    const { api } = setup();
    await api.login('seller001', 'demo12345');
    const draft = await api.createDraft({ payload: { ...complete('台灯'), campus: '西校区', contact: 'wechat:seller' } });
    const batch = await api.createBatch({ draftIds: [draft.id] });
    const { token, invite } = await api.createAssistInvite({ batchId: batch.id, expiresInHours: 24 });
    expect(invite).toMatchObject({ scope: 'BATCH', status: 'PENDING', assistantNickname: null });
    await expect(api.redeemAssistInvite(token)).rejects.toMatchObject({ code: 404, message: '邀请码无效或已失效' });

    await api.login('buyer001', 'demo12345');
    const redeemed = await api.redeemAssistInvite(tokenFromInput(`https://campus.example/assist#code=${token}`));
    expect(redeemed.drafts).toHaveLength(1);
    const seen = redeemed.drafts[0];
    expect(seen.access).toBe('ASSISTANT');
    expect(seen.payload).not.toHaveProperty('contact');
    // 页面保存时以所有者原内容为底，只覆盖可整理字段
    const form = { ...draftFormFrom(seen.payload), title: '护眼台灯（协助整理）', condition: '全新', contact: 'hijack' };
    const payload = draftPayload(seen, form, { assistant: true, hasTemplate: false, templateReady: true });
    expect(payload.condition).toBe('几乎全新');
    expect(payload).not.toHaveProperty('contact');
    const saved = await api.updateDraft(seen.id, { expectedVersion: seen.version, payload });
    expect(saved).toMatchObject({ access: 'ASSISTANT', payload: { title: '护眼台灯（协助整理）' } });
    await expect(api.updateDraft(seen.id, { expectedVersion: saved.version, payload: { ...payload, condition: '全新' } })).rejects.toMatchObject({ code: 403, message: '协助人只能整理标题、描述、分类、价格建议、打包明细与取货楼栋建议' });
    await expect(api.updateDraft(seen.id, { expectedVersion: saved.version, payload: { ...payload, contact: 'x' } })).rejects.toMatchObject({ code: 403, message: '协助人不能填写联系方式' });
    await expect(api.updateDraft(seen.id, { expectedVersion: saved.version, status: 'READY' })).rejects.toMatchObject({ code: 403, message: '只有商品所有者可以把草稿标记为可发布' });
    await expect(api.publishBatch(batch.id, 'batch-key-0201')).rejects.toMatchObject({ code: 404 });

    await api.login('seller001', 'demo12345');
    const owned = await api.batch(batch.id);
    expect(owned.assisted).toBe(true);
    expect(owned.items[0].draft.payload.contact).toBe('wechat:seller');
    expect(ASSISTED_PUBLISH_TEXT).toBe('内容由他人协助整理，商品所有者已检查并确认发布。');
    const [active] = await api.assistInvites();
    expect(active).toMatchObject({ status: 'ACTIVE', assistantNickname: '小鹿同学' });
    await api.revokeAssistInvite(active.id);
    await api.login('buyer001', 'demo12345');
    expect(await api.assistingDrafts()).toEqual([]);
    await expect(api.draft(seen.id)).rejects.toMatchObject({ code: 404, message: '草稿不存在' });
  });
  it('邀请码可以是邀请码本身或 Web 邀请链接', () => {
    const token = 'A'.repeat(43);
    expect(tokenFromInput(` ${token} `)).toBe(token);
    expect(tokenFromInput(`https://campus.example/assist#code=${token}`)).toBe(token);
    expect(tokenFromInput(`/circles/join#code=${token}`)).toBe(token);
  });
});
