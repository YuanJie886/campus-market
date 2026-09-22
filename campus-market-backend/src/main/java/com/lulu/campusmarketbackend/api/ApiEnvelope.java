package com.lulu.campusmarketbackend.api;

public record ApiEnvelope<T>(int code, T data, String message, String requestId) {
    public static <T> ApiEnvelope<T> ok(T data) {
        return new ApiEnvelope<>(0, data, "ok", null);
    }

    public static <T> ApiEnvelope<T> error(int code, String message, String requestId) {
        return new ApiEnvelope<>(code, null, message, requestId);
    }
}
