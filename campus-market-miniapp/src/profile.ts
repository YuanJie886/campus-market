/**
 * 「编辑资料」的规则（纯函数，不依赖 Taro，便于测试），与 Web ProfileInfoPage 一致：
 * 昵称 1–16 字；联系方式为手机号或学号（6–20 位字母数字），留空时使用账号；
 * 头像：12 个本地绘制的预设、上传一张（本人上传的图片）或不使用头像（规则见 src/avatar.ts）；
 * 宿舍楼选填，只有本人可见，显式传 null 表示清空。
 */
import type { Building, ProfileInput, User } from './model';

export const NICKNAME_MAX = 16;
export const DORM_HELP = '只有你自己能看到这条信息。它用于「只看本楼」与距离估算，不会出现在你的商品、留言或聊天里。';
export const DORM_SCOPE_HELP = '只保存楼栋，不收集房间号、楼层或床位';

export const isValidPhone = (value: string) => /^1[3-9]\d{9}$/.test(value.trim());
export const isValidStudentId = (value: string) => /^[A-Za-z0-9]{6,20}$/.test(value.trim());

export interface ProfileForm { nickname: string; campus: User['campus']; contact: string; avatar: string; dormBuildingId: string | null }

/**
 * 检查表单。联系方式规则只在本次修改了联系方式时检查：旧账号里已有的联系方式（例如早期注册时填写的微信号）
 * 不会因为与新规则不同而挡住修改昵称等其他资料。
 */
export function profileError(form: ProfileForm, original?: Pick<User, 'contact'>): string | null {
  const name = form.nickname.trim();
  if (!name) return '昵称不能为空';
  if (name.length > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`;
  const contact = form.contact.trim();
  const changed = contact !== (original?.contact ?? '').trim();
  if (contact && changed && !isValidPhone(contact) && !isValidStudentId(contact)) return '联系方式需为有效手机号或学号';
  return null;
}

/**
 * PATCH /v1/auth/me 的请求体：联系方式留空时用账号；宿舍楼不填时显式传 null（清空）。
 * 头像只在本次改动过时发送（"" = 不使用头像）：没动过的旧头像（例如网页端旧账号的外部默认头像）原样留在服务端，
 * 不会因为它不符合新规则而挡住修改昵称等其他资料。
 */
export function profileInput(form: ProfileForm, user: Pick<User, 'account'>, originalAvatar = ''): ProfileInput {
  const input: ProfileInput = { nickname: form.nickname.trim(), campus: form.campus, contact: form.contact.trim() || user.account || '', dormBuildingId: form.dormBuildingId || null };
  if (form.avatar !== originalAvatar) input.avatar = form.avatar;
  return input;
}

/** 园区列表（保持接口顺序）与某个园区下的楼栋。 */
export const zonesOf = (buildings: Building[]) => [...new Set(buildings.map((b) => b.zone))];
export const buildingsIn = (buildings: Building[], zone: string) => zone ? buildings.filter((b) => b.zone === zone) : buildings;
/** 校区变化后，原来的楼栋不在新列表里就清空，不留下一个必然被拒绝的值。 */
export const keepBuilding = (buildings: Building[], id: string | null) => id && buildings.some((b) => b.id === id) ? id : null;
