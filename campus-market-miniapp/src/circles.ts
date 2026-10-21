/**
 * 圈子的展示文案与规则（纯函数，不依赖 Taro，便于测试），与 Web utils/circle.ts、圈子各页一致。
 * 业务判断只看机器码（type / role / visibility / status），中文只用于展示。所有圈子都是用户创建的：
 * 界面固定标注「用户创建」，从不出现「官方」「认证」一类说法。
 */
import { CIRCLE_MAX_PER_PRODUCT, type Circle, type CircleInvite, type CircleMember, type CircleRole, type CircleType, type CircleVisibility, type DiscoverableCircle, type ProductVisibility } from './model';

export const CIRCLE_TYPES: CircleType[] = ['CLASS', 'CLUB', 'INTEREST', 'OTHER'];
export const CIRCLE_TYPE_LABEL: Record<CircleType, string> = { CLASS: '班级', CLUB: '社团', INTEREST: '兴趣', OTHER: '其他' };
export const CIRCLE_ROLE_LABEL: Record<CircleRole, string> = { OWNER: '所有者', MODERATOR: '管理员', MEMBER: '成员' };
export const CIRCLE_VISIBILITIES: CircleVisibility[] = ['PRIVATE', 'DISCOVERABLE'];
export const CIRCLE_VISIBILITY_LABEL: Record<CircleVisibility, string> = {
  PRIVATE: '私密（只有成员知道这个圈子）',
  DISCOVERABLE: '可发现（本校同学能看到名称和简介，仍需邀请加入）',
};
export const USER_CREATED_TEXT = '用户创建';
export const USER_CREATED_NOTE = '圈子由同学自己创建和管理，不代表学校或任何组织。';
export const CREATE_NOTE = `用户创建的圈子，未经学校核实。${USER_CREATED_NOTE}平台不核验班级、社团等身份。`;
export const NOT_FOUND_TITLE = '圈子不存在或你没有权限查看';
export const NOT_MANAGER_TITLE = '圈子不存在或你没有权限管理';
export const NOT_MEMBER_TEXT = '你还不是这个圈子的成员。加入需要成员给你的邀请码。';
export const ARCHIVED_TEXT = '这个圈子已归档：不能再发布、订阅或邀请新成员。';
export const OWNER_LEAVE_TEXT = '所有者需要先在「管理圈子」里转让所有权，才能退出。';
export const INVITE_ONCE_TEXT = '每个邀请码只能使用一次。邀请码只在生成后显示这一次，平台不保存原文，丢失后请重新生成。';
export const ARCHIVE_HELP = '归档后不能再发布、订阅或邀请；圈子订阅会停用，未使用的邀请码会作废。归档不能撤销。';
export const CIRCLE_PRODUCTS_NOTE = '只包括成员发布时选择了这个圈子的「圈子可见」商品，只有圈子在籍成员能看到。';
export const PRODUCT_CIRCLE_NOTE = '这件商品只对卖家选择的圈子成员可见。圈子由同学自己创建，不代表学校或任何组织。';

/** 退出圈子前必须说清楚的后果。 */
export const LEAVE_CONSEQUENCES = [
  '圈子订阅将停用：你绑定这个圈子的需求订阅不再匹配，相关提醒清零；',
  '私密商品将不可见：这个圈子里仅圈子可见的商品你将看不到；',
  '联系申请随之失效：你在这个圈子仅圈子可见的商品上的联系申请会从列表中消失，已获同意的联系方式也不再向你展示。',
];
export const LEAVE_AFTER = '之后想回来，需要重新拿到邀请码。';
export const leaveDialogText = () => `退出后：\n${LEAVE_CONSEQUENCES.map((line) => `· ${line}`).join('\n')}\n${LEAVE_AFTER}`;

export const INVITE_STATUS: Record<CircleInvite['status'], string> = { PENDING: '待使用', REDEEMED: '已使用', REVOKED: '已撤销', EXPIRED: '已过期' };
export const INVITE_HOURS = [1, 24, 72, 168];
export const hoursLabel = (h: number) => h === 168 ? '7 天' : h === 72 ? '3 天' : `${h} 小时`;

export const isMember = (c: Circle | DiscoverableCircle): c is Circle => (c as Circle).myRole !== undefined && c.joined === true;
export const isManager = (c: Circle | DiscoverableCircle) => isMember(c) && c.status === 'ACTIVE' && (c.myRole === 'OWNER' || c.myRole === 'MODERATOR');

export interface CircleForm { type: CircleType | ''; name: string; description: string }
/** 创建圈子的本地检查（与 Web CircleCreatePage 一致）。 */
export function circleFormProblems(f: CircleForm): string[] {
  const problems: string[] = [];
  const name = f.name.trim();
  if (!f.type) problems.push('请选择圈子类型');
  if (name.length < 2 || name.length > 30) problems.push('圈子名称需要 2～30 个字');
  else if (/[<>]/.test(name)) problems.push('圈子名称不能包含尖括号');
  if (f.description.trim().length > 200) problems.push('简介最多 200 个字');
  return problems;
}
/** 管理页「保存圈子信息」只提交改动过的字段；可见范围只有所有者能改。 */
export function circlePatch(circle: Circle, form: { name: string; description: string; visibility: CircleVisibility }): Record<string, string> {
  const patch: Record<string, string> = {};
  if (form.name.trim() !== circle.name) patch.name = form.name.trim();
  if (form.description.trim() !== circle.description) patch.description = form.description.trim();
  if (circle.myRole === 'OWNER' && form.visibility !== circle.visibility) patch.visibility = form.visibility;
  return patch;
}

export type MemberAction = 'promote' | 'demote' | 'transfer' | 'remove';
/** 能否移出：不能移出自己和所有者；管理员只能移出普通成员。 */
export const canRemoveMember = (myRole: CircleRole, myId: string, m: CircleMember) => m.userId !== myId && m.role !== 'OWNER' && (myRole === 'OWNER' || m.role === 'MEMBER');
/** 对某个成员可以做的操作（与 Web 管理页的菜单一致）。 */
export function memberActions(myRole: CircleRole, myId: string, m: CircleMember): MemberAction[] {
  const owner = myRole === 'OWNER', other = m.userId !== myId;
  const actions: MemberAction[] = [];
  if (owner && other && m.role === 'MEMBER') actions.push('promote');
  if (owner && m.role === 'MODERATOR') actions.push('demote');
  if (owner && other) actions.push('transfer');
  if (canRemoveMember(myRole, myId, m)) actions.push('remove');
  return actions;
}
export const MEMBER_ACTION_LABEL: Record<MemberAction, string> = { promote: '设为管理员', demote: '取消管理员', transfer: '转让所有者', remove: '移出圈子' };
export const removeConfirm = (name: string) => ({ title: `把 ${name || '同学'} 移出圈子？`, content: '对方的圈子订阅将停用，看不到这个圈子里仅圈子可见的商品；对方在这些商品上的联系申请会从列表中消失，已获同意的联系方式也不再向对方展示。' });
export const transferConfirm = (name: string) => ({ title: `把所有者转让给 ${name || '同学'}？`, content: '转让后你会成为管理员，不能再调整成员角色或归档圈子。' });
export const ARCHIVE_CONFIRM = { title: '归档这个圈子？', content: '归档不能撤销。' };

// ---------------- 发布时的可见范围 ----------------
export const VISIBILITY_OPTIONS: [ProductVisibility, string][] = [['PUBLIC', '全校公开'], ['CIRCLE_ONLY', '圈子可见']];
/** 下面始终写清楚谁能看到。 */
export function visibilityHelp(visibility: ProductVisibility, selectedNames: string[]): string {
  if (visibility === 'PUBLIC') return '本校登录的同学都能看到（未登录的访客与他校同学看不到）。';
  if (selectedNames.length) return `只有「${selectedNames.join('」「')}」的在籍成员和你自己能看到；成员退出或被移出后立即看不到，联系申请与已获同意的联系方式也随之失效。`;
  return `请选择 1～${CIRCLE_MAX_PER_PRODUCT} 个圈子；只有所选圈子的在籍成员和你自己能看到。`;
}
/** 勾选 / 取消一个圈子：最多 5 个，不会默认勾选任何圈子。 */
export function toggleCircle(ids: string[], id: string, checked: boolean): string[] {
  const next = checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id);
  return next.slice(0, CIRCLE_MAX_PER_PRODUCT);
}
export const VISIBILITY_NEEDS_CIRCLE = '圈子可见需要至少选择一个圈子';
export const visibilityProblem = (visibility: ProductVisibility, ids: string[]) => visibility === 'CIRCLE_ONLY' && !ids.length ? VISIBILITY_NEEDS_CIRCLE : null;
