export interface ApiErrorShape { code: number; message: string; details?: unknown; requestId?: string }
export class ApiError extends Error {
  readonly code: number;
  readonly details?: unknown;
  readonly requestId?: string;
  constructor(shape: ApiErrorShape) { super(shape.message); this.name = 'ApiError'; this.code = shape.code; this.details = shape.details; this.requestId = shape.requestId }
  static from(error: unknown, fallback = '网络请求失败'): ApiError { if (error instanceof ApiError) return error; return new ApiError({ code: -1, message: error instanceof Error ? error.message : fallback }) }
}
export function unwrapEnvelope<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') throw new ApiError({ code: -2, message: '服务响应格式无效' });
  const value = payload as Record<string, unknown>;
  if (typeof value.code !== 'number' || !('data' in value)) throw new ApiError({ code: -2, message: '服务响应缺少 envelope 字段' });
  if (value.code !== 0) throw new ApiError({ code: value.code, message: typeof value.message === 'string' ? value.message : '请求失败', details: value.details, requestId: typeof value.requestId === 'string' ? value.requestId : undefined });
  return value.data as T;
}
