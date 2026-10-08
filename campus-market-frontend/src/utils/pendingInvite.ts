/**
 * 模块 6.1B：未登录打开圈子邀请链接时，邀请码在「去登录 → 回到邀请页」之间的暂存。
 *
 * <p>只保存在当前页面进程的内存里（一个模块级变量）：
 * <ul>
 *   <li>不写 localStorage / sessionStorage / IndexedDB / Cookie，不进入 URL query，不打印日志；</li>
 *   <li>刷新页面、关闭标签页后自然丢失——这是刻意的安全取舍，界面会提前说明；</li>
 *   <li>每个标签页各有一份，不会在标签页之间传播；</li>
 *   <li>登录或注册失败、离开登录流程、退出登录、成功加入后立即清除；</li>
 *   <li>取回邀请码只是把它填进输入框，仍然要用户点击确认才会兑换，不会登录即自动加入。</li>
 * </ul>
 */
let pending: string | null = null;

/** 登录流程中允许保留邀请码的页面 */
export const INVITE_FLOW_PATHS: readonly string[] = ['/login', '/register', '/circles/join'];

export function holdPendingInvite(token: string): void {
  pending = token;
}

export function peekPendingInvite(): string | null {
  return pending;
}

export function hasPendingInvite(): boolean {
  return pending !== null;
}

export function clearPendingInvite(): void {
  pending = null;
}
