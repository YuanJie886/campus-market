/**
 * 头像规则（纯函数，不依赖 Taro，便于测试）。头像的取值只有四种：
 * - ""：不使用头像；
 * - "preset:1"～"preset:12"：本地绘制的圆形头像（背景色取自下面的色板，前景是昵称的第一个字）；
 * - 本人上传的图片（请求里是 upload:<id>，响应里是本接口签出的 /v1/images/… 地址）；
 * - http(s) 地址：只有 /v1/config 的 images.externalAllowed 为 true 时才显示。
 *
 * 不请求任何第三方图片服务：网页端旧账号的默认头像（picsum.photos，地址里带着账号名）一律不加载，
 * 改为按用户 id 固定选一个预设颜色本地绘制。
 */
export const AVATAR_PALETTE = ['#2F6B5B', '#3D5A80', '#8A4F7D', '#A0522D', '#4B6F2F', '#6B5B95', '#B5651D', '#2E7D8C', '#8C3B3B', '#4A4E69', '#7A6C2F', '#5C6F82'] as const;
export const AVATAR_PRESET_COUNT = AVATAR_PALETTE.length;
/** 编辑资料里可选的 12 个预设。 */
export const AVATAR_PRESETS = Array.from({ length: AVATAR_PRESET_COUNT }, (_, i) => `preset:${i + 1}`);
/** 与后端一致的两条 400 文案（原样显示）。 */
export const AVATAR_INVALID = '头像无效';
export const AVATAR_EXTERNAL_REJECTED = '不支持外部头像链接，请选择预设头像或上传图片';
export const AVATAR_FALLBACK_INITIAL = '同';

const PRESET = /^preset:([1-9]|1[0-2])$/;
const UPLOAD_REF = /^upload:[0-9a-fA-F-]{36}$/;
const SIGNED = /^\/v1\/images\/[0-9a-fA-F-]{36}(?:[?#].*)?$/;

/** "preset:N" → N（1～12）；其余为 null。 */
export function presetNumber(value: string | null | undefined): number | null {
  const match = typeof value === 'string' ? PRESET.exec(value) : null;
  return match ? Number(match[1]) : null;
}

/** 旧默认头像所在图片服务的域名（按域名标签比对，含它的子域名）。 */
const LEGACY_HOST_LABELS = ['picsum', 'photos'];
/** 网页端旧账号的默认头像：那个第三方图片服务上带账号名的地址。永远不加载。 */
export function isLegacyPicsum(value: string | null | undefined): boolean {
  const host = typeof value === 'string' ? /^(?:https?:)?\/\/([^/?#:]+)/i.exec(value.trim())?.[1] : undefined;
  if (!host) return false;
  const labels = host.toLowerCase().split('.');
  return labels.length >= 2 && labels.slice(-2).join() === LEGACY_HOST_LABELS.join();
}

/** 由用户 id 固定选出的预设（1～12）：同一个人在任何页面、任何设备上都是同一个颜色。 */
export function presetForId(id: string | null | undefined): number {
  let hash = 0;
  for (const ch of String(id ?? '')) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return (hash % AVATAR_PRESET_COUNT) + 1;
}

/** 昵称的第一个字（按字符，不截断代理对）；没有昵称时用「同」。 */
export function avatarInitial(nickname: string | null | undefined): string {
  const first = Array.from((nickname ?? '').trim())[0];
  return first ?? AVATAR_FALLBACK_INITIAL;
}

export type AvatarView =
  | { kind: 'drawn'; preset: number; color: string; initial: string }
  | { kind: 'image'; src: string };

export interface AvatarContext {
  userId?: string | null; nickname?: string | null;
  /** /v1/config images.externalAllowed */
  externalAllowed: boolean;
  /** 签名地址 → 可显示的地址（REST 拼接口域名；演示换回本机文件）。 */
  resolve: (url: string) => string;
}

const drawn = (preset: number, nickname?: string | null): AvatarView => ({ kind: 'drawn', preset, color: AVATAR_PALETTE[preset - 1], initial: avatarInitial(nickname) });

/** 头像值 → 怎么显示。任何无法安全显示的值都退回本地绘制，从不发出第三方图片请求。 */
export function avatarView(value: string | null | undefined, ctx: AvatarContext): AvatarView {
  const raw = typeof value === 'string' ? value.trim() : '';
  const preset = presetNumber(raw);
  if (preset) return drawn(preset, ctx.nickname);
  const fallback = () => drawn(presetForId(ctx.userId), ctx.nickname);
  if (!raw || isLegacyPicsum(raw) || UPLOAD_REF.test(raw)) return fallback();
  // 本人上传的头像：响应里是本接口签出的相对地址，显示时拼上接口域名
  if (SIGNED.test(raw)) {
    const src = ctx.resolve(raw);
    return src ? { kind: 'image', src } : fallback();
  }
  if (/^https?:\/\//i.test(raw)) return ctx.externalAllowed ? { kind: 'image', src: raw } : fallback();
  return fallback();
}

/** 编辑资料可以提交的值：不使用头像、12 个预设之一，或本人上传得到的引用。 */
export function avatarChoiceValid(value: string): boolean {
  return value === '' || presetNumber(value) !== null || UPLOAD_REF.test(value);
}
