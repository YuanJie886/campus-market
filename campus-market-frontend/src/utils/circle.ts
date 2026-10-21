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
  '联系申请随之失效：你在这个圈子仅圈子可见的商品上的联系申请会从列表中消失，已获同意的联系方式也不再向你展示。',
];

/** 每个圈子邀请码只能用一次、只显示一次（与小程序 INVITE_ONCE_TEXT 相同） */
export const INVITE_ONCE_TEXT = '每个邀请码只能使用一次。邀请码只在生成后显示这一次，平台不保存原文，丢失后请重新生成。';
