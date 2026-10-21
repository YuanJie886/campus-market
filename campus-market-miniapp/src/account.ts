/**
 * 阶段 3 账号生命周期的纯规则（不依赖 Taro，便于测试）：修改密码、凭重置码找回、注销、微信登录与绑定。
 * 接口与文案依据 docs/account-lifecycle.md 与后端 AccountService。
 */
import type { Campus, MarketApi } from './model';
import { ApiError } from './api/transport';
import { REGISTRATION_CAMPUS_REQUIRED } from './schools';

/** 与后端 AuthService.string(…, 8, 72) 一致：后端先去掉首尾空白再计长度。 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const DELETE_CONFIRMATION = '确认注销';
export const PASSWORD_CHANGED_MESSAGE = '已修改，其他设备已退出';
export const WECHAT_BOUND_MESSAGE = '已绑定微信，下次可以一键登录';
export const WECHAT_DISABLED_MESSAGE = '微信登录尚未开通';
export const WECHAT_INVALID_CODE_MESSAGE = '微信登录凭证无效或已过期，请重试';
export const RESET_HELP = '请联系本校学校管理员核对身份后获取一次性重置码，30 分钟内有效';
/** 与后端 wechat_bind_tickets 的 10 分钟有效期一致。 */
export const BIND_TICKET_TTL_MS = 10 * 60 * 1000;

/** 注销会做什么（docs/account-lifecycle.md §3 的简写）。 */
export const DELETION_EFFECTS = [
  '在售商品全部下架；你的所有商品清除联系方式并取消「公开」',
  '你发出的待处理联系申请撤回；收到的待处理申请拒绝；已同意的申请撤回同意',
  '退出所有圈子，停用需求订阅，撤销协助邀请',
  '解除微信绑定，所有设备上的登录全部结束',
  '资料匿名化：昵称改为「已注销用户」，头像、联系方式、宿舍楼清空，原账号不能再登录',
  '原账号名可以重新注册，但那是一个全新的账号，无法找回原来的内容',
] as const;
/** 注销后仍会保留的记录。 */
export const DELETION_KEPT = [
  '已售出商品的标题与描述、留言与私信正文（对方的历史记录）',
  '治理案件、举报、处理与限制记录（合规与申诉需要）',
  '这些记录里你会显示为「已注销用户」',
] as const;
/** 后端会 409 拒绝的前置条件，需先处理。 */
export const DELETION_BLOCKERS = [
  '仍有后台工作人员权限：先请学校管理员停用',
  '仍是在用圈子的所有者：先移交所有者或归档圈子',
] as const;

const length = (value: string) => value.trim().length;

/** 新密码长度（8–72 位，首尾空白不计）。 */
export function newPasswordError(value: string): string | null {
  const n = length(value);
  return n < PASSWORD_MIN || n > PASSWORD_MAX ? `新密码需要 ${PASSWORD_MIN}–${PASSWORD_MAX} 位` : null;
}

export function changePasswordError(input: { current: string; next: string; repeat: string }): string | null {
  if (!length(input.current)) return '请输入当前密码';
  const error = newPasswordError(input.next); if (error) return error;
  if (input.next !== input.repeat) return '两次输入的新密码不一致';
  if (input.next.trim() === input.current.trim()) return '新密码不能与当前密码相同';
  return null;
}

/** 重置码 XXXX-XXXX-XXXX：后端不区分大小写、可省略短横线，这里只检查不为空、不超长。 */
export function resetPasswordError(input: { account: string; code: string; next: string; repeat: string }): string | null {
  if (!length(input.account) || length(input.account) > 64) return '请输入要找回的账号';
  if (!length(input.code) || length(input.code) > 40) return '请输入学校管理员提供的重置码';
  const error = newPasswordError(input.next); if (error) return error;
  if (input.next !== input.repeat) return '两次输入的新密码不一致';
  return null;
}

/** 确认语必须与后端完全一致（首尾空白不计）。 */
export const isDeletionConfirmed = (text: string) => text.trim() === DELETE_CONFIRMATION;

export function deletionError(input: { password: string; confirmation: string }): string | null {
  if (!length(input.password)) return '请输入当前密码';
  if (!isDeletionConfirmed(input.confirmation)) return `请输入「${DELETE_CONFIRMATION}」确认注销`;
  return null;
}

/**
 * 微信登录未绑定时拿到的绑定票据：只放在内存里（不写入任何本地存储），10 分钟内有效，取出即作废（一次性）。
 */
export class BindTicketStore {
  private ticket = '';
  private expiresAt = 0;
  constructor(private readonly now: () => number = () => Date.now()) {}
  hold(ticket: string) { this.ticket = ticket; this.expiresAt = this.now() + BIND_TICKET_TTL_MS; }
  get pending() { if (this.ticket && this.now() >= this.expiresAt) this.clear(); return Boolean(this.ticket); }
  /** 取出并作废；过期或没有时返回 null。 */
  take(): string | null { const ticket = this.pending ? this.ticket : null; this.clear(); return ticket; }
  clear() { this.ticket = ''; this.expiresAt = 0; }
}
/** 本次运行期间唯一的一份待绑定票据。 */
export const pendingWechatBind = new BindTicketStore();

/**
 * 账号密码登录 / 注册成功后调用：有待绑定的微信就立即绑定。返回要提示的文案（没有待绑定时为 null）。
 * 绑定失败不影响已经成功的登录，只提示原因（例如「这个账号已经绑定了微信，请先解除绑定」）。
 */
export async function bindPendingWechat(api: Pick<MarketApi, 'wechatBind'>, store: BindTicketStore = pendingWechatBind): Promise<string | null> {
  const ticket = store.take();
  if (!ticket) return null;
  try { await api.wechatBind(ticket); return WECHAT_BOUND_MESSAGE; }
  catch (error) { return error instanceof Error && error.message ? error.message : '微信绑定失败，请稍后在登录页重试'; }
}

/** 微信登录失败时：未开通（503「微信登录尚未开通」）隐藏按钮；凭证无效（400）提示重试；其余原样提示。 */
export function wechatLoginFailure(error: unknown): { hide: boolean; message: string } {
  const message = error instanceof Error && error.message ? error.message : '微信登录失败，请重试';
  if (error instanceof ApiError && error.code === 503 && message === WECHAT_DISABLED_MESSAGE) return { hide: true, message };
  if (error instanceof ApiError && error.code === 400) return { hide: false, message: WECHAT_INVALID_CODE_MESSAGE };
  return { hide: false, message };
}

// ---------------- 注册：必须先勾选「已阅读并同意《用户协议》和《隐私政策》」 ----------------
export const AGREEMENT_REQUIRED_MESSAGE = '请先阅读并勾选同意《用户协议》和《隐私政策》';
export interface RegistrationInput { account: string; password: string; nickname: string; campus: Campus; contact: string }

/** 注册表单检查；没有勾选同意时不能注册。 */
export function registrationError(input: RegistrationInput, agreed: boolean): string | null {
  if (!input.account.trim() || !input.password || !input.nickname.trim() || input.password.length < PASSWORD_MIN) return '请填写账号、密码和注册资料';
  // 校区来自 GET /v1/schools：先选学校再选校区，提交校区 id
  if (!input.campus) return REGISTRATION_CAMPUS_REQUIRED;
  if (!agreed) return AGREEMENT_REQUIRED_MESSAGE;
  return null;
}

/**
 * 注册：检查通过（含已勾选同意）才调用接口。请求体只含后端注册白名单字段，不附带「已同意」之类的额外字段
 * （后端对未知字段一律 400）。
 */
export async function registerAccount(api: Pick<MarketApi, 'register'>, input: RegistrationInput, agreed: boolean) {
  const error = registrationError(input, agreed);
  if (error) throw new Error(error);
  return api.register({ account: input.account.trim(), password: input.password, nickname: input.nickname.trim(), campus: input.campus, contact: input.contact.trim() });
}
