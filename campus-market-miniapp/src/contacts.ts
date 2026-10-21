/**
 * 联系申请的展示规则（纯函数，不依赖 Taro，便于测试）。
 * 状态机见 docs/contact-display-model.md：PENDING → APPROVED / REJECTED（卖家）/ WITHDRAWN（买家）；
 * APPROVED → REVOKED（卖家撤回同意）；WITHDRAWN → PENDING（买家重新申请）；REJECTED、REVOKED 是终态。
 */
import type { ContactPage, ContactRequest, ContactRole, ContactStatus, Product } from './model';

export const CONTACT_PAGE_SIZE = 20;

export const STATUS_LABEL: Record<ContactStatus, string> = {
  PENDING: '待处理', APPROVED: '已同意', REJECTED: '已拒绝', WITHDRAWN: '已撤回申请', REVOKED: '已撤回同意',
};
export const STATUS_TONE: Record<ContactStatus, 'warn' | 'ok' | 'mute'> = {
  PENDING: 'warn', APPROVED: 'ok', REJECTED: 'mute', WITHDRAWN: 'mute', REVOKED: 'mute',
};

/** 列表卡片底部的说明文字（按查看者角色）。 */
export function statusNote(role: ContactRole, status: ContactStatus): string {
  if (role === 'received') {
    return {
      PENDING: '等待你处理',
      APPROVED: '已同意，对方可以查看这件商品的联系方式',
      REJECTED: '已拒绝，对方看不到联系方式，也不能再次申请',
      WITHDRAWN: '对方已撤回申请',
      REVOKED: '已撤回同意，对方看不到联系方式，也不能再次申请',
    }[status];
  }
  return {
    PENDING: '等待卖家同意后查看联系方式',
    APPROVED: '卖家已同意，请到商品详情查看联系方式',
    REJECTED: '卖家已拒绝这次申请，不能再次申请',
    WITHDRAWN: '你已撤回申请，可以在商品详情重新申请',
    REVOKED: '卖家已撤回同意，你已看不到联系方式，不能再次申请',
  }[status];
}

export type ContactAction = 'approve' | 'reject' | 'revoke' | 'withdraw';
/** 当前角色在该状态下可以做的操作：卖家处理待处理 / 撤回同意；买家撤回待处理的申请。 */
export function availableActions(role: ContactRole, status: ContactStatus): ContactAction[] {
  if (role === 'received') return status === 'PENDING' ? ['approve', 'reject'] : status === 'APPROVED' ? ['revoke'] : [];
  return status === 'PENDING' ? ['withdraw'] : [];
}

export const CONFIRM: Record<ContactAction, { title: string; content: string; done: string }> = {
  approve: { title: '同意这次联系申请？', content: '同意后，该同学可以在商品详情查看这件商品的联系方式。之后你仍可以撤回同意。', done: '已同意联系' },
  reject: { title: '拒绝这次申请？', content: '对方不会看到你的联系方式，并且不能再次申请这件商品。', done: '已拒绝申请' },
  revoke: { title: '撤回同意？', content: '撤回后，对方会立即看不到这件商品的联系方式，并且不能再次申请。已经通过其他渠道交换的联系方式无法收回。', done: '已撤回同意' },
  withdraw: { title: '撤回这次申请？', content: '撤回后卖家不再需要处理这条申请；之后你仍可以在商品详情重新申请。', done: '已撤回申请' },
};

/** 追加下一页：按 id 去重（翻页期间列表有变化时，同一条申请可能出现在两页）。 */
export function mergeContactPage(previous: ContactRequest[], page: ContactPage, reset: boolean): ContactRequest[] {
  if (reset) return [...page.items];
  const seen = new Set(previous.map((r) => r.id));
  return [...previous, ...page.items.filter((r) => !seen.has(r.id))];
}
export const hasMoreContacts = (loaded: number, total: number) => loaded < total;

/** 未读角标文字：0 不显示，超过 99 显示 99+。 */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}

export interface ContactCta {
  /** copy：复制联系方式；request：申请 / 重新申请；none：不可操作 */
  kind: 'copy' | 'request' | 'none';
  label: string;
  disabled: boolean;
  /** 底部提示（可为空） */
  hint: string;
  /** 联系方式面板说明 */
  panel: string;
  /** 买家能否撤回这次申请 */
  canWithdraw: boolean;
}

/** 商品详情页（非本人商品）底部按钮与提示。联系方式只看商品的 contact 字段，由后端按「本人 / 公开 / 已同意」判断。 */
export function contactCta(product: Pick<Product, 'contact' | 'contactPublic' | 'status'>, request: Pick<ContactRequest, 'status'> | null): ContactCta {
  if (product.contact) {
    return { kind: 'copy', label: '复制联系方式', disabled: false, hint: '', panel: product.contactPublic ? '卖家已选择公开联系方式。' : '卖家已同意你的联系申请。', canWithdraw: false };
  }
  const onSale = product.status === '在售';
  const unavailable = `商品${product.status}，暂时无法申请`;
  switch (request?.status) {
    case 'PENDING':
      return { kind: 'none', label: '等待卖家同意', disabled: true, hint: '申请已发出，等待卖家同意；你可以撤回这次申请', panel: '联系申请已发出，等待卖家同意。', canWithdraw: true };
    case 'APPROVED':
      // 已同意却拿不到联系方式：商品被隐藏或可见范围变化，后端不再授权
      return { kind: 'none', label: '暂时无法查看', disabled: true, hint: '卖家已同意，但这件商品当前不能查看联系方式', panel: '卖家已同意你的申请，但这件商品当前不能查看联系方式。', canWithdraw: false };
    case 'REJECTED':
      return { kind: 'none', label: '卖家已拒绝', disabled: true, hint: '卖家已拒绝这次申请，不能再次申请', panel: '卖家已拒绝这次申请。', canWithdraw: false };
    case 'REVOKED':
      return { kind: 'none', label: '卖家已撤回同意', disabled: true, hint: '卖家已撤回同意，你已看不到联系方式，不能再次申请', panel: '卖家已撤回同意，联系方式不再对你展示。', canWithdraw: false };
    case 'WITHDRAWN':
      return onSale
        ? { kind: 'request', label: '重新申请', disabled: false, hint: '你已撤回申请，可以重新申请', panel: '你已撤回这次申请，可以重新申请联系。', canWithdraw: false }
        : { kind: 'none', label: '重新申请', disabled: true, hint: unavailable, panel: '你已撤回这次申请。', canWithdraw: false };
    default:
      return onSale
        ? { kind: 'request', label: '我想要', disabled: false, hint: '', panel: '卖家未公开联系方式，你可以先申请联系。', canWithdraw: false }
        : { kind: 'none', label: '我想要', disabled: true, hint: unavailable, panel: '卖家未公开联系方式。', canWithdraw: false };
  }
}

/** 发布表单「公开展示联系方式」的说明：必须如实告知勾选后的展示范围，并说明可以随时关闭。 */
export const CONTACT_PUBLIC_HELP = '打开后，联系方式会随商品一起展示在商品详情、商品列表与搜索结果、楼栋动态和需求匹配中，所有能看到这件商品的本校登录同学都能直接看到，不需要申请。可以随时关闭；关闭后只有你本人和你同意（且未撤回）的申请者能看到。';
