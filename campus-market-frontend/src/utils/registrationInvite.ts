import { formatInviteCodeInput } from '../api/contracts';

/**
 * 注册邀请链接：/register#invite=CODE。
 *
 * <p>邀请码放在 URL 片段（#）而不是查询参数里：片段不会随请求发给服务器，因此不会出现在 Nginx / 后端访问日志、
 * Referer 里。注册页读到后立即从地址栏删掉（history.replaceState），刷新、复制地址或截图都不会再带出邀请码。
 * 邀请码只预填进输入框，仍然要用户自己点「注册并登录」才会提交。
 */
const INVITE_FRAGMENT = /^#invite=([^&#]*)$/;

/** 是不是邀请片段（无论内容是否有效，都应该从地址栏删掉） */
export function isInviteFragment(hash: string): boolean {
  return hash.startsWith('#invite=');
}

/** 从片段里取出邀请码并整理成显示格式；只接受字母、数字、空格与短横线（最长 64 个字符），其他内容一律忽略 */
export function inviteCodeFromFragment(hash: string): string | null {
  const match = INVITE_FRAGMENT.exec(hash);
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    return null;
  }
  if (!value || value.length > 64 || !/^[A-Za-z0-9 -]+$/.test(value)) return null;
  return formatInviteCodeInput(value) || null;
}

/** 从当前地址栏删掉邀请片段（保留路径、查询参数与路由状态） */
export function stripInviteFragment(): void {
  if (typeof window === 'undefined' || !isInviteFragment(window.location.hash)) return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}
