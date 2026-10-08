package com.lulu.campusmarketbackend.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 为每个请求建立贯穿响应头、统一 envelope、MDC 与访问日志的同一个 requestId。
 *
 * <p>改造前 {@code ApiEnvelope.ok()} 把 requestId 硬编码为 {@code null}，错误路径又在
 * 每个 catch 里各自 {@code UUID.randomUUID()}，与请求入口毫无关联、也不进日志。
 * 结果是前端拿到的 requestId 既无法定位服务端日志，成功请求更是完全无从追踪。
 *
 * <p>本过滤器排在最前（{@link Ordered#HIGHEST_PRECEDENCE}），保证异常处理链上的
 * 任何响应都已经能取到 requestId。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    /** 请求属性 key，供 ApiResponseAdvice 与 ApiExceptionHandler 读取同一个值。 */
    public static final String REQUEST_ID_ATTRIBUTE = "campusMarketRequestId";
    public static final String REQUEST_ID_HEADER = "X-Request-ID";
    /** MDC key，日志格式中引用它即可输出。 */
    public static final String MDC_KEY = "requestId";

    /**
     * 客户端传入值的白名单：仅字母、数字、短横线、下划线，长度 8-64。
     * 这同时排除了 CR/LF，因此不可能借响应头做注入。
     */
    private static final Pattern VALID_REQUEST_ID = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    private static final Logger ACCESS_LOG = LoggerFactory.getLogger("campus-market.access");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = resolveRequestId(request.getHeader(REQUEST_ID_HEADER));
        long startedAt = System.nanoTime();

        request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
        response.setHeader(REQUEST_ID_HEADER, requestId);
        MDC.put(MDC_KEY, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            // 只记录方法、路径、状态、耗时与 requestId。
            // 刻意不记录 query string、请求体、Authorization、Cookie——
            // 登录与 refresh 的 body 含口令与令牌，任何一项落盘都是事故。
            ACCESS_LOG.info("{} {} status={} durationMs={} requestId={}",
                    request.getMethod(), request.getRequestURI(), response.getStatus(),
                    (System.nanoTime() - startedAt) / 1_000_000, requestId);
            // 容器会复用工作线程，不清理会导致后续请求串号。
            MDC.remove(MDC_KEY);
        }
    }

    /**
     * 沿用合法的客户端 requestId，否则生成一个。
     * 非法字符、超长、含换行的值一律丢弃重新生成，不回显。
     * 生成使用 UUID v4，不用可预测的递增序号。
     */
    private static String resolveRequestId(String incoming) {
        if (incoming != null && VALID_REQUEST_ID.matcher(incoming).matches()) return incoming;
        return UUID.randomUUID().toString();
    }

    /** 供响应构造方读取本次请求的 requestId；缺失时返回 null 而不是新编一个。 */
    public static String currentRequestId(HttpServletRequest request) {
        Object value = request == null ? null : request.getAttribute(REQUEST_ID_ATTRIBUTE);
        return value instanceof String id ? id : null;
    }
}
