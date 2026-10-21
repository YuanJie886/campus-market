import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';


/**
 * Mock 演示数据的 schema 版本化与迁移（0.9E）。
 *
 * <p>核心约束：中文文案「交易中」同时对应 4 个 canonical 状态，反推必然有歧义。
 * 迁移只能保守取 PENDING_MEETING 并显式标记，绝不猜成权限更宽的状态。
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';

function seed(): MockDatabase {
  return {
    schemaVersion: MOCK_SCHEMA_VERSION,
    users: [{ id: 'u1', account: 'a', password: 'p', nickname: 'n', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 }],
    buildings: [],
    market: { products: [], orders: [], comments: [], favorites: [], conversations: [], messages: [] },
    idempotency: {},
    currentUserId: null,
  } as unknown as MockDatabase;
}

/** 构造一份「版本机制引入之前」的负载：没有 schemaVersion，订单只有中文文案。 */
function legacyPayload(orderStatus: string, productStatus = '在售'): Record<string, unknown> {
  return {
    users: [{ id: 'u1', account: 'a', password: 'p', nickname: 'n', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 }],
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: 't', description: 'd', price: 1, category: '数码', condition: '全新', campus: '东校区', images: [], status: productStatus, views: 0, createdAt: 1 }],
      orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 1, status: orderStatus, createdAt: 1, updatedAt: 2 }],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {},
  };
}

/**
 * 阶段 1（v13）起，迁移链最后会按后端 V16 把未结束的旧订单系统关闭为 EXPIRED，并在 legacyTradeClosures 里留下原状态。
 * 早期步骤（0.9E 的 canonical 推断）的结论因此以「收尾前的状态」核对：有收尾记录时取 fromStatus，否则取当前状态。
 */
function inferred(db: MockDatabase, orderId: string): string | undefined {
  const closure = db.legacyTradeClosures.find((c) => c.entityType === 'ORDER' && c.entityId === orderId);
  return closure ? closure.fromStatus : db.market.orders.find((o) => o.id === orderId)?.canonicalStatus;
}

describe('0.9E Mock schema 版本化与迁移', () => {
  it('1. 无版本号的旧负载被识别为 v1 并升级到当前版本', () => {
    const result = migrateMockDatabase(legacyPayload('待确认'), seed);
    expect(result.fromVersion).toBe(1);
    expect(result.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.discarded).toBe(false);
  });

  it('2. 已是当前版本的负载不执行任何迁移步骤', () => {
    const current = { ...legacyPayload('待确认'), schemaVersion: MOCK_SCHEMA_VERSION };
    const result = migrateMockDatabase(current, seed);
    expect(result.fromVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(result.applied).toEqual([]);
  });

  it('3. 幂等：对同一份旧负载迁移两次，结果完全一致且第二次是空操作', () => {
    const first = migrateMockDatabase(legacyPayload('交易中'), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(second.ambiguousOrderIds).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('4. 歧义的「交易中」保守落到 PENDING_MEETING 并标记 legacyStatusAmbiguous', () => {
    const result = migrateMockDatabase(legacyPayload('交易中'), seed);
    const order = result.db.market.orders[0];
    expect(inferred(result.db, 'o1')).toBe('PENDING_MEETING');
    expect(order.legacyStatusAmbiguous).toBe(true);
    expect(result.ambiguousOrderIds).toEqual(['o1']);
    // 阶段 1：这张未结束的订单随后被系统关闭（与后端 V16 一致）
    expect(order.canonicalStatus).toBe('EXPIRED');
  });

  it('5. 绝不把「交易中」猜成权限更宽的 BUYER_CONFIRMED / SELLER_CONFIRMED', () => {
    const db = migrateMockDatabase(legacyPayload('交易中'), seed).db;
    expect(inferred(db, 'o1')).not.toBe('BUYER_CONFIRMED');
    expect(inferred(db, 'o1')).not.toBe('SELLER_CONFIRMED');
    expect(inferred(db, 'o1')).not.toBe('DISPUTED');
  });

  it('6. 无歧义的文案精确还原，且不打歧义标记', () => {
    const cases: Array<[string, string]> = [
      ['待确认', 'PENDING_SELLER_CONFIRM'],
      ['已完成', 'COMPLETED'],
      ['已取消', 'CANCELLED'],
    ];
    for (const [label, canonical] of cases) {
      const db = migrateMockDatabase(legacyPayload(label), seed).db;
      expect(inferred(db, 'o1')).toBe(canonical);
      expect(db.market.orders[0].legacyStatusAmbiguous).toBeUndefined();
      // 已结束的订单不被收尾改动；未结束的（待确认）被系统关闭
      expect(db.market.orders[0].canonicalStatus).toBe(canonical === 'PENDING_SELLER_CONFIRM' ? 'EXPIRED' : canonical);
    }
  });

  it('7. 已有 canonicalStatus 的订单是真值，迁移不得覆盖', () => {
    const payload = legacyPayload('交易中');
    const market = payload.market as { orders: Array<Record<string, unknown>> };
    market.orders[0].canonicalStatus = 'BUYER_CONFIRMED';
    const db = migrateMockDatabase(payload, seed).db;
    expect(inferred(db, 'o1')).toBe('BUYER_CONFIRMED');
    expect(db.market.orders[0].legacyStatusAmbiguous).toBeUndefined();
  });

  it('8. 存在活跃旧订单的商品：迁移链最终释放旧预约 → 在售（平台不再预约）；订单记录原样保留、不被删除', () => {
    const db = migrateMockDatabase(legacyPayload('交易中', '在售'), seed).db;
    expect(db.market.products[0].status).toBe('在售');
    expect(db.market.products[0].contactPublic).toBe(false);
    expect(db.market.orders).toHaveLength(1);
    expect(inferred(db, 'o1')).toBe('PENDING_MEETING');
    expect(db.market.orders[0].canonicalStatus).toBe('EXPIRED');
  });

  it('9. 商品状态按订单重算：订单已取消 → 商品回到在售', () => {
    const db = migrateMockDatabase(legacyPayload('已取消', '预约中'), seed).db;
    expect(db.market.products[0].status).toBe('在售');
    expect(db.market.products[0].soldAt).toBeUndefined();
  });

  it('10. 商品状态按订单重算：订单已完成 → 已售出并补 soldAt', () => {
    const db = migrateMockDatabase(legacyPayload('已完成', '在售'), seed).db;
    expect(db.market.products[0].status).toBe('已售出');
    expect(db.market.products[0].soldAt).toBe(2);
  });

  it('11. 「已下架」是卖家的显式决定，重算不得覆盖', () => {
    const db = migrateMockDatabase(legacyPayload('交易中', '已下架'), seed).db;
    expect(db.market.products[0].status).toBe('已下架');
  });

  it('12. 损坏或形状不可识别的负载回退种子，不抛异常', () => {
    for (const broken of [null, undefined, 'not-json', 42, [], {}, { users: 'x' }]) {
      const result = migrateMockDatabase(broken, seed);
      expect(result.discarded).toBe(true);
      expect(result.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    }
  });

  it('13. 读到更高版本时不降级、不写回，避免旧代码毁掉新版数据', () => {
    const future = { ...legacyPayload('待确认'), schemaVersion: MOCK_SCHEMA_VERSION + 1 };
    const result = migrateMockDatabase(future, seed);
    expect(result.persistable).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.discarded).toBe(false);
  });
});

describe('0.9E 事件证据优先于中文文案', () => {
  function withEvidence(fields: Record<string, unknown>) {
    const payload = legacyPayload('交易中');
    const market = payload.market as { orders: Array<Record<string, unknown>> };
    Object.assign(market.orders[0], fields);
    return migrateMockDatabase(payload, seed);
  }

  it('17. 有买家确认痕迹 → BUYER_CONFIRMED，且不标记歧义', () => {
    const result = withEvidence({ buyerConfirmedAt: 1700000000000 });
    expect(inferred(result.db, 'o1')).toBe('BUYER_CONFIRMED');
    expect(result.db.market.orders[0].legacyStatusAmbiguous).toBeUndefined();
    expect(result.ambiguousOrderIds).toEqual([]);
  });

  it('18. 只有面交信息 → PENDING_MEETING（有证据，非保守兜底）', () => {
    const result = withEvidence({ meetingPointId: '东校区-library' });
    expect(inferred(result.db, 'o1')).toBe('PENDING_MEETING');
    expect(result.db.market.orders[0].legacyStatusAmbiguous).toBeUndefined();
  });

  it('19. 有完成/取消/过期时刻 → 迁移到对应终态', () => {
    expect(withEvidence({ completedAt: 1 }).db.market.orders[0].canonicalStatus).toBe('COMPLETED');
    expect(withEvidence({ cancelledAtIso: '2026-01-01T00:00:00Z' }).db.market.orders[0].canonicalStatus).toBe('CANCELLED');
    expect(withEvidence({ expiredAt: 2 }).db.market.orders[0].canonicalStatus).toBe('EXPIRED');
  });

  it('20. 不凭模糊订单把商品判成已售出', () => {
    const db = migrateMockDatabase(legacyPayload('交易中', '在售'), seed).db;
    expect(db.market.products[0].status).not.toBe('已售出');
    expect(db.market.products[0].soldAt).toBeUndefined();
  });
});

describe('0.9E 损坏数据的隔离与事务式写回', () => {
  it('21. 单条订单损坏只跳过该条，其余订单与商品完好', () => {
    const payload = legacyPayload('待确认');
    const market = payload.market as { orders: Array<Record<string, unknown>> };
    market.orders.push({ id: 'broken', productId: 'p1', status: '???' });
    market.orders.push({ productId: 'p1', status: '已完成' }); // 缺少 id

    const result = migrateMockDatabase(payload, seed);
    expect(result.skippedRecords).toBe(2);
    expect(result.discarded).toBe(false);
    expect(result.db.market.orders.map((o) => o.id)).toEqual(['o1']);
    expect(result.db.users).toHaveLength(1);
    expect(result.db.market.products).toHaveLength(1);
  });

  it('22. 迁移在深拷贝上进行，失败时不产生半迁移状态', () => {
    const payload = legacyPayload('交易中');
    const snapshot = JSON.parse(JSON.stringify(payload));
    migrateMockDatabase(payload, seed);
    expect(payload).toEqual(snapshot); // 输入对象未被就地改写
  });

  it('23. 空存储（null）按初始化处理，得到全新种子且可写回', () => {
    const result = migrateMockDatabase(null, seed);
    expect(result.discarded).toBe(true);
    expect(result.persistable).toBe(true);
    expect(result.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(result.db.currentUserId).toBeNull();
  });
});

describe('0.9E 迁移在真实装载路径上生效', () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  });

  it('14. MockCampusMarketApi 装载旧负载后立即落盘迁移结果（阶段 1：未结束的旧订单随后按 V16 收尾为 EXPIRED 并留痕）', () => {
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(legacyPayload('交易中')));
    new MockCampusMarketApi();

    const persisted = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY) as string);
    expect(persisted.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    // v1→v2 保守判定为 PENDING_MEETING 并标记歧义；v12→v13 把这张未结束的订单系统关闭，留痕写明原状态
    expect(persisted.market.orders[0].legacyStatusAmbiguous).toBe(true);
    expect(persisted.market.orders[0].canonicalStatus).toBe('EXPIRED');
    expect(persisted.legacyTradeClosures).toEqual([expect.objectContaining({
      entityType: 'ORDER', entityId: 'o1', fromStatus: 'PENDING_MEETING', toStatus: 'EXPIRED', reason: 'PLATFORM_TRADE_RETIRED' })]);

    // 再装载一次：已是当前版本，落盘内容不再变化（不会重复收尾或留痕）
    new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY) as string)).toEqual(persisted);
  });

  it('15. 迁移只动自己的 key，不触碰同域其他数据', () => {
    window.localStorage.setItem('unrelated_key', 'keep-me');
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(legacyPayload('交易中')));
    new MockCampusMarketApi();
    expect(window.localStorage.getItem('unrelated_key')).toBe('keep-me');
  });

  it('16. 更高版本的负载不被旧代码覆盖', () => {
    const future = JSON.stringify({ ...legacyPayload('待确认'), schemaVersion: MOCK_SCHEMA_VERSION + 1 });
    window.localStorage.setItem(DB_STORAGE_KEY, future);
    new MockCampusMarketApi();
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBe(future);
  });
});

describe('0.9E 种子数据本身即为当前版本', () => {
  beforeEach(() => {
    const store = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', { value: { localStorage: store }, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  });

  it('25. 全新安装：所有种子订单都带 canonicalStatus 且都已结束（站内交易已停用），且不触发迁移', async () => {
    new MockCampusMarketApi();

    const persisted = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY) as string);
    expect(persisted.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    for (const order of persisted.market.orders) {
      expect(order.canonicalStatus, `订单 ${order.id} 缺少 canonicalStatus`).toBeTruthy();
      expect(['COMPLETED', 'CANCELLED', 'EXPIRED'], `订单 ${order.id} 仍未结束`).toContain(order.canonicalStatus);
    }
    expect(persisted.market.products.filter((p: { status: string }) => p.status === '预约中')).toEqual([]);

    // 第二次装载不得重复迁移
    new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY) as string)).toEqual(persisted);
  });
});
