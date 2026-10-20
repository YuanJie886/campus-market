import { describe, expect, it } from 'vitest';
import { isTerminalStatus, statusLabel } from './mapper';
import type { CanonicalOrderStatus } from '../types';

/**
 * 订单 canonical status 的纯函数映射（Mock 迁移旧数据时仍会用到）。
 *
 * <p>平台已改为只展示商品与联系方式：下单 / 接单 / 确认 / 核销 / 取消等订单接口已从
 * 前端适配层移除（CampusMarketApi 不再声明），原「Mock 订单状态机与 REST 契约一致」用例随功能一并移除；
 * 移除行为见 contactRequests.test.ts。
 */

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
