package com.lulu.campusmarketbackend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class DomainMapper {
    private final ObjectMapper objectMapper;

    public DomainMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> user(Map<String, Object> row, boolean privateFields) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row.get("id")));
        result.put("nickname", text(row.get("nickname")));
        result.put("avatar", text(row.get("avatar")));
        result.put("campus", text(row.get("campus")));
        result.put("createdAt", epoch(row.get("created_at")));
        if (privateFields) {
            result.put("account", text(row.get("account")));
            result.put("contact", text(row.get("contact")));
        }
        return result;
    }

    public Map<String, Object> product(Map<String, Object> row, boolean owner) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row.get("id")));
        result.put("sellerId", text(row.get("seller_id")));
        result.put("title", text(row.get("title")));
        result.put("description", text(row.get("description")));
        result.put("price", decimal(row.get("price")));
        if (row.get("original_price") != null) result.put("originalPrice", decimal(row.get("original_price")));
        result.put("category", text(row.get("category")));
        result.put("condition", text(row.get("condition")));
        result.put("campus", text(row.get("campus")));
        result.put("images", jsonArray(row.get("images")));
        result.put("contact", owner ? text(row.get("contact")) : "");
        result.put("status", text(row.get("status")));
        result.put("views", number(row.get("views")));
        result.put("createdAt", epoch(row.get("created_at")));
        if (row.get("sold_at") != null) result.put("soldAt", epoch(row.get("sold_at")));
        return result;
    }

    public Map<String, Object> favorite(Map<String, Object> row) {
        return map("id", text(row.get("id")), "userId", text(row.get("user_id")),
                "productId", text(row.get("product_id")), "createdAt", epoch(row.get("created_at")));
    }

    public Map<String, Object> comment(Map<String, Object> row) {
        return map("id", text(row.get("id")), "productId", text(row.get("product_id")),
                "userId", text(row.get("user_id")), "content", text(row.get("content")),
                "parentId", row.get("parent_id") == null ? null : text(row.get("parent_id")),
                "createdAt", epoch(row.get("created_at")));
    }

    public Map<String, Object> conversation(Map<String, Object> row) {
        return map("id", text(row.get("id")), "productId", text(row.get("product_id")),
                "buyerId", text(row.get("buyer_id")), "sellerId", text(row.get("seller_id")),
                "createdAt", epoch(row.get("created_at")), "updatedAt", epoch(row.get("updated_at")));
    }

    public Map<String, Object> message(Map<String, Object> row) {
        return map("id", text(row.get("id")), "conversationId", text(row.get("conversation_id")),
                "senderId", text(row.get("sender_id")), "content", text(row.get("content")),
                "createdAt", epoch(row.get("created_at")));
    }

    public Map<String, Object> review(Map<String, Object> row) {
        return map("rating", number(row.get("rating")), "comment", text(row.get("comment")),
                "createdAt", epoch(row.get("created_at")));
    }

    public Map<String, Object> order(Map<String, Object> row, String viewer, List<Map<String, Object>> reviews) {
        String status = text(row.get("status"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row.get("id")));
        result.put("productId", text(row.get("product_id")));
        result.put("buyerId", text(row.get("buyer_id")));
        result.put("sellerId", text(row.get("seller_id")));
        result.put("price", decimal(row.get("price")));
        result.put("status", statusLabel(status));
        result.put("canonicalStatus", status);
        result.put("meetingPointId", text(row.get("meeting_point_id")));
        result.put("meetingAtIso", iso(row.get("meeting_at")));
        result.put("contact", text(row.get("contact")));
        if (viewer.equals(text(row.get("buyer_id")))) result.put("confirmationCode", text(row.get("confirmation_code")));
        result.put("expiresAtIso", iso(row.get("expires_at")));
        result.put("createdAt", epoch(row.get("created_at")));
        result.put("updatedAt", epoch(row.get("updated_at")));
        for (Map<String, Object> review : reviews) {
            String reviewer = text(review.get("reviewer_id"));
            if (reviewer.equals(text(row.get("buyer_id")))) result.put("buyerReview", review(review));
            if (reviewer.equals(text(row.get("seller_id")))) result.put("sellerReview", review(review));
        }
        return result;
    }

    public static String text(Object value) { return value == null ? "" : String.valueOf(value); }
    public static int number(Object value) { return value instanceof Number n ? n.intValue() : Integer.parseInt(text(value)); }
    public static BigDecimal decimal(Object value) { return value instanceof BigDecimal b ? b : new BigDecimal(text(value)); }
    public static long epoch(Object value) {
        if (value == null) return 0;
        if (value instanceof Timestamp t) return t.toInstant().toEpochMilli();
        if (value instanceof java.sql.Date d) return d.toInstant().toEpochMilli();
        if (value instanceof Instant i) return i.toEpochMilli();
        if (value instanceof OffsetDateTime odt) return odt.toInstant().toEpochMilli();
        return OffsetDateTime.parse(text(value)).toInstant().toEpochMilli();
    }
    public static String iso(Object value) {
        if (value instanceof Timestamp t) return t.toInstant().toString();
        if (value instanceof Instant i) return i.toString();
        if (value instanceof OffsetDateTime odt) return odt.toInstant().toString();
        return OffsetDateTime.parse(text(value)).toInstant().toString();
    }
    public static String statusLabel(String status) {
        return switch (status) {
            case "PENDING_SELLER_CONFIRM" -> "待确认";
            case "COMPLETED" -> "已完成";
            case "CANCELLED", "EXPIRED" -> "已取消";
            default -> "交易中";
        };
    }
    public List<String> jsonArray(Object value) {
        if (value == null) return List.of();
        try {
            String json = value.getClass().getName().equals("org.postgresql.util.PGobject")
                    ? String.valueOf(value.getClass().getMethod("getValue").invoke(value))
                    : String.valueOf(value);
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (Exception e) {
            return List.of();
        }
    }
    public String json(Object value) {
        try { return objectMapper.writeValueAsString(value == null ? List.of() : value); }
        catch (JsonProcessingException e) { throw new IllegalArgumentException("图片格式无效"); }
    }
    public static Map<String, Object> map(Object... entries) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < entries.length; i += 2) result.put((String) entries[i], entries[i + 1]);
        return result;
    }
}
