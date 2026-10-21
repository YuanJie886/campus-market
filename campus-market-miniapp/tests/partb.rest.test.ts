import { describe, expect, it, vi } from 'vitest';
import { RestApi } from '../src/api/rest';
import { MockApi } from '../src/api/mock';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { batchPublishProblems, versionConflict } from '../src/supply';
import { listingInput } from '../src/listing';
import type { MarketApi, ProductInput } from '../src/model';

const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' } });
function setup(reply: (input: Parameters<RequestPort>[0]) => Response = () => ok({})) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  const api = new RestApi(new Transport(handler, 'https://campus.example', true));
  const calls = () => handler.mock.calls.map(([input]) => [input.method, input.url.replace('https://campus.example', ''), input.data]);
  return { api, handler, calls };
}
const UID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('REST 第二部分：每个新接口的路径与请求体（与 Web restCampusMarketApi 一致）', () => {
  it('圈子', async () => {
    const { api, calls } = setup((input) => ok(input.url.includes('/mine') || input.url.includes('/discover') || (input.url.endsWith('/invites') && input.method === 'GET') ? [] : { items: [], total: 0, page: 1, size: 20 }));
    await api.createCircle({ type: 'CLASS', name: '演示班', description: '', visibility: 'PRIVATE', extra: 'x' } as never);
    await api.myCircles();
    await api.discoverCircles('班 级');
    await api.discoverCircles();
    await api.circle('c/1');
    await api.updateCircle('c1', { name: '新名字' });
    await api.archiveCircle('c1');
    await api.circleProducts('c1', 2);
    await api.createCircleInvite('c1', 72);
    await api.createCircleInvite('c1');
    await api.circleInvites('c1');
    await api.redeemCircleInvite('TOKEN_abc');
    await api.revokeCircleInvite('i1');
    await api.circleMembers('c1', 3, 20);
    await api.changeCircleMemberRole('c1', 'u 2', 'MODERATOR');
    await api.removeCircleMember('c1', 'u2');
    expect(calls()).toEqual([
      ['POST', '/v1/circles', { type: 'CLASS', name: '演示班', description: '', visibility: 'PRIVATE' }],
      ['GET', '/v1/circles/mine', undefined],
      ['GET', '/v1/circles/discover?q=%E7%8F%AD%20%E7%BA%A7', undefined],
      ['GET', '/v1/circles/discover', undefined],
      ['GET', '/v1/circles/c%2F1', undefined],
      ['PATCH', '/v1/circles/c1', { name: '新名字' }],
      ['POST', '/v1/circles/c1/archive', {}],
      ['GET', '/v1/circles/c1/products?page=2', undefined],
      ['POST', '/v1/circles/c1/invites', { expiresInHours: 72 }],
      ['POST', '/v1/circles/c1/invites', {}],
      ['GET', '/v1/circles/c1/invites', undefined],
      // 邀请码只在请求体里，不进入 URL
      ['POST', '/v1/circle-invites/redeem', { token: 'TOKEN_abc' }],
      ['POST', '/v1/circle-invites/i1/revoke', {}],
      ['GET', '/v1/circles/c1/members?page=3&size=20', undefined],
      ['PATCH', '/v1/circles/c1/members/u%202', { role: 'MODERATOR' }],
      ['DELETE', '/v1/circles/c1/members/u2', undefined],
    ]);
  });

  it('草稿、批次与协助整理；整批发布只把幂等键放在 Idempotency-Key 请求头里', async () => {
    const { api, handler, calls } = setup((input) => ok(input.method === 'GET' && /listing-(drafts|batches|assist-invites)(\/assisting)?$/.test(input.url) ? [] : {}));
    const signed = `/v1/images/${UID}?exp=1&sig=a`;
    await api.createDraft({ draftType: 'BUNDLE', payload: { title: 'x', images: [signed, `https://campus.example${signed}`, 'https://cdn.example/a.png'] } });
    await api.drafts();
    await api.assistingDrafts();
    await api.draft('d1');
    await api.updateDraft('d1', { expectedVersion: 3, payload: { images: [signed] }, status: 'READY' });
    await api.updateDraft('d1', { expectedVersion: 4 });
    await api.discardDraft('d1');
    await api.createBatch({ draftIds: ['d1'] });
    await api.batches();
    await api.batch('b1');
    await api.updateBatch('b1', { expectedVersion: 2, draftIds: ['d2', 'd1'] });
    await api.discardBatch('b1');
    await api.publishBatch('b1', 'batch-key-123456');
    await api.createAssistInvite({ batchId: 'b1', expiresInHours: 24 });
    await api.createAssistInvite({ draftId: 'd1' });
    await api.assistInvites();
    await api.redeemAssistInvite('TOKEN_x');
    await api.revokeAssistInvite('a1');
    expect(calls()).toEqual([
      // 签名图片地址（相对或已拼域名）换回 upload:<id>，外部地址原样
      ['POST', '/v1/listing-drafts', { draftType: 'BUNDLE', payload: { title: 'x', images: [`upload:${UID}`, `upload:${UID}`, 'https://cdn.example/a.png'] } }],
      ['GET', '/v1/listing-drafts', undefined],
      ['GET', '/v1/listing-drafts/assisting', undefined],
      ['GET', '/v1/listing-drafts/d1', undefined],
      ['PATCH', '/v1/listing-drafts/d1', { expectedVersion: 3, payload: { images: [`upload:${UID}`] }, status: 'READY' }],
      ['PATCH', '/v1/listing-drafts/d1', { expectedVersion: 4 }],
      ['DELETE', '/v1/listing-drafts/d1', undefined],
      ['POST', '/v1/listing-batches', { draftIds: ['d1'] }],
      ['GET', '/v1/listing-batches', undefined],
      ['GET', '/v1/listing-batches/b1', undefined],
      ['PATCH', '/v1/listing-batches/b1', { expectedVersion: 2, draftIds: ['d2', 'd1'] }],
      ['DELETE', '/v1/listing-batches/b1', undefined],
      ['POST', '/v1/listing-batches/b1/publish', undefined],
      ['POST', '/v1/listing-assist-invites', { batchId: 'b1', expiresInHours: 24 }],
      ['POST', '/v1/listing-assist-invites', { draftId: 'd1' }],
      ['GET', '/v1/listing-assist-invites', undefined],
      ['POST', '/v1/listing-assist-invites/redeem', { token: 'TOKEN_x' }],
      ['POST', '/v1/listing-assist-invites/a1/revoke', {}],
    ]);
    const publish = handler.mock.calls[12][0];
    expect(publish.header['Idempotency-Key']).toBe('batch-key-123456');
    expect(handler.mock.calls[0][0].header['Idempotency-Key']).toBeUndefined();
  });

  it('需求订阅：PATCH 不带教材版本与圈子；未读数 / 已读 / 忽略返回 count', async () => {
    const { api, calls } = setup((input) => ok(input.url.includes('unread-count') || input.url.endsWith('/read') || input.url.endsWith('/dismiss') ? { count: 3 } : input.url.endsWith('/v1/demand-subscriptions') && input.method === 'GET' ? [] : {}));
    await api.createSubscription({ keyword: '耳机', category: null, minPrice: 0, maxPrice: 100, geoScope: 'CAMPUS', campusId: '东校区', buildingId: null, circleId: 'c1', junk: 1 } as never);
    await api.subscriptions();
    await api.updateSubscription('s1', { keyword: '键盘', textbookEditionId: 'e1', circleId: 'c1', active: false } as never);
    await api.deleteSubscription('s1');
    await api.demandMatches(2, 50);
    expect(await api.demandUnread()).toBe(3);
    expect(await api.markDemandRead('m1')).toBe(3);
    expect(await api.dismissDemandMatch('m1')).toBe(3);
    expect(calls()).toEqual([
      ['POST', '/v1/demand-subscriptions', { keyword: '耳机', category: null, minPrice: 0, maxPrice: 100, geoScope: 'CAMPUS', campusId: '东校区', buildingId: null, circleId: 'c1' }],
      ['GET', '/v1/demand-subscriptions', undefined],
      ['PATCH', '/v1/demand-subscriptions/s1', { keyword: '键盘', active: false }],
      ['DELETE', '/v1/demand-subscriptions/s1', undefined],
      ['GET', '/v1/demand-matches?page=2&pageSize=50', undefined],
      ['GET', '/v1/demand-matches/unread-count', undefined],
      ['POST', '/v1/demand-matches/m1/read', undefined],
      ['POST', '/v1/demand-matches/m1/dismiss', undefined],
    ]);
  });

  it('楼栋集市 feed、课程教材、教材建议与客户端配置', async () => {
    const { api, calls } = setup((input) => ok(input.url.endsWith('/mine') ? [] : {}));
    await api.feed({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 12, keyword: '台 灯', minPrice: 0, category: undefined });
    await api.courses({ q: 'MA', term: 'AUTUMN', page: 1, pageSize: 20 });
    await api.courses({});
    await api.course('demo/1');
    await api.textbook('e1');
    await api.textbook('e1', 'latest');
    await api.textbookByIsbn('978-7-04-039663-8');
    await api.createTextbookSuggestion({ courseOfferingId: 'o1', isbn: '9787040396638', usageType: 'REQUIRED', note: '老师上课说的', status: 'X' } as never);
    await api.myTextbookSuggestions();
    await api.withdrawTextbookSuggestion('s1');
    await api.clientConfig();
    expect(calls()).toEqual([
      ['GET', '/v1/products/feed?scope=BUILDING&sort=latest&page=1&pageSize=12&keyword=%E5%8F%B0%20%E7%81%AF&minPrice=0', undefined],
      ['GET', '/v1/courses?q=MA&term=AUTUMN&page=1&pageSize=20', undefined],
      ['GET', '/v1/courses', undefined],
      ['GET', '/v1/courses/demo%2F1', undefined],
      ['GET', '/v1/textbooks/e1', undefined],
      ['GET', '/v1/textbooks/e1?sort=latest', undefined],
      ['GET', '/v1/textbooks/isbn/978-7-04-039663-8', undefined],
      ['POST', '/v1/textbook-suggestions', { courseOfferingId: 'o1', isbn: '9787040396638', usageType: 'REQUIRED', note: '老师上课说的' }],
      ['GET', '/v1/textbook-suggestions/mine', undefined],
      ['DELETE', '/v1/textbook-suggestions/s1', undefined],
      ['GET', '/v1/config', undefined],
    ]);
  });

  it('发布：整套打包、圈子可见、教材版本与取货楼栋原样进入 POST /v1/products；编辑只提交改动过的可见范围与教材', async () => {
    const { api, calls } = setup(() => ok({ id: 'p1' }));
    const base: ProductInput = { title: '高数第 8 版', description: '少量笔记', price: 20, category: '教材书籍', condition: '轻微使用痕迹', campus: '东校区', images: [`upload:${UID}`], contact: '13800000000', contactPublic: false };
    await api.publish(listingInput(base, { buildingId: 'b1', visibility: 'CIRCLE_ONLY', circleIds: ['c1'], textbookEditionId: 'e8' }));
    await api.publish(listingInput(base, { buildingId: null, visibility: 'CIRCLE_ONLY', circleIds: ['c1'], textbookEditionId: 'e8' }, { visibility: 'CIRCLE_ONLY', circleIds: ['c1'], textbookEditionId: 'e8', bundle: false }), 'p1');
    await api.publish(listingInput(base, { buildingId: null, visibility: 'PUBLIC', circleIds: [], textbookEditionId: null }, { visibility: 'CIRCLE_ONLY', circleIds: ['c1'], textbookEditionId: 'e8', bundle: false }), 'p1');
    const [create, sameEdit, changedEdit] = calls();
    expect(create).toEqual(['POST', '/v1/products', { ...base, buildingId: 'b1', visibility: 'CIRCLE_ONLY', circleIds: ['c1'], textbookEditionId: 'e8' }]);
    expect(sameEdit[0]).toBe('PATCH');
    expect(sameEdit[2]).toEqual({ ...base, buildingId: null });
    expect(changedEdit[2]).toEqual({ ...base, buildingId: null, visibility: 'PUBLIC', circleIds: [], textbookEditionId: null });
    // 切离教材分类时不会带出教材版本
    expect(listingInput({ ...base, category: '其他' }, { buildingId: null, visibility: 'PUBLIC', circleIds: [], textbookEditionId: 'e8' })).not.toHaveProperty('textbookEditionId');
  });
});

describe('REST 第二部分：错误与兜底', () => {
  it('旧后端没有 /v1/config（404）时用默认值；返回值逐项校验', async () => {
    expect(await setup(() => ({ statusCode: 404, data: '<html>' })).api.clientConfig()).toEqual({ images: { maxCount: 9, maxBytes: 5242880, accept: ['image/jpeg', 'image/png'], externalAllowed: true } });
    expect((await setup(() => ok({ images: { maxCount: 6, externalAllowed: false, maxBytes: 'x' } })).api.clientConfig()).images).toMatchObject({ maxCount: 6, externalAllowed: false, maxBytes: 5242880 });
    await expect(setup(() => ({ statusCode: 500, data: { code: 500, message: '服务暂时不可用' } })).api.clientConfig()).rejects.toMatchObject({ code: 500 });
  });
  it('整批发布被拒：details.items 逐项原因带到页面；版本冲突带 currentVersion', async () => {
    const items = [{ position: 2, draftId: 'd2', code: 'MISSING_FIELD', field: 'title,images', message: '还有必填项没有填写' }, { position: 3, draftId: 'd3', code: 'INVALID_CIRCLE', field: 'circleIds', message: 'x' }];
    const { api } = setup(() => ({ statusCode: 400, data: { code: 400, data: { items }, message: '有 2 件商品还不能发布，整个批次都没有发布' } }));
    const error = await api.publishBatch('b1', 'batch-key-123456').catch((e) => e);
    expect(error).toMatchObject({ code: 400, message: '有 2 件商品还不能发布，整个批次都没有发布' });
    expect(batchPublishProblems(error)).toEqual([
      { position: 2, draftId: 'd2', text: '第 2 件：还有必填项没填（标题、图片）' },
      { position: 3, draftId: 'd3', text: '第 3 件：圈子可见范围有误' },
    ]);
    const conflict = await setup(() => ({ statusCode: 409, data: { code: 409, data: { currentVersion: 7 }, message: '草稿已被其他页面或协助人更新，请重新加载后再修改' } })).api.updateDraft('d1', { expectedVersion: 6 }).catch((e) => e);
    expect(versionConflict(conflict)).toBe(7);
    expect(batchPublishProblems(conflict)).toBeNull();
  });
});

describe('演示与真实接口的方法一致', () => {
  it('MockApi 与 RestApi 实现同一组公开方法（第二部分的每个接口两边都有）', () => {
    const own = (proto: object) => Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof (proto as Record<string, unknown>)[n] === 'function');
    const rest = new Set(own(RestApi.prototype).filter((n) => !['payloadRefs'].includes(n)));
    const partB: (keyof MarketApi)[] = ['clientConfig', 'feed', 'createCircle', 'myCircles', 'discoverCircles', 'circle', 'updateCircle', 'archiveCircle', 'circleProducts', 'createCircleInvite', 'circleInvites', 'redeemCircleInvite', 'revokeCircleInvite', 'circleMembers', 'changeCircleMemberRole', 'removeCircleMember',
      'createDraft', 'drafts', 'assistingDrafts', 'draft', 'updateDraft', 'discardDraft', 'createBatch', 'batches', 'batch', 'updateBatch', 'discardBatch', 'publishBatch', 'createAssistInvite', 'assistInvites', 'redeemAssistInvite', 'revokeAssistInvite',
      'courses', 'course', 'textbook', 'textbookByIsbn', 'createTextbookSuggestion', 'myTextbookSuggestions', 'withdrawTextbookSuggestion',
      'createSubscription', 'subscriptions', 'updateSubscription', 'deleteSubscription', 'demandMatches', 'demandUnread', 'markDemandRead', 'dismissDemandMatch'];
    for (const name of partB) { expect(rest.has(name)).toBe(true); expect(typeof (MockApi.prototype as unknown as Record<string, unknown>)[name]).toBe('function'); }
    for (const name of rest) expect(typeof (MockApi.prototype as unknown as Record<string, unknown>)[name]).toBe('function');
  });
});
