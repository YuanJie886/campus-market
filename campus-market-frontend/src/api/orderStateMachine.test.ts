import { beforeEach, describe, expect, it } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { isTerminalStatus, statusLabel } from './mapper';
import type { CanonicalOrderStatus } from './contracts';
import { fullDisclosure, submitAllMatch } from '../test/inspectionFixtures';

/**
 * Mock 订单状态机的契约测试（0.7B）。
 *
 * <p>改造前 Mock 把 canonical status 降维成中文文案再判断迁移：
 * `fromCanonicalStatus('BUYER_CONFIRMED')` 得到「交易中」，而订单此时已经是「交易中」，
 * `allowed['交易中']` 不含「交易中」，于是**买家确认必然 409**——Mock 模式下
 * 整条交易链在这一步就断了。
 *
 * <p>现在 Mock 内部只保存 canonical status，中文文案仅由 `statusLabel()` 单向派生。
 * 本文件的迁移用例表与后端 `OrderTransitionExecutor.execute()` 的 allowed 判定逐条对应，
 * 作为 Mock/REST 之间的显式契约（跨 Java/TypeScript 无法共享文件，故两侧各自保留显式契约测试）。
 */

/** 内存 localStorage，供 TokenStore 与 MockDatabase 在 node 环境下运行。 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

/**
 * 与后端 allowed 判定一一对应的迁移用例表。
 * actor 为发起方角色，expected 为是否允许。
 */
const TRANSITION_MATRIX: ReadonlyArray<{
  from: CanonicalOrderStatus;
  to: CanonicalOrderStatus;
  actor: 'buyer' | 'seller';
  allowed: boolean;
  note: string;
}> = [
  { from: 'PENDING_SELLER_CONFIRM', to: 'PENDING_MEETING', actor: 'seller', allowed: true, note: '卖家接单' },
  { from: 'PENDING_SELLER_CONFIRM', to: 'PENDING_MEETING', actor: 'buyer', allowed: false, note: '买家不能替卖家接单' },
  { from: 'PENDING_SELLER_CONFIRM', to: 'CANCELLED', actor: 'buyer', allowed: true, note: '早期买家可取消' },
  { from: 'PENDING_SELLER_CONFIRM', to: 'CANCELLED', actor: 'seller', allowed: true, note: '早期卖家可取消' },
  { from: 'PENDING_MEETING', to: 'BUYER_CONFIRMED', actor: 'buyer', allowed: true, note: '买家确认（改造前必然 409）' },
  { from: 'PENDING_MEETING', to: 'BUYER_CONFIRMED', actor: 'seller', allowed: false, note: '卖家不能替买家确认' },
  { from: 'PENDING_MEETING', to: 'CANCELLED', actor: 'seller', allowed: true, note: '面交前卖家可取消' },
  { from: 'BUYER_CONFIRMED', to: 'COMPLETED', actor: 'seller', allowed: true, note: '卖家凭正确确认码核销' },
  { from: 'BUYER_CONFIRMED', to: 'COMPLETED', actor: 'buyer', allowed: false, note: '买家不能自行核销' },
  { from: 'BUYER_CONFIRMED', to: 'CANCELLED', actor: 'buyer', allowed: true, note: '0.7A：买家带原因可取消' },
  { from: 'BUYER_CONFIRMED', to: 'CANCELLED', actor: 'seller', allowed: false, note: '0.7A：卖家没有这条通道' },
  { from: 'COMPLETED', to: 'CANCELLED', actor: 'buyer', allowed: false, note: '终态不可再迁移' },
  { from: 'CANCELLED', to: 'COMPLETED', actor: 'seller', allowed: false, note: '终态不可再迁移' },
];

describe('Mock 订单状态机与 REST 契约一致', () => {
  let api: MockCampusMarketApi;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
    api = new MockCampusMarketApi();
  });

  /** 注册卖家与买家，发布商品并下单，返回可继续推进的上下文。 */
  async function newOrder() {
    const seller = await api.register({
      account: `seller-${Math.random().toString(36).slice(2)}`,
      password: 'test-password', nickname: '卖家', campus: '东校区', contact: '13800000000',
    });
    const product = await api.createProduct({
      title: '状态机测试商品', description: '仅供 Mock 契约测试', price: 10,
      category: '生活用品', condition: '全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '13800000000',
      inspection: fullDisclosure('生活用品'),
    });
    const buyer = await api.register({
      account: `buyer-${Math.random().toString(36).slice(2)}`,
      password: 'test-password', nickname: '买家', campus: '东校区', contact: '13800000001',
    });
    const order = await api.createOrder({
      productId: product.id, meetingPointId: '东校区-library',
      meetingAtIso: new Date(Date.now() + 86_400_000).toISOString(),
      contact: '13800000001', idempotencyKey: Math.random().toString(36).slice(2),
    });
    return { seller, buyer, product, order };
  }

  async function loginAs(actor: { user: { account: string } }) {
    await api.login({ account: actor.user.account, password: 'test-password' });
  }

  it('下单后 canonical status 为 PENDING_SELLER_CONFIRM，商品锁为预约中', async () => {
    const { order, product } = await newOrder();
    expect(order.canonicalStatus).toBe('PENDING_SELLER_CONFIRM');
    expect(order.status).toBe('待确认');
    expect((await api.getProduct(product.id)).status).toBe('预约中');
  });

  it('完整成功链：卖家接单 → 买家确认 → 卖家核销完成', async () => {
    const { seller, buyer, product, order } = await newOrder();

    await loginAs(seller);
    const accepted = await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    expect(accepted.canonicalStatus).toBe('PENDING_MEETING');
    expect(accepted.status).toBe('交易中');

    await loginAs(buyer);
    // 改造前这一步必然抛 409
    await submitAllMatch(api, order.id);
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    expect(confirmed.canonicalStatus).toBe('BUYER_CONFIRMED');
    expect(confirmed.status).toBe('交易中');

    await loginAs(seller);
    const done = await api.transitionOrder(order.id, {
      to: 'COMPLETED', confirmationCode: confirmed.confirmationCode!,
    });
    expect(done.canonicalStatus).toBe('COMPLETED');
    expect(done.status).toBe('已完成');
    expect((await api.getProduct(product.id)).status).toBe('已售出');
  });

  it('核销码缺失 / 格式非法 / 错误分别被拒，且订单不完成', async () => {
    const { seller, buyer, order } = await newOrder();
    await loginAs(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await loginAs(buyer);
    await submitAllMatch(api, order.id);
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await loginAs(seller);

    await expect(api.transitionOrder(order.id, { to: 'COMPLETED' })).rejects.toMatchObject({ code: 400 });
    await expect(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: '  ' }))
      .rejects.toMatchObject({ code: 400 });
    await expect(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: 'abc' }))
      .rejects.toMatchObject({ code: 400 });
    const wrong = confirmed.confirmationCode === '000000' ? '000001' : '000000';
    await expect(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: wrong }))
      .rejects.toMatchObject({ code: 400 });

    const orders = await api.listOrders('all');
    expect(orders.find((o) => o.id === order.id)?.canonicalStatus).toBe('BUYER_CONFIRMED');
  });

  it('BUYER_CONFIRMED：买家带原因可取消，商品恢复在售', async () => {
    const { seller, buyer, product, order } = await newOrder();
    await loginAs(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await loginAs(buyer);
    await submitAllMatch(api, order.id);
    await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });

    // 模块 7：卖家确认之后的取消必须带结构化原因
    const cancelled = await api.transitionOrder(order.id, { to: 'CANCELLED', reasonCode: 'SCHEDULE_CONFLICT', reason: '临时有事' });
    expect(cancelled.canonicalStatus).toBe('CANCELLED');
    expect((await api.getProduct(product.id)).status).toBe('在售');
  });

  it('BUYER_CONFIRMED：买家缺原因 400，卖家取消 409', async () => {
    const { seller, buyer, order } = await newOrder();
    await loginAs(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await loginAs(buyer);
    await submitAllMatch(api, order.id);
    await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });

    await expect(api.transitionOrder(order.id, { to: 'CANCELLED' })).rejects.toMatchObject({ code: 400 });
    await expect(api.transitionOrder(order.id, { to: 'CANCELLED', reason: '   ' }))
      .rejects.toMatchObject({ code: 400 });

    await loginAs(seller);
    await expect(api.transitionOrder(order.id, { to: 'CANCELLED', reason: '不想卖了' }))
      .rejects.toMatchObject({ code: 409 });
  });

  it('完成后不能再取消', async () => {
    const { seller, buyer, order } = await newOrder();
    await loginAs(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await loginAs(buyer);
    await submitAllMatch(api, order.id);
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await loginAs(seller);
    await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! });

    await loginAs(buyer);
    await expect(api.transitionOrder(order.id, { to: 'CANCELLED', reason: '反悔' }))
      .rejects.toMatchObject({ code: 409 });
  });

  it.each(TRANSITION_MATRIX)(
    '迁移矩阵：$from → $to（$actor）应 $allowed —— $note',
    async ({ from, to, actor, allowed }) => {
      const { seller, buyer, order } = await newOrder();

      // 把订单推进到 from 状态
      let code = order.confirmationCode;
      if (from !== 'PENDING_SELLER_CONFIRM') {
        await loginAs(seller);
        await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
      }
      if (from === 'BUYER_CONFIRMED' || from === 'COMPLETED') {
        await loginAs(buyer);
        await submitAllMatch(api, order.id);
        code = (await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' })).confirmationCode;
      }
      if (from === 'COMPLETED') {
        await loginAs(seller);
        await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: code! });
      }
      if (from === 'CANCELLED') {
        await loginAs(buyer);
        await api.transitionOrder(order.id, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND' });
      }

      await loginAs(actor === 'buyer' ? buyer : seller);
      // 买家确认前的验货前置条件；卖家或其他起点仍按原矩阵判定
      if (to === 'BUYER_CONFIRMED' && actor === 'buyer') await submitAllMatch(api, order.id);
      const input = {
        to,
        reason: '契约测试原因',
        ...(to === 'COMPLETED' ? { confirmationCode: code } : {}),
        ...(to === 'CANCELLED' ? { reasonCode: 'CHANGED_MIND' as const } : {}),
      };

      if (allowed) {
        const result = await api.transitionOrder(order.id, input);
        expect(result.canonicalStatus).toBe(to);
      } else {
        await expect(api.transitionOrder(order.id, input)).rejects.toMatchObject({ code: 409 });
      }
    },
  );
});

describe('canonical status 是唯一真值', () => {
  it('statusLabel 覆盖全部 canonical 值，且为单向映射', () => {
    const all: CanonicalOrderStatus[] = [
      'PENDING_SELLER_CONFIRM', 'PENDING_MEETING', 'BUYER_CONFIRMED', 'SELLER_CONFIRMED',
      'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED',
    ];
    all.forEach((s) => expect(statusLabel(s)).toBeTruthy());
    // 「交易中」对应 4 个 canonical 值 —— 正因如此反向映射不可用于状态判断
    expect(all.filter((s) => statusLabel(s) === '交易中')).toHaveLength(4);
  });

  it('isTerminalStatus 只认 canonical 终态', () => {
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(isTerminalStatus('EXPIRED')).toBe(true);
    expect(isTerminalStatus('BUYER_CONFIRMED')).toBe(false);
    expect(isTerminalStatus('PENDING_MEETING')).toBe(false);
  });
});
