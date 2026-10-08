import type { CircleRole, CircleType, CircleVisibility } from '../api/contracts';

/**
 * 模块 6 的展示文案。业务判断只看机器码（type / role / visibility / status），中文只用于展示。
 * 所有圈子都是用户创建的：界面固定标注「用户创建」，从不出现「官方」「认证」一类说法。
 */
export const CIRCLE_TYPE_LABEL: Record<CircleType, string> = { CLASS: '班级', CLUB: '社团', INTEREST: '兴趣', OTHER: '其他' };
export const CIRCLE_ROLE_LABEL: Record<CircleRole, string> = { OWNER: '所有者', MODERATOR: '管理员', MEMBER: '成员' };
export const CIRCLE_VISIBILITY_LABEL: Record<CircleVisibility, string> = {
  PRIVATE: '私密（只有成员知道这个圈子）',
  DISCOVERABLE: '可发现（本校同学能看到名称和简介，仍需邀请加入）',
};
export const USER_CREATED_TEXT = '用户创建';
export const USER_CREATED_NOTE = '圈子由同学自己创建和管理，不代表学校或任何组织。';

/** 退出圈子前必须说清楚的后果 */
export const LEAVE_CONSEQUENCES = [
  '圈子订阅将停用：你绑定这个圈子的需求订阅不再匹配，相关提醒清零；',
  '私密商品将不可见：这个圈子里仅圈子可见的商品你将看不到；',
  '已经成立的订单不受影响，仍然可以照常完成。',
];

/** 圈子邀请链接：邀请码放在 # 之后，不会发送给服务器，也不会出现在访问日志里 */
export function circleInviteLink(origin: string, token: string): string {
  return `${origin}/circles/join#code=${encodeURIComponent(token)}`;
}
