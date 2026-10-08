package com.lulu.campusmarketbackend.api;

public class ApiException extends RuntimeException {
    private final int status;
    /** 可选的机器可读细节（例如批量发布的逐项校验结果），放进错误响应的 data；不含请求体回显 */
    private final Object details;

    public ApiException(int status, String message) {
        this(status, message, null);
    }

    public ApiException(int status, String message, Object details) {
        super(message);
        this.status = status;
        this.details = details;
    }

    public int status() {
        return status;
    }

    public Object details() {
        return details;
    }

    public static ApiException badRequest(String message) { return new ApiException(400, message); }
    public static ApiException unauthorized(String message) { return new ApiException(401, message); }
    public static ApiException forbidden(String message) { return new ApiException(403, message); }
    public static ApiException notFound(String message) { return new ApiException(404, message); }
    public static ApiException conflict(String message) { return new ApiException(409, message); }
}
