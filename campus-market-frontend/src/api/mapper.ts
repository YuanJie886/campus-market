import type { Product, Order, OrderStatus, User } from '../types';
import type { CanonicalOrderStatus } from './contracts';
export function toIso(value: number | string | undefined): string | undefined { if (value === undefined) return undefined; return typeof value === 'number' ? new Date(value).toISOString() : value }
export function fromIso(value: string | number | undefined): number { if (value === undefined) return Date.now(); return typeof value === 'number' ? value : Date.parse(value) || Date.now() }
export function projectPublicUser(user: User): Omit<User, 'password'> { const { password: _password, ...safe } = user; return safe }
const statusToCanonical: Record<OrderStatus, CanonicalOrderStatus> = { '待确认': 'PENDING_SELLER_CONFIRM', '交易中': 'PENDING_MEETING', '已完成': 'COMPLETED', '已取消': 'CANCELLED' };
const canonicalToStatus: Record<CanonicalOrderStatus, OrderStatus> = { PENDING_SELLER_CONFIRM: '待确认', PENDING_MEETING: '交易中', BUYER_CONFIRMED: '交易中', SELLER_CONFIRMED: '交易中', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已取消', DISPUTED: '交易中' };
export function toCanonicalStatus(status: OrderStatus): CanonicalOrderStatus { return statusToCanonical[status] }
export function fromCanonicalStatus(status: CanonicalOrderStatus): OrderStatus { return canonicalToStatus[status] }
export function mapProductDates(product: Product & { createdAtIso?: string; soldAtIso?: string }): Product { return { ...product, createdAt: fromIso(product.createdAtIso ?? product.createdAt), soldAt: product.soldAtIso ? fromIso(product.soldAtIso) : product.soldAt } }
