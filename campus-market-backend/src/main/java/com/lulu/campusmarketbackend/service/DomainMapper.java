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
            // 宿舍楼只出现在本人视图。公共投影绝不能带上它——
            // 商品卖家、评论作者、聊天对象都走这个方法的 privateFields=false 分支，
            // 一旦泄露，任何人都能从一条留言推出某个同学住哪栋楼。
            result.put("dormBuildingId", nullableText(row.get("dorm_building_id")));
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
        // 取货楼栋。旧商品没有楼栋，这里如实给 null，由前端回退到校区展示，
        // 不编造一个楼栋。buildingName/zone 来自 LEFT JOIN，缺失时同样是 null。
        result.put("buildingId", nullableText(row.get("building_id")));
        result.put("buildingName", nullableText(row.get("building_name")));
        result.put("buildingZone", nullableText(row.get("building_zone")));
        result.put("textbook", textbook(row));
        // 模块 5：单件 / 整套打包；打包商品附带摘要（明细条数、总件数、分类数）
        result.put("listingKind", row.get("listing_kind") == null ? "SINGLE" : text(row.get("listing_kind")));
        result.put("bundle", jsonObject(row.get("bundle_json")));
        // 模块 6：全校公开 / 圈子可见；圈子标签只包含查看者自己也在籍的圈子（卖家本人看到全部），SQL 已按查看者过滤
        result.put("visibility", row.get("visibility") == null ? "PUBLIC" : text(row.get("visibility")));
        // 模块 7：被治理隐藏只告诉卖家本人（其他人根本看不到这件商品）
        if (owner && row.containsKey("moderation_hidden_at")) result.put("moderationHidden", row.get("moderation_hidden_at") != null);
        result.put("circles", jsonList(row.get("circle_json")));
        return result;
    }

    private List<Object> jsonList(Object raw) {
        if (raw == null) return List.of();
        try {
            return objectMapper.readValue(String.valueOf(raw), new com.fasterxml.jackson.core.type.TypeReference<List<Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("JSON 列表格式错误", e);
        }
    }

    private Map<String, Object> jsonObject(Object raw) {
        if (raw == null) return null;
        try {
            return objectMapper.readValue(String.valueOf(raw), new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("JSON 摘要格式错误", e);
        }
    }

    /**
     * 模块 4：商品关联的教材版本。取自关联时的快照（不随目录修订而变），
     * 关联课程名来自同一条 SQL 的子查询（tb_json）。未关联或来源 SQL 没有这一列时为 null。
     */
    private Map<String, Object> textbook(Map<String, Object> row) {
        Object raw = row.get("tb_json");
        if (raw == null) return null;
        try {
            return objectMapper.readValue(String.valueOf(raw), new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("教材摘要格式错误", e);
        }
    }

    /** 楼栋参考数据投影。只含公共信息，不含任何住户相关字段。 */
    public Map<String, Object> building(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row.get("id")));
        result.put("campusId", text(row.get("campus_id")));
        result.put("zone", text(row.get("zone")));
        result.put("name", text(row.get("name")));
        result.put("latitude", row.get("latitude"));
        result.put("longitude", row.get("longitude"));
        return result;
    }

    /** 面交点投影，含 V3 补充的演示坐标。 */
    public Map<String, Object> meetingPoint(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", text(row.get("id")));
        result.put("campus", text(row.get("campus_id")));
        result.put("name", text(row.get("name")));
        result.put("latitude", row.get("latitude"));
        result.put("longitude", row.get("longitude"));
        // V5：停用点仍返回（历史订单要显示名称），前端只在新提议里提供启用的点
        result.put("active", !Boolean.FALSE.equals(row.get("active")));
        return result;
    }

    /** 可空文本：缺失时返回 null 而不是空串，让「未指定」与「空字符串」可区分。 */
    public static String nullableText(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    public Map<String, Object> favorite(Map<String, Object> row) {
        return map("id", text(row.get("id")), "userId", text(row.get("user_id")),
                "productId", text(row.get("product_id")), "createdAt", epoch(row.get("created_at")));
    }

    /**
     * 7.1E：被平台隐藏的评论对<b>任何人</b>（包括作者）都不返回正文，只保留位置与占位状态；
     * 作者额外看到 hiddenForAuthor=true（界面提示「已被平台隐藏，可在我的限制里申诉」）。原文在库里保留。
     */
    public Map<String, Object> comment(Map<String, Object> row, String viewer) {
        boolean hidden = row.get("moderation_hidden_at") != null;
        Map<String, Object> m = map("id", text(row.get("id")), "productId", text(row.get("product_id")),
                "userId", text(row.get("user_id")), "content", hidden ? "" : text(row.get("content")),
                "parentId", row.get("parent_id") == null ? null : text(row.get("parent_id")),
                "createdAt", epoch(row.get("created_at")));
        m.put("moderationHidden", hidden);
        m.put("hiddenForAuthor", hidden && text(row.get("user_id")).equals(viewer));
        return m;
    }

    public Map<String, Object> conversation(Map<String, Object> row) {
        return map("id", text(row.get("id")), "productId", text(row.get("product_id")),
                "buyerId", text(row.get("buyer_id")), "sellerId", text(row.get("seller_id")),
                "createdAt", epoch(row.get("created_at")), "updatedAt", epoch(row.get("updated_at")));
    }

    /**
     * 7.1E：被隔离的单条私信对会话双方都只返回占位（正文为空、quarantined=true），会话与其他消息照常；
     * 工作人员只能在对应案件的举报快照里看到这一条的正文。
     */
    public Map<String, Object> message(Map<String, Object> row) {
        boolean quarantined = row.get("moderation_quarantined_at") != null;
        Map<String, Object> m = map("id", text(row.get("id")), "conversationId", text(row.get("conversation_id")),
                "senderId", text(row.get("sender_id")), "content", quarantined ? "" : text(row.get("content")),
                "createdAt", epoch(row.get("created_at")));
        m.put("quarantined", quarantined);
        return m;
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
        // 7.1A：明确的结束时间（V11 之前的原始预约没有，保持 null，不推断）；slotAgreed = 当前档期已有双方确认的快照
        result.put("meetingEndsAtIso", row.get("meeting_ends_at") == null ? null : iso(row.get("meeting_ends_at")));
        result.put("slotAgreed", Boolean.TRUE.equals(row.get("summary_slot_agreed")));
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
