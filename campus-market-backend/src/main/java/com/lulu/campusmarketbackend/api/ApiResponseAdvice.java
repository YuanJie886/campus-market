package com.lulu.campusmarketbackend.api;

import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

@RestControllerAdvice
public class ApiResponseAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        if (body instanceof ApiEnvelope<?>) return body;
        return ApiEnvelope.ok(body, requestIdOf(request));
    }

    /** 取 RequestIdFilter 写入的同一个 requestId，不另外生成，保证与响应头和日志一致。 */
    private static String requestIdOf(ServerHttpRequest request) {
        return request instanceof ServletServerHttpRequest servlet
                ? RequestIdFilter.currentRequestId(servlet.getServletRequest())
                : null;
    }
}
