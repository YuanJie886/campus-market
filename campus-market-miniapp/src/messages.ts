/**
 * 私信的展示规则（纯函数，不依赖 Taro，便于测试）。
 * 阶段 1：人工复核还没有上线，私信只能发送预设的快捷消息（GET /v1/message-templates）；
 * BUYER_* 只能由买家发送、SELLER_* 只能由卖家发送、ANY_* 双方都可以。自由文字只在服务端 freeTextEnabled 时开放。
 * 旧版的自由文字消息（templateCode 为 null）仍然照常显示。
 */
import type { ChatMessage, Conversation, MessageTemplate, TemplateRole } from './model';

export const QUICK_ONLY_NOTE = '为保护双方安全，私信目前只能发送快捷消息；交换联系方式请使用「申请联系方式」';
/** 与后端逐字一致的三条 400 文案（界面原样显示）。 */
export const TEMPLATE_NOT_FOUND = '快捷消息不存在';
export const TEMPLATE_WRONG_ROLE = '这条快捷消息不能由你发送';
export const FREE_TEXT_DISABLED = '私信目前只能发送预设的快捷消息';
/** 消息轮询：会话页 5 秒、会话列表 15 秒，只在页面显示时进行（与 Web 相同）。 */
export const THREAD_POLL_MS = 5000;
export const LIST_POLL_MS = 15000;

/** 与后端一致的快捷消息（顺序即显示顺序）；演示模式与测试使用。 */
export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
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
];

/** 我在这个会话里的身份；不是会话成员时为 null。 */
export function conversationRole(conversation: Pick<Conversation, 'buyerId' | 'sellerId'>, userId: string): Exclude<TemplateRole, 'ANY'> | null {
  if (conversation.buyerId === userId) return 'BUYER';
  if (conversation.sellerId === userId) return 'SELLER';
  return null;
}

/** 当前身份可以发送的快捷消息：本身份的 + ANY，保持服务端给出的顺序。 */
export function templatesFor(templates: readonly MessageTemplate[], role: Exclude<TemplateRole, 'ANY'> | null): MessageTemplate[] {
  if (!role) return [];
  return templates.filter((t) => t.role === role || t.role === 'ANY');
}

/** 一条消息的显示文字：被隔离的显示占位；快捷消息正文缺失时用模板文字补上；旧版自由文字原样显示。 */
export function messageText(message: Pick<ChatMessage, 'content' | 'quarantined' | 'templateCode'>, mine: boolean, templates: readonly MessageTemplate[] = MESSAGE_TEMPLATES): string {
  if (message.quarantined) return mine ? '你发送的这条消息已被平台隔离，对方看不到内容；可以在「我的限制」里申诉。' : '该消息已被平台隔离。';
  if (message.content) return message.content;
  if (message.templateCode) return templates.find((t) => t.code === message.templateCode)?.text ?? '';
  return '';
}

/** 可以举报的消息：对方发来、且没有被隔离的。 */
export const canReportMessage = (message: Pick<ChatMessage, 'senderId' | 'quarantined'>, userId: string) => message.senderId !== userId && !message.quarantined;

/** 会话的另一方。 */
export const counterpartOf = (conversation: Pick<Conversation, 'buyerId' | 'sellerId'>, userId: string) => conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;

/** 合并新一轮读取的消息：按 id 去重、按时间排序（轮询与发送可能同时返回同一条）。 */
export function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...previous, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** 会话页底部输入区：自由文字输入框只在服务端开通时显示。 */
export function composerMode(freeTextEnabled: boolean): { quick: true; freeText: boolean; note: string } {
  return { quick: true, freeText: freeTextEnabled, note: freeTextEnabled ? '' : QUICK_ONLY_NOTE };
}
