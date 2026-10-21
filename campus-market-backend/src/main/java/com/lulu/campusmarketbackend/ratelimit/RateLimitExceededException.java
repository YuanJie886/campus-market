package com.lulu.campusmarketbackend.ratelimit;

import com.lulu.campusmarketbackend.api.ApiException;

/**
 * 超出限流配额。映射为 HTTP 429，并由 ApiExceptionHandler 附带 Retry-After 响应头。
 * 消息刻意笼统：不暴露主体摘要、当前计数、窗口起点或任何数据库键，
 * 也不因账号是否存在而产生差异，避免形成账号枚举信道。
 */
public class RateLimitExceededException extends ApiException {
    private final long retryAfterSeconds;

    public RateLimitExceededException(long retryAfterSeconds) {
        super(429, "请求过于频繁，请稍后再试");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() { return retryAfterSeconds; }
}
