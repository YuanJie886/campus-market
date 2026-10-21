/**
 * 试点期邀请注册的纯规则（不依赖 Taro，便于测试）。
 * 契约：GET /v1/config 的 registration.inviteRequired 为 true 时，POST /v1/auth/register 必须带 inviteCode；
 * 邀请码格式 XXXX-XXXX-XXXX（字母表 ABCDEFGHJKMNPQRSTUVWXYZ23456789），后端会忽略大小写、空格与短横线。
 * 这里没有任何演示邀请码：演示邀请码只在 api/mockRules.ts（只会打进演示构建）。
 */
import type { ClientConfig } from './model';
import { ApiError } from './api/transport';

export const INVITE_LABEL = '邀请码';
export const INVITE_HELP = '目前为小范围测试，需要学校工作人员发放的邀请码';
export const INVITE_PLACEHOLDER = 'XXXX-XXXX-XXXX';
/** 后端 400 原文（客户端只在未填写时自己提示同一句话，其余以后端为准）。 */
export const INVITE_REQUIRED_MESSAGE = '请输入邀请码';
export const INVITE_INVALID_MESSAGE = '邀请码无效或已用完';
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 12 个有效字符，每 4 个一组。 */
export const INVITE_CODE_LENGTH = 12;
/** 输入框原始长度上限：允许粘贴带空格、短横线的写法，归一化后最多 12 个字符。 */
export const INVITE_INPUT_MAXLENGTH = 32;

/** 是否需要邀请码：配置还没读到（null）或旧后端没有这一项时按不需要处理。 */
export const inviteRequired = (config: Pick<ClientConfig, 'registration'> | null | undefined) => config?.registration?.inviteRequired === true;

/** 注册表单里的邀请码输入框：只在需要邀请码时显示，且为必填。 */
export function inviteField(config: Pick<ClientConfig, 'registration'> | null | undefined) {
  const required = inviteRequired(config);
  return { visible: required, required, label: INVITE_LABEL, help: INVITE_HELP, placeholder: INVITE_PLACEHOLDER };
}

/**
 * 显示用的归一化：全角转半角、转大写，去掉空格、短横线以及其他非字母数字（例如粘贴时带上的「邀请码：」），
 * 最多保留 12 个字符，按 XXXX-XXXX-XXXX 分组。不在字母表里的字母数字（0、1、I、L、O）保留，交给后端判定。
 */
export function normalizeInviteCode(raw: string | null | undefined): string {
  const compact = String(raw ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH);
  return compact.match(/.{1,4}/g)?.join('-') ?? '';
}

/**
 * 页面参数 invite（例如分享出来的小程序路径 /pages/login/index?invite=ABCD-EFGH-JKMN）：
 * 原生页面参数可能仍是 URI 编码，先尝试解码，再按显示格式归一化；没有或为空时返回空串。
 */
export function inviteCodeFromParams(params: Record<string, string | undefined> | null | undefined): string {
  const raw = params?.invite;
  if (typeof raw !== 'string' || !raw) return '';
  let decoded = raw;
  try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { decoded = raw; }
  return normalizeInviteCode(decoded);
}

/** 登录页的初始状态：带了邀请码参数就直接进入注册模式并预填；否则停在登录。 */
export function loginEntryFromParams(params: Record<string, string | undefined> | null | undefined): { register: boolean; inviteCode: string } {
  const inviteCode = inviteCodeFromParams(params);
  return { register: Boolean(inviteCode), inviteCode };
}

/** 后端说「请输入邀请码」：说明本地的配置已过期（后端已改为需要邀请码），应重新读取 /v1/config 以显示输入框。 */
export const isInviteRequiredError = (error: unknown) => error instanceof ApiError && error.code === 400 && error.message === INVITE_REQUIRED_MESSAGE;
