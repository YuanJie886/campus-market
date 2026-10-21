export interface ApiErrorShape {
  /** 统一 envelope 中的业务码；网络层失败时为负数哨兵值 */
  code: number;
  message: string;
  details?: unknown;
  /** 服务端 requestId，优先取响应头 X-Request-ID，其次取 envelope */
  requestId?: string;
  /** HTTP 状态码；纯网络失败时为 undefined */
  httpStatus?: number;
  /** 429 时的 Retry-After（秒）；非数字或缺失时为 undefined */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * 统一 API 错误。
 *
 * <p>携带 requestId 是为了让用户报错截图能直接定位服务端日志——后端每个响应都返回
 * `X-Request-ID` 并在 envelope 与访问日志中使用同一个值（0.8B）。
 *
 * <p>刻意不携带完整响应体、不携带 stack trace 给 UI 展示，也绝不包含 Token 或 Cookie。
 */
export class ApiError extends Error {
  readonly code: number;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
  /** 原始异常，仅用于调试，不展示给用户 */
  readonly originalCause?: unknown;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.code = shape.code;
    this.details = shape.details;
    this.requestId = shape.requestId;
    this.httpStatus = shape.httpStatus;
    this.retryAfterSeconds = shape.retryAfterSeconds;
    this.originalCause = shape.cause;
  }

  /**
   * 离线 Mock 的错误。
   *
   * <p>Mock 没有服务端，自然也没有 `X-Request-ID`。但界面上的错误提示统一带
   * 「错误编号」，如果 Mock 的错误偏偏没有，用户在两种模式下会看到不一致的提示，
   * 报障时也说不清自己当时用的是哪一种。这里生成一个带 `mock-` 前缀的本地编号：
   * 一眼能看出它不是服务端日志里的 id，格式又与 REST 模式保持一致。
   */
  static mock(shape: ApiErrorShape): ApiError {
    return new ApiError({ ...shape, requestId: shape.requestId ?? localRequestId() });
  }

  static from(error: unknown, fallback = '网络请求失败'): ApiError {
    if (error instanceof ApiError) return error;
    return new ApiError({
      code: -1,
      message: error instanceof Error ? error.message : fallback,
      cause: error,
    });
  }

  /**
   * 给用户看的一行提示。
   * 429 给出剩余等待秒数；其余附上可复制的错误编号，便于报障时定位。
   * 不输出 Token、Cookie、stack 或原始响应体。
   */
  userMessage(): string {
    if (this.code === 429) {
      const seconds = this.retryAfterSeconds;
      return seconds ? `${this.message}（约 ${seconds} 秒后可重试）` : this.message;
    }
    return this.requestId ? `${this.message}（错误编号：${this.requestId}）` : this.message;
  }
}

let localErrorSeq = 0;

/** 本地错误编号。仅用于把 Mock 的报错与 REST 的 requestId 提示对齐，不冒充服务端 id。 */
function localRequestId(): string {
  localErrorSeq += 1;
  return `mock-${Date.now().toString(36)}-${localErrorSeq}`;
}

/**
 * 任意异常 → 给用户看的一行提示。
 *
 * <p>界面各处过去一律写 `(e as Error).message`，于是 requestId、Retry-After 这些
 * 后端已经给出的定位信息全被丢掉：用户截图报障时只有一句「请求失败」，
 * 运维无从在日志里找到对应的那一条。统一走这里之后，同一句提示里就带上了
 * 可复制的错误编号，而 Token、Cookie、stack 依旧不会出现在提示中。
 */
export function toUserMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiError) return error.userMessage();
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** 解析 Retry-After；非数字、负数、缺失一律安全忽略。 */
export function parseRetryAfterSeconds(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

export function unwrapEnvelope<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') throw new ApiError({ code: -2, message: '服务响应格式无效' });
  const value = payload as Record<string, unknown>;
  if (typeof value.code !== 'number' || !('data' in value)) throw new ApiError({ code: -2, message: '服务响应缺少 envelope 字段' });
  if (value.code !== 0) {
    throw new ApiError({
      code: value.code,
      message: typeof value.message === 'string' ? value.message : '请求失败',
      // 后端错误 envelope 的详情在 data 里；兼容旧的 details 字段
      details: (value.data !== null && typeof value.data === 'object' ? value.data : undefined) ?? value.details,
      requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    });
  }
  return value.data as T;
}
