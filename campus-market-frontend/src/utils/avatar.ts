import { isLegacyDemoImage } from './externalDemoImages';

/**
 * 头像（PATCH /v1/auth/me 的 avatar 字段）。
 *
 * 请求可以是："" | "preset:1".."preset:12" | "upload:<uuid>"（本人上传、仍有效的图片；响应里的签名地址
 * 由 RestCampusMarketApi 用 imageRefOf 还原成引用）| http(s)（只在 GET /v1/config 的 images.externalAllowed=true 时）。
 * 响应里是 "preset:N" | 签名的相对地址 /v1/images/… | http(s) | ""。
 * 400 的两句原话见 AVATAR_INVALID / AVATAR_EXTERNAL_NOT_ALLOWED（Mock 与后端相同）。
 */
export const AVATAR_PRESET_COUNT = 12;
/** 预设头像 N 的底色 = AVATAR_PALETTE[N - 1]；文字为白色的昵称首字 */
export const AVATAR_PALETTE: readonly string[] = Object.freeze([
  '#2F6B5B', '#3D5A80', '#8A4F7D', '#A0522D', '#4B6F2F', '#6B5B95',
  '#B5651D', '#2E7D8C', '#8C3B3B', '#4A4E69', '#7A6C2F', '#5C6F82',
]);
export const AVATAR_PRESET_PREFIX = 'preset:';
/** 没有昵称时显示的字 */
export const AVATAR_FALLBACK_CHAR = '同';
export const AVATAR_INVALID = '头像无效';
export const AVATAR_EXTERNAL_NOT_ALLOWED = '不支持外部头像链接，请选择预设头像或上传图片';

const PRESET = /^preset:([1-9]|1[0-2])$/;

export function presetAvatarValue(n: number): string { return `${AVATAR_PRESET_PREFIX}${n}` }
/** "preset:N"（N 为 1..12）→ N；其他一律 null */
export function presetNumberOf(value: string | null | undefined): number | null {
  const m = value ? PRESET.exec(value) : null;
  return m ? Number(m[1]) : null;
}
export function isPresetAvatar(value: string | null | undefined): boolean { return presetNumberOf(value) !== null }

/** 由用户 id 确定的预设（1..12）：同一个 id 永远得到同一个结果，用于没有头像或图片加载失败时 */
export function fallbackPresetFor(userId: string | null | undefined): number {
  let h = 0;
  for (const ch of userId ?? '') h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return (h % AVATAR_PRESET_COUNT) + 1;
}

/** 昵称首字（按码点，不把 emoji 拆半）；空昵称为「同」 */
export function avatarInitial(nickname: string | null | undefined): string {
  const first = Array.from((nickname ?? '').trim())[0];
  return first ?? AVATAR_FALLBACK_CHAR;
}

/** 旧演示数据的头像（演示图床）当作没有头像：从不加载 */
export function normalizeAvatarValue(value: string | null | undefined): string {
  if (!value || isLegacyDemoImage(value)) return '';
  return value;
}

export type AvatarAppearance =
  | { kind: 'preset'; preset: number; color: string }
  | { kind: 'image'; src: string; fallbackPreset: number; fallbackColor: string };

/**
 * 头像值 → 怎么画：
 * - preset:N → 本地绘制，底色 AVATAR_PALETTE[N-1]；
 * - 站内相对地址（/v1/images/…）、http(s)、本机上传预览的 data:image → 图片（失败时退回由 id 决定的预设）；
 * - ""、演示图床、无法识别的值（例如还没有显示地址的 upload:…、协议相对地址）→ 由 id 决定的预设。
 */
export function avatarAppearance(value: string | null | undefined, userId: string | null | undefined): AvatarAppearance {
  const fallback = fallbackPresetFor(userId);
  const normalized = normalizeAvatarValue(value);
  const preset = presetNumberOf(normalized);
  if (preset !== null) return { kind: 'preset', preset, color: AVATAR_PALETTE[preset - 1] };
  const loadable = (normalized.startsWith('/') && !normalized.startsWith('//'))
    || /^https?:\/\//i.test(normalized)
    || /^data:image\/(?:png|jpeg);/i.test(normalized);
  if (loadable) return { kind: 'image', src: normalized, fallbackPreset: fallback, fallbackColor: AVATAR_PALETTE[fallback - 1] };
  return { kind: 'preset', preset: fallback, color: AVATAR_PALETTE[fallback - 1] };
}
