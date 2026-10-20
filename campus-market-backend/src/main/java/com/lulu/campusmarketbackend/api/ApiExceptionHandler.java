package com.lulu.campusmarketbackend.api;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;


@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiEnvelope<Object>> handle(ApiException e, HttpServletRequest request) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(e.status());
        // 超限时告诉客户端多久后可以重试；单位为秒，符合 RFC 9110 的 delay-seconds 形式。
        if (e instanceof com.lulu.campusmarketbackend.ratelimit.RateLimitExceededException limited) {
            builder = builder.header("Retry-After", String.valueOf(limited.retryAfterSeconds()));
        }
        return builder.body(new ApiEnvelope<>(e.status(), e.details(), e.getMessage(), RequestIdFilter.currentRequestId(request)));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiEnvelope<Void>> handleConstraint(DataIntegrityViolationException e, HttpServletRequest request) {
        return ResponseEntity.status(409).body(ApiEnvelope.error(409, "记录已存在，请勿重复操作", RequestIdFilter.currentRequestId(request)));
    }

    /** 阶段 4：上传超过大小上限是客户端错误。 */
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiEnvelope<Void>> handleTooLarge(Exception e, HttpServletRequest request) {
        return ResponseEntity.status(413).body(ApiEnvelope.error(413, "图片不能超过 5 MB", RequestIdFilter.currentRequestId(request)));
    }

    /** 缺少上传文件或不是 multipart 请求。 */
    @ExceptionHandler({org.springframework.web.multipart.MultipartException.class,
            org.springframework.web.multipart.support.MissingServletRequestPartException.class})
    public ResponseEntity<ApiEnvelope<Void>> handleMultipart(Exception e, HttpServletRequest request) {
        return ResponseEntity.status(400).body(ApiEnvelope.error(400, "请选择一张图片", RequestIdFilter.currentRequestId(request)));
    }

    /** 请求体不是有效的 JSON（或类型对不上）：客户端错误，不是 500。 */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ApiEnvelope<Void>> handleUnreadable(Exception e, HttpServletRequest request) {
        return ResponseEntity.status(400).body(ApiEnvelope.error(400, "请求体格式无效", RequestIdFilter.currentRequestId(request)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiEnvelope<Void>> handleUnexpected(Exception e, HttpServletRequest request) {
        // 框架自己的请求错误（未知路径 404、方法不支持 405、缺少参数 400 等）保留原状态码，不能被记成服务端故障。
        // 8.2 部署演练发现未知的 /v1 路径曾经返回 500。
        if (e instanceof org.springframework.web.ErrorResponse error && error.getStatusCode().is4xxClientError()) {
            int status = error.getStatusCode().value();
            String message = switch (status) {
                case 404 -> "接口不存在";
                case 405 -> "不支持这个请求方法";
                case 415 -> "不支持的内容类型";
                default -> "请求无效";
            };
            return ResponseEntity.status(status).body(ApiEnvelope.error(status, message, RequestIdFilter.currentRequestId(request)));
        }
        // 真正的服务端故障必须留痕：按请求 id 记录异常与堆栈（不记录请求体、参数或令牌），否则 500 无从排查
        String requestId = RequestIdFilter.currentRequestId(request);
        log.error("unexpected error requestId={} {} {}", requestId, request.getMethod(), request.getRequestURI(), e);
        return ResponseEntity.status(500).body(ApiEnvelope.error(500, "服务暂时不可用", requestId));
    }
}
