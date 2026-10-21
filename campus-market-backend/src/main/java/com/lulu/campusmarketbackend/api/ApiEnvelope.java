package com.lulu.campusmarketbackend.api;

public record ApiEnvelope<T>(int code, T data, String message, String requestId) {
    public static <T> ApiEnvelope<T> ok(T data) {
        return ok(data, null);
    }

    /** 成功响应同样携带本次请求的 requestId，与响应头 X-Request-ID 和日志一致。 */
    public static <T> ApiEnvelope<T> ok(T data, String requestId) {
        return new ApiEnvelope<>(0, data, "ok", requestId);
    }

    public static <T> ApiEnvelope<T> error(int code, String message, String requestId) {
        return new ApiEnvelope<>(code, null, message, requestId);
    }
}
