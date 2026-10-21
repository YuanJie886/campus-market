/**
 * 阶段 4 商品图片（docs/images-and-content-safety.md）的纯规则，不依赖 Taro，便于测试。
 *
 * - 上传：POST /v1/images（multipart 字段 file），响应 { id, ref: 'upload:<id>', url: '/v1/images/<id>?exp&sig', width, height }；
 * - 商品的 images 里只存引用 `upload:<id>`（或过渡期允许的外部 HTTP(S) 示例图）；
 * - 商品响应里是 1 小时有效的相对签名地址 `/v1/images/...`，渲染时要拼上接口域名；
 * - 编辑时把签名地址换回 `upload:<id>` 再提交（后端不接受签名地址）。
 */
import { ApiError } from './api/transport';

/** 与后端 MarketService.images / ListingPayload 的上限一致。 */
export const MAX_IMAGES = 9;
/** 与后端 ImageService.MAX_BYTES 一致。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TOO_LARGE = '图片不能超过 5 MB';
export const IMAGE_RATE_LIMITED = '上传图片太频繁（每人每小时最多 60 张），请稍后再试';
export const IMAGE_UPLOAD_FAILED = '图片上传失败，请重试';
export const IMAGE_PENDING = '还有图片正在上传，请稍候';
export const IMAGE_FAILED_PRESENT = '有图片上传失败，请重试或移除后再提交';
const INVALID = '服务响应异常，请稍后重试';
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const REF = new RegExp(`^upload:${UUID}$`);
const SIGNED_PATH = new RegExp(`^/v1/images/(${UUID})(?:[?#].*)?$`);

export interface UploadedImage { id: string; ref: string; url: string; width: number; height: number }

const trimOrigin = (origin: string) => origin.replace(/\/+$/, '');

/** 以 /v1/ 开头的相对地址（签名图片地址）拼上接口域名；其余（外部 HTTP(S)、本地示意图、本地临时文件）原样返回。 */
export function resolveImageUrl(url: string, apiOrigin: string): string {
  if (typeof url !== 'string' || !url) return '';
  return url.startsWith('/v1/') ? `${trimOrigin(apiOrigin)}${url}` : url;
}

/**
 * 商品响应里的图片地址 → 提交时用的值：本接口签出的 `/v1/images/<id>?…`（相对地址，或已拼上本接口域名）换回 `upload:<id>`；
 * 已经是引用、外部图片和演示示意图原样返回。别的域名下长得像的地址不转换。
 */
export function imageRefFromUrl(url: string, apiOrigin = ''): string {
  if (REF.test(url)) return url;
  const origin = trimOrigin(apiOrigin);
  const path = origin && url.startsWith(`${origin}/v1/`) ? url.slice(origin.length) : url;
  const match = path.match(SIGNED_PATH);
  return match ? `upload:${match[1]}` : url;
}

export const isUploadRef = (value: string) => REF.test(value);

/** 上传成功响应（envelope 的 data）校验：引用必须是 upload:<uuid>，地址必须是本接口的签名地址或 HTTP(S)。 */
export function parseUploadedImage(raw: unknown): UploadedImage {
  const body = (raw ?? {}) as Record<string, unknown>;
  const ref = typeof body.ref === 'string' ? body.ref : '', url = typeof body.url === 'string' ? body.url : '';
  if (!REF.test(ref) || !(url.startsWith('/v1/images/') || /^https?:\/\//.test(url))) throw new ApiError(INVALID, -1);
  const size = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  return { id: typeof body.id === 'string' && body.id ? body.id : ref.slice('upload:'.length), ref, url, width: size(body.width), height: size(body.height) };
}

/**
 * 上传失败的提示：413 固定「图片不能超过 5 MB」（经 nginx 拦下时响应体不是 JSON）；429 说明限流；
 * 400 原样显示后端文案（「只支持 JPEG 或 PNG 图片」「图片尺寸不能超过 …」等）；其余用后端文案或通用提示。
 */
export function uploadErrorMessage(statusCode: number, body: unknown): string {
  const message = typeof (body as { message?: unknown } | null)?.message === 'string' ? (body as { message: string }).message : '';
  if (statusCode === 413) return IMAGE_TOO_LARGE;
  if (statusCode === 429) return IMAGE_RATE_LIMITED;
  return message || IMAGE_UPLOAD_FAILED;
}

// ---------------- 发布表单里的照片 ----------------

export type PhotoStatus = 'uploading' | 'done' | 'failed';
/**
 * 表单里的一张照片：preview 用于显示（新选的照片是本机临时文件；编辑载入的是商品响应里的地址），
 * ref 是提交时放进 images 的值（upload:<id> 或原有的外部 / 示意图地址）。
 */
export interface PhotoSlot { key: string; preview: string; ref: string; status: PhotoStatus; progress: number; error: string; filePath: string }

let sequence = 0;
const nextKey = () => `photo-${Date.now().toString(36)}-${++sequence}`;

/** 编辑已发布的商品：响应里的签名地址换回引用，预览仍用响应地址。 */
export function slotsFromImages(images: string[], toRef: (url: string) => string = (url) => imageRefFromUrl(url), max = MAX_IMAGES): PhotoSlot[] {
  return images.filter(Boolean).slice(0, max).map((url) => ({ key: nextKey(), preview: url, ref: toRef(url), status: 'done', progress: 100, error: '', filePath: '' }));
}

/** 已有的示意图 / 外部图片直接加入（不需要上传）。 */
export function addReadySlot(slots: PhotoSlot[], ref: string, preview = ref, max = MAX_IMAGES): PhotoSlot[] {
  if (slots.length >= max || slots.some((slot) => slot.ref === ref)) return slots;
  return [...slots, { key: nextKey(), preview, ref, status: 'done', progress: 100, error: '', filePath: '' }];
}

/**
 * 新选的照片：超过上限（默认 5 MB，以 /v1/config 为准）的直接标记失败（不上传），其余进入「上传中」。
 * 返回新的列表和需要上传的那几张；张数上限同样以 /v1/config 的 images.maxCount 为准。
 */
export function addPickedFiles(slots: PhotoSlot[], files: { path: string; size?: number }[], max = MAX_IMAGES, maxBytes = MAX_IMAGE_BYTES): { slots: PhotoSlot[]; queued: PhotoSlot[] } {
  const room = Math.max(0, max - slots.length);
  const added = files.slice(0, room).map((file): PhotoSlot => {
    const tooLarge = typeof file.size === 'number' && file.size > maxBytes;
    return { key: nextKey(), preview: file.path, ref: '', status: tooLarge ? 'failed' : 'uploading', progress: 0, error: tooLarge ? IMAGE_TOO_LARGE : '', filePath: file.path };
  });
  return { slots: [...slots, ...added], queued: added.filter((slot) => slot.status === 'uploading') };
}

const update = (slots: PhotoSlot[], key: string, change: Partial<PhotoSlot>) => slots.map((slot) => slot.key === key ? { ...slot, ...change } : slot);
export const slotProgress = (slots: PhotoSlot[], key: string, percent: number) => update(slots, key, { progress: Math.max(0, Math.min(100, Math.round(percent))) });
export const slotUploaded = (slots: PhotoSlot[], key: string, image: UploadedImage) => update(slots, key, { status: 'done', progress: 100, ref: image.ref, error: '' });
export const slotFailed = (slots: PhotoSlot[], key: string, error: unknown) => update(slots, key, { status: 'failed', error: error instanceof Error && error.message ? error.message : IMAGE_UPLOAD_FAILED });
export const slotRetrying = (slots: PhotoSlot[], key: string) => update(slots, key, { status: 'uploading', progress: 0, error: '' });
export const removeSlot = (slots: PhotoSlot[], key: string) => slots.filter((slot) => slot.key !== key);

/** 调整顺序：delta = -1 前移，+1 后移；第一张是主图。越界时不变。 */
export function moveSlot(slots: PhotoSlot[], key: string, delta: number): PhotoSlot[] {
  const from = slots.findIndex((slot) => slot.key === key), to = from + delta;
  if (from < 0 || to < 0 || to >= slots.length) return slots;
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 提交前检查：还有上传中或失败的照片时不能提交（避免悄悄丢掉一张图）。 */
export function photosError(slots: PhotoSlot[]): string | null {
  if (slots.some((slot) => slot.status === 'uploading')) return IMAGE_PENDING;
  if (slots.some((slot) => slot.status === 'failed')) return IMAGE_FAILED_PRESENT;
  return null;
}

/** 提交时放进商品 images 的值：按当前顺序，只取上传完成的引用。 */
export const imagesForSubmit = (slots: PhotoSlot[]) => slots.filter((slot) => slot.status === 'done' && slot.ref).map((slot) => slot.ref);

/** 照片张数与大小上限：以 GET /v1/config 为准，读取前（或旧后端）用默认 9 张、5 MB。 */
export function photoLimits(config: { images: { maxCount: number; maxBytes: number } } | null | undefined) {
  return { max: config?.images.maxCount ?? MAX_IMAGES, maxBytes: config?.images.maxBytes ?? MAX_IMAGE_BYTES };
}
