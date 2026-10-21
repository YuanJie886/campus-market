import { describe, expect, it } from 'vitest';

/**
 * 楼栋集市的源码级隐私护栏（模块 1）。
 *
 * <p>这些约束靠代码评审很容易漏：某天有人为了「更准」顺手加一个 geolocation，
 * 或者给资料页补一个房间号输入框。这里直接扫描源码，把红线变成会失败的测试。
 */
const sources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const production = Object.entries(sources).filter(([path]) => !path.includes('.test.') && !path.includes('test-setup'));

function offenders(pattern: RegExp): string[] {
  return production.filter(([, text]) => pattern.test(text)).map(([path]) => path);
}

describe('模块 1 隐私红线', () => {
  it('1. 不调用浏览器定位 API', () => {
    // 只匹配调用点：文档注释里写「不调用 navigator.geolocation」是在说明约束，不是违反约束
    expect(offenders(/navigator\.geolocation\s*\.|\.getCurrentPosition\s*\(|\.watchPosition\s*\(/)).toEqual([]);
  });

  it('2. 不引入第三方地图 SDK', () => {
    expect(offenders(/from ['"](leaflet|mapbox-gl|@amap|@googlemaps|ol|baidu-map)/)).toEqual([]);
    expect(offenders(/maps\.googleapis|webapi\.amap|api\.map\.baidu|api\.mapbox/)).toEqual([]);
  });

  it('3. 不存在房间号 / 楼层 / 床位字段', () => {
    expect(offenders(/\b(roomNumber|dormRoom|bedNumber|floorNumber)\b/)).toEqual([]);
  });

  it('4. 降级顺序只在 utils/geo.ts 定义一次', () => {
    const defining = offenders(/\[\s*['"]BUILDING['"]\s*,\s*['"]ZONE['"]\s*,\s*['"]CAMPUS['"]\s*,\s*['"]SCHOOL['"]\s*,?\s*\]/);
    expect(defining).toEqual(['./utils/geo.ts']);
  });

  it('5. 业务判断不使用中文 scope 文案', () => {
    // 形如 effectiveScopeLabel === '本园区' 的比较一旦出现，改文案就会改行为
    expect(offenders(/ScopeLabel\s*===|===\s*['"](本楼|本园区|本校区|全校)['"]/)).toEqual([]);
  });

  it('6. Access Token 没有重新进入持久化存储', () => {
    expect(offenders(/(localStorage|sessionStorage)\.setItem\([^)]*[Tt]oken/)).toEqual([]);
  });
});

describe('模块 2 需求雷达红线', () => {
  it('7. 不申请浏览器系统通知权限，不注册推送', () => {
    expect(offenders(/Notification\.requestPermission|new Notification\(|pushManager|serviceWorker\.register/)).toEqual([]);
  });

  it('8. 不接入短信 / 微信 / 邮件推送', () => {
    expect(offenders(/wx\.|weixin|wechat.*sdk|sendSms|smtp|mailto:/i)).toEqual([]);
  });

  it('9. 不展示任何队列位置：没有「排在第 N 位」一类的文案或字段', () => {
    expect(offenders(/queuePosition|queue_position|排在第|排队位置|前面还有\s*\d/)).toEqual([]);
  });

  it('10. 前端从不提交 userId / schoolId / fingerprint 这类服务端字段', () => {
    // 订阅相关的写请求只由 contracts 中的 DemandConditions 描述，其中没有这些字段
    const contracts = production.find(([path]) => path.endsWith('api/contracts.ts'))![1];
    const conditions = contracts.slice(contracts.indexOf('export interface DemandConditions'), contracts.indexOf('export interface DemandSubscription {'));
    expect(conditions).not.toMatch(/userId|schoolId|fingerprint/);
  });

  it('11. 评分分值只在 Mock 专用模块定义一次', () => {
    expect(offenders(/KEYWORD_TITLE_EXACT:\s*50/)).toEqual(['./api/mock/demandScoring.ts']);
  });

  it('12. 3.0A：非 Mock 代码不得引用 Mock 评分模块，REST 界面不得自行计算分数或档位', () => {
    const importers = production
      .filter(([, text]) => /from ['"][./]*(api\/)?mock\/demandScoring['"]/.test(text))
      .map(([path]) => path);
    expect(importers).toEqual(['./api/mockCampusMarketApi.ts']);
    // 界面层不得出现任何「由分数推导档位」的写法
    const ui = production.filter(([path]) => path.startsWith('./pages/') || path.startsWith('./components/'));
    expect(ui.filter(([, text]) => /score\s*>=|matchLevel\(|mockTier\(|scoreDemandMatch\(/.test(text)).map(([p]) => p)).toEqual([]);
  });
});

describe('模块 3 可信面交红线', () => {
  const segment = (file: string, start: string, end: string) => {
    const text = production.find(([path]) => path.endsWith(file))![1];
    const from = text.indexOf(start);
    expect(from, `${file} 中找不到 ${start}`).toBeGreaterThanOrEqual(0);
    return text.slice(from, text.indexOf(end, from + start.length));
  };
  const nonMock = production.filter(([path]) => !path.includes('/mock') && !path.includes('mockCampusMarketApi') && !path.includes('mockMigrations'));
  const contracts = () => production.find(([path]) => path.endsWith('api/contracts.ts'))![1];

  it('13. 卖家声明、联系申请与全部界面代码都不接触任何定位或设备接口', () => {
    // 阶段 1 移除了出发 / 到达与订单验货界面；这条红线扩大到全部生产代码，而不只是可信面交目录
    const trust = production.filter(([path]) => path.includes('/trust/'));
    expect(trust.length).toBeGreaterThanOrEqual(3);
    expect(offenders(/navigator\.(geolocation|mediaDevices|bluetooth|usb|serial)|DeviceOrientation|DeviceMotion|getCurrentPosition|watchPosition/)).toEqual([]);
  });

  it('14. 不存在信用分 / 靠谱指数一类的字段或文案', () => {
    expect(offenders(/\b(creditScore|trustScore|reliabilityScore|creditLevel|credit_score)\b|靠谱指数/)).toEqual([]);
  });

  it('15. 业务判断不使用可信面交的中文文案', () => {
    expect(offenders(/===\s*['"](已出发|已到达|尚未出发|与声明一致|与声明不一致|现场无法检查|正常|存在问题|未测试|不适用|待对方回应|双方已确认|已被新档期替换|验货不一致，待处理|申诉中)['"]/))
      .toEqual([]);
  });

  it('16. 前端从不替服务端设置 submittedAt / checkedAt / arrivedAt / departedAt / decidedAt / 已读时间', () => {
    expect(nonMock
      .filter(([path]) => !path.endsWith('api/contracts.ts'))
      .filter(([, text]) => /\b(submittedAt|checkedAt|arrivedAt|departedAt|decidedAt|sellerSeenAt|buyerSeenAt)(Iso)?\s*:/.test(text))
      .map(([p]) => p)).toEqual([]);
    for (const input of [
      segment('api/contracts.ts', 'export interface DisclosureInput', '\n'),
      segment('api/contracts.ts', 'export interface ModerationReportInput', '\n'),
      segment('api/contracts.ts', 'export interface ModerationDecisionInput', '\n'),
      segment('api/contracts.ts', 'export interface AppealInput', '\n'),
    ]) expect(input).not.toMatch(/(submitted|checked|arrived|departed|created|responded|updated|decided)At|sellerId|buyerId|orderId|productId|templateVersion|proposerId|userId|status/);
  });

  it('17. 联系申请的写请求只带接口列出的字段；申请对象类型里没有联系方式 / 宿舍楼 / 账号；公共履历类型已移除', () => {
    const rest = production.find(([path]) => path.endsWith('api/restCampusMarketApi.ts'))![1];
    // POST 的第二个参数就是请求体：同意 / 拒绝只带 status，标记已读只带 role；申请、撤回、撤回同意不带请求体
    const contactWrites = [...rest.matchAll(/this\.transport\.post<[^>]*>\(`?'?([^`',]*contact-request[^`',]*)`?'?(?:,\s*([^)]*))?\)/g)]
      .map((m) => `${m[1].replace(/\$\{[^}]*\}/g, ':id')} ${m[2]?.trim() ?? '-'}`).sort();
    expect(contactWrites).toEqual([
      '/v1/contact-requests/:id/decision { status }',
      '/v1/contact-requests/:id/revoke -',
      '/v1/contact-requests/:id/withdraw -',
      '/v1/contact-requests/read { role }',
      '/v1/products/:id/contact-request -',
    ]);
    const request = segment('api/contracts.ts', 'export interface ContactRequest {', '\n}');
    expect(request).not.toMatch(/dormBuildingId|contact\s*:|account|phone|wechat/i);
    expect(contracts()).not.toMatch(/export interface PublicTradeSummary/);
    expect(production.some(([path]) => path.endsWith('PublicTradeSummaryCard.tsx'))).toBe(false);
  });

  it('18. 不引入 WebSocket / 实时推送', () => {
    expect(offenders(/new WebSocket\(|socket\.io|EventSource\(/)).toEqual([]);
  });
});

describe('3.8 收口红线', () => {
  it('19. 订单 / 验货 / 档期 / 到达界面已移除：没有任何生产代码调用停用的交易接口或复制买家确认条件', () => {
    // 原来的约束是「确认面交按钮只读服务端给出的 buyerConfirmAllowed」；阶段 1 起这些页面与接口都不存在，
    // 因此改为更强的约束：任何页面、组件或适配层都不能再出现这些调用与判断
    expect(production.filter(([path]) => /pages\/OrderFlowPage\.tsx|pages\/profile\/(OrdersPage|TradeHistoryPage)\.tsx/.test(path))).toEqual([]);
    expect(offenders(/\b(getOrderFlow|saveInspectionDraft|submitInspection|proposeMeeting|acceptMeeting|rejectMeeting|withdrawMeeting|updatePresence|createOrder|transitionOrder|listOrders|addReview|getOwnTradeHistory|getPublicTradeSummary|listMeetingPoints)\s*\(/)).toEqual([]);
    expect(offenders(/inspectionStatus\s*===|buyerConfirmBlockReason|buyerConfirmAllowed/)).toEqual([]);
  });

  it('20. 不出现平台仲裁 / 判责 / 赔付 / 担保退款一类的说法', () => {
    expect(offenders(/平台仲裁中|等待平台仲裁|平台判定卖家责任|赔付处理中|保证退款|平台担保付款|平台保证商品无问题/)).toEqual([]);
  });
});

describe('模块 4 课程教材图谱红线', () => {
  const contracts = () => production.find(([path]) => path.endsWith('api/contracts.ts'))![1];
  const typeBlock = (name: string) => {
    const text = contracts();
    const start = text.indexOf(`export interface ${name}`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    return text.slice(start, text.indexOf('\n}', start));
  };

  it('21. 不申请相机、扫码或媒体设备权限（ISBN 只能手动输入）', () => {
    expect(offenders(/getUserMedia|BarcodeDetector|mediaDevices|capture=["']/)).toEqual([]);
  });

  it('22. 不用书名相似度自动绑定版本', () => {
    expect(offenders(/levenshtein|editDistance|jaccard|fuzzyMatch|similarityScore|stringSimilarity/i)).toEqual([]);
  });

  it('23. 建议 / 订阅 / 商品的请求类型里没有学校、提交人、审核状态、快照或时间字段', () => {
    expect(typeBlock('TextbookSuggestionInput')).not.toMatch(/schoolId|submitterId|verificationStatus|status|createdAt|fingerprint/);
    expect(typeBlock('DemandConditions')).not.toMatch(/schoolId|userId|fingerprint/);
    const productInputs = contracts().slice(contracts().indexOf('export type ProductCreateInput'), contracts().indexOf('/* ---------------------------- 课程教材图谱'));
    expect(productInputs).not.toMatch(/Snapshot|schoolId|verificationStatus/);
  });

  it('24. 界面不展示「已认证 / 官方认证 / 审核进度」一类暗示真实教务认证的说法，也不显示审核状态字段', () => {
    // 只看代码与界面文案：注释里写「不存在已认证状态」是在说明约束，不是违反约束
    const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(production.filter(([, text]) => /已认证|官方认证|教务认证|审核进度|已通过审核|教务系统同步/.test(withoutComments(text)))
      .map(([p]) => p)).toEqual([]);
    const ui = production.filter(([path]) => path.startsWith('./pages/') || path.startsWith('./components/'));
    expect(ui.filter(([, text]) => /verificationStatus/.test(text)).map(([p]) => p)).toEqual([]);
  });

  it('25. 不存在订阅人数 / 等待人数一类字段', () => {
    expect(offenders(/waitingCount|subscriberCount|subscribersCount|订阅人数|等待人数/)).toEqual([]);
  });

  it('26. 演示目录只经 Mock 适配层读取：页面与组件不直接读种子数据；三个目录页都显示演示说明', () => {
    const importers = production
      .filter(([, text]) => /from ['"][./]*(data\/)?courseCatalog['"]/.test(text))
      .map(([path]) => path).sort();
    expect(importers).toEqual(['./api/mockMigrations.ts']);
    for (const page of ['pages/CoursesPage.tsx', 'pages/CourseDetailPage.tsx', 'pages/TextbookDetailPage.tsx']) {
      expect(production.find(([path]) => path.endsWith(page))![1]).toContain('DEMO_CATALOG_NOTE');
    }
  });
});
