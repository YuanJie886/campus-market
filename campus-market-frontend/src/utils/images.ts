import { IMAGE_MAX_BYTES, IMAGE_TOO_LARGE, UPLOAD_REF_PREFIX } from '../api/contracts';

/**
 * 阶段 4 图片：上传后商品里保存 upload:<id> 引用，显示用服务端返回的短时签名地址（相对路径）。
 * 相对路径按应用已经在用的 API 基址补全（与 HttpTransport 同一个 VITE_API_BASE_URL；同源部署时为空，即原样使用）。
 */
const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function resolveImageSrc(src: string | undefined | null, base = API_BASE): string | undefined {
  if (!src) return undefined;
  // 只补全站内相对路径；协议相对地址（//host/…）、http(s)、data: 一律原样
  if (src.startsWith('/') && !src.startsWith('//')) return `${base}${src}`;
  return src;
}

/** 本标签页里上传过的图片：引用 → 显示地址。只在内存里，刷新即清空（签名地址 1 小时后本来也会失效） */
const uploaded = new Map<string, string>();
export function rememberUploadedImage(ref: string, url: string): void { uploaded.set(ref, url) }
export function isUploadRef(value: string): boolean { return value.startsWith(UPLOAD_REF_PREFIX) }
/** 表单里的一项图片 → 可以放进 <img> 的地址；没有显示地址的上传引用（例如草稿里刷新后的）返回 undefined，界面显示占位图 */
export function displaySrcOf(value: string): string | undefined {
  return uploaded.get(value) ?? (isUploadRef(value) ? undefined : value);
}

export const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

const TYPE_NAMES: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF' };
/** ['image/jpeg','image/png'] → 「JPEG 或 PNG」 */
export function imageTypesText(accept: readonly string[] = IMAGE_TYPES): string {
  const names = accept.map((t) => TYPE_NAMES[t] ?? t.replace(/^image\//, '').toUpperCase());
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join('、')} 或 ${names[names.length - 1]}`;
}
/** 5242880 → 「5 MB」（整数 MB 不带小数） */
export function imageBytesText(maxBytes: number = IMAGE_MAX_BYTES): string {
  const mb = maxBytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
/** 超过大小上限的提示：默认 5 MB 时与后端 413 的原话「图片不能超过 5 MB」一致 */
export function imageTooLargeText(maxBytes: number = IMAGE_MAX_BYTES): string {
  return maxBytes === IMAGE_MAX_BYTES ? IMAGE_TOO_LARGE : `图片不能超过 ${imageBytesText(maxBytes)}`;
}

/** 上传前的本地检查（服务端仍按文件头与大小再判断一次）。规则来自 GET /v1/config，缺省为 5 MB、JPEG / PNG。返回给用户看的一句话，没问题时为 null */
export function imageFileProblem(
  file: Pick<File, 'type' | 'size'>,
  rules: { maxBytes: number; accept: readonly string[] } = { maxBytes: IMAGE_MAX_BYTES, accept: IMAGE_TYPES },
): string | null {
  if (!rules.accept.includes(file.type)) return `只支持 ${imageTypesText(rules.accept)} 图片`;
  if (file.size === 0) return '请选择一张图片';
  if (file.size > rules.maxBytes) return imageTooLargeText(rules.maxBytes);
  return null;
}
