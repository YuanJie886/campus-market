package com.lulu.campusmarketbackend.api;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.UUID;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiEnvelope<Void>> handle(ApiException e, HttpServletRequest request) {
        return ResponseEntity.status(e.status()).body(ApiEnvelope.error(e.status(), e.getMessage(), UUID.randomUUID().toString()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiEnvelope<Void>> handleConstraint(DataIntegrityViolationException e, HttpServletRequest request) {
        return ResponseEntity.status(409).body(ApiEnvelope.error(409, "记录已存在，请勿重复操作", UUID.randomUUID().toString()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiEnvelope<Void>> handleUnexpected(Exception e, HttpServletRequest request) {
        return ResponseEntity.status(500).body(ApiEnvelope.error(500, "服务暂时不可用", UUID.randomUUID().toString()));
    }
}
