package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.DemandSubscriptionMapper;
import com.lulu.campusmarketbackend.security.AuthService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class DemandService {
    private static final List<String> CATEGORIES = List.of("数码电子", "教材书籍", "生活用品", "服饰鞋包", "运动户外", "其他");
    private static final List<String> CAMPUSES = List.of("东校区", "西校区", "南校区", "北校区");
    private final DemandSubscriptionMapper subscriptions;

    public DemandService(DemandSubscriptionMapper subscriptions) {
        this.subscriptions = subscriptions;
    }

    public List<Map<String, Object>> list(String userId) {
        return subscriptions.selectByUser(uuid(userId)).stream().map(this::view).toList();
    }

    @Transactional
    public Map<String, Object> create(String userId, Map<String, Object> body) {
        if (body.keySet().stream().anyMatch(key -> !List.of("keyword", "category", "campus", "minPrice", "maxPrice").contains(key))) {
            throw ApiException.badRequest("订阅条件无效");
        }
        String keyword = body.get("keyword") == null ? "" : String.valueOf(body.get("keyword")).trim();
        if (keyword.length() > 128) throw ApiException.badRequest("关键词不能超过 128 个字符");
        String category = optionalEnum(body.get("category"), CATEGORIES, "分类");
        String campus = optionalEnum(body.get("campus"), CAMPUSES, "校区");
        BigDecimal minPrice = price(body.get("minPrice"));
        BigDecimal maxPrice = price(body.get("maxPrice"));
        if (minPrice != null && maxPrice != null && minPrice.compareTo(maxPrice) > 0) throw ApiException.badRequest("最低价格不能高于最高价格");
        if (keyword.isEmpty() && category == null && campus == null && minPrice == null && maxPrice == null) {
            throw ApiException.badRequest("至少设置一个需求条件");
        }

        UUID uid = uuid(userId);
        Map<String, Object> existing = subscriptions.selectDuplicate(uid, keyword, category, campus, minPrice, maxPrice);
        if (existing != null) return view(existing);
        UUID id = UUID.randomUUID();
        subscriptions.insert(id, uid, keyword, category, campus, minPrice, maxPrice);
        return map("id", id.toString(), "userId", userId, "keyword", keyword,
                "category", category, "campus", campus, "minPrice", minPrice,
                "maxPrice", maxPrice, "active", true, "createdAt", System.currentTimeMillis());
    }

    public Map<String, Object> delete(String userId, String id) {
        if (subscriptions.deleteByUser(uuid(id), uuid(userId)) == 0) throw ApiException.notFound("需求订阅不存在");
        return Map.of();
    }

    private Map<String, Object> view(Map<String, Object> row) {
        return map("id", text(row.get("id")), "userId", text(row.get("user_id")),
                "keyword", text(row.get("keyword")), "category", nullableText(row.get("category")),
                "campus", nullableText(row.get("campus")), "minPrice", row.get("min_price"),
                "maxPrice", row.get("max_price"), "active", row.get("active"),
                "createdAt", epoch(row.get("created_at")));
    }

    private static String optionalEnum(Object raw, List<String> allowed, String label) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        String value = String.valueOf(raw);
        if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效");
        return value;
    }

    private static BigDecimal price(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        try {
            BigDecimal value = new BigDecimal(String.valueOf(raw));
            if (value.signum() < 0 || value.scale() > 2 || value.compareTo(new BigDecimal("99999999")) > 0) throw new Exception();
            return value;
        } catch (Exception e) {
            throw ApiException.badRequest("预算金额无效");
        }
    }

    private static String nullableText(Object value) { return value == null ? null : text(value); }
    private static UUID uuid(String value) {
        try { return UUID.fromString(value); }
        catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); }
    }
}
