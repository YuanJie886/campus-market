/**
 * 圈子邀请码在登录前后的暂存：只放在本次运行的内存里，不写本地存储、不放进页面路径或登录回跳地址；
 * 登录回到加入页时自动填入，但仍然要用户点击「加入」才会兑换。小程序关闭后丢失，这是刻意的安全取舍。
 */
let pending: string | null = null;
export const holdPendingInvite = (token: string) => { pending = token; };
export const peekPendingInvite = () => pending;
export const clearPendingInvite = () => { pending = null; };
