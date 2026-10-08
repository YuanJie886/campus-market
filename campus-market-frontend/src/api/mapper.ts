import type { Product, Order, OrderStatus, User } from '../types';
import type { CanonicalOrderStatus } from './contracts';
export function toIso(value: number | string | undefined): string | undefined { if (value === undefined) return undefined; return typeof value === 'number' ? new Date(value).toISOString() : value }
export function fromIso(value: string | number | undefined): number { if (value === undefined) return Date.now(); return typeof value === 'number' ? value : Date.parse(value) || Date.now() }
export function projectPublicUser(user: User): Omit<User, 'password'> { const { password: _password, ...safe } = user; return safe }
export function mapProductDates(product: Product & { createdAtIso?: string; soldAtIso?: string }): Product { return { ...product, createdAt: fromIso(product.createdAtIso ?? product.createdAt), soldAt: product.soldAtIso ? fromIso(product.soldAtIso) : product.soldAt } }

/**
 * canonical status 是唯一契约真值（与后端 OrderTransitionExecutor 一致）。
 * 下面只有「canonical → 中文展示文案」这一个方向的映射；
 * 中文文案仅用于界面显示，绝不可反向参与任何状态判断或状态机迁移。
 */
const canonicalToLabel: Record<CanonicalOrderStatus, OrderStatus> = {
  PENDING_SELLER_CONFIRM: '待确认',
  PENDING_MEETING: '交易中',
  BUYER_CONFIRMED: '交易中',
  SELLER_CONFIRMED: '交易中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXPIRED: '已取消',
  DISPUTED: '交易中',
};

/** canonical status → 中文展示文案。单向，不可逆。 */
export function statusLabel(status: CanonicalOrderStatus): OrderStatus { return canonicalToLabel[status] }

/** 订单是否已进入终态，唯一依据 canonical status。 */
export function isTerminalStatus(status: CanonicalOrderStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'EXPIRED';
}
