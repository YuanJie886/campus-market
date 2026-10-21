import type { MessageTemplate } from '../contracts';

/**
 * 离线演示的私信快捷消息：与后端的模板逐字相同、顺序相同。
 * 文字私信默认关闭（人工审核暂不可用），只能发送这些预设内容；交换联系方式走「申请联系方式」。
 */
export const MOCK_MESSAGE_TEMPLATES: readonly MessageTemplate[] = /* @__PURE__ */ Object.freeze([
  { code: 'BUYER_STILL_AVAILABLE', text: '你好，这件还在吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_CONDITION', text: '可以再介绍一下成色和使用情况吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_PRICE', text: '价格还有商量的空间吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_PHOTOS', text: '方便在商品里补充几张实物照片吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_CONTACT', text: '我想要这件，已在商品页申请联系方式，麻烦同意一下。', role: 'BUYER' },
  { code: 'SELLER_AVAILABLE', text: '还在的，可以在商品页申请联系方式。', role: 'SELLER' },
  { code: 'SELLER_SOLD', text: '不好意思，已经出了。', role: 'SELLER' },
  { code: 'SELLER_PRICE_FIRM', text: '价格不议，谢谢理解。', role: 'SELLER' },
  { code: 'SELLER_PRICE_NEGOTIABLE', text: '价格可以商量，交换联系方式后细聊。', role: 'SELLER' },
  { code: 'SELLER_CONTACT_VIA_REQUEST', text: '请在商品页点「申请联系方式」，我同意后你就能看到。', role: 'SELLER' },
  { code: 'SELLER_PHOTOS_ADDED', text: '照片已补充，刷新商品页就能看到。', role: 'SELLER' },
  { code: 'ANY_THANKS', text: '好的，谢谢！', role: 'ANY' },
  { code: 'ANY_LATER', text: '稍等，我晚点回复你。', role: 'ANY' },
] as MessageTemplate[]);

/** 与后端相同的 400 原话 */
export const TEMPLATE_NOT_FOUND = '快捷消息不存在';
export const TEMPLATE_WRONG_ROLE = '这条快捷消息不能由你发送';
export const FREE_TEXT_DISABLED = '私信目前只能发送预设的快捷消息';
export const TEMPLATE_OR_TEXT = '只能二选一：快捷消息或文字';
/** 文字关闭时既没有 templateCode 也没有 content */
export const TEMPLATE_REQUIRED = '请选择一条快捷消息';
