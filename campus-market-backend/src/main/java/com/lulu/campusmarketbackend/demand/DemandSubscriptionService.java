package com.lulu.campusmarketbackend.demand;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.building.BuildingService;
import com.lulu.campusmarketbackend.mapper.DemandMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 需求订阅的创建、修改与停用（2.2）。
 *
 * <p>身份、学校与指纹全部由服务端决定：用户 id 来自认证，学校由用户校区推导，
 * 指纹由规范化条件计算。客户端传入 userId / schoolId / active / fingerprint
 * 会被字段白名单直接拒绝（400，且无副作用）。
 */
@Service
public class DemandSubscriptionService {

    /** 每位用户同时启用的订阅上限。 */
    public static final int MAX_ACTIVE_PER_USER = 50;

    /** 创建时允许的字段。 */
    private static final Set<String> CREATE_FIELDS = Set.of(
            "keyword", "category", "minPrice", "maxPrice", "geoScope", "campusId", "buildingId",
            // 模块 4：精确教材版本订阅。创建后不可改版本（PATCH 不接受该字段），要换版本就新建一条
            "textbookEditionId",
            // 模块 6：圈子范围订阅（只能由在籍成员创建）。创建后不可改圈子
            "circleId");
    /** 修改时额外允许启用 / 停用。 */
    private static final Set<String> PATCH_FIELDS = Set.of(
            "keyword", "category", "minPrice", "maxPrice", "geoScope", "campusId", "buildingId", "active");
    private static final Set<String> SCOPES = Set.of("BUILDING", "ZONE", "CAMPUS", "SCHOOL");

    private final DemandMapper demands;
    private final UserMapper users;
    private final BuildingService buildings;
    private final com.lulu.campusmarketbackend.mapper.CircleMapper circles;

    public DemandSubscriptionService(DemandMapper demands, UserMapper users, BuildingService buildings,
                                     com.lulu.campusmarketbackend.mapper.CircleMapper circles) {
        this.circles = circles;
        this.demands = demands;
        this.users = users;
        this.buildings = buildings;
    }

    /** 已校验、已规范化的订阅条件。 */
    record Conditions(String keyword, String normalizedKeyword, String category,
                      BigDecimal minPrice, BigDecimal maxPrice,
                      String geoScope, String campusId, String buildingId, String zone,
                      String textbookEditionId, UUID circleId) {
        String fingerprint() {
            return DemandFingerprint.of(normalizedKeyword, category, minPrice, maxPrice,
                    geoScope, campusId, buildingId, zone, textbookEditionId, circleId == null ? null : circleId.toString());
        }
        Conditions withCircle(UUID circle) {
            return new Conditions(keyword, normalizedKeyword, category, minPrice, maxPrice, geoScope, campusId, buildingId, zone, textbookEditionId, circle);
        }
    }

    /**
     * 创建订阅，幂等。
     *
     * <p>固定语义：
     * <ul>
     *   <li>已有同条件的启用订阅 → 返回它，outcome=EXISTING，不新建行；</li>
     *   <li>只有同条件的已停用订阅 → 重新激活最近的那一条，outcome=REACTIVATED；
     *       这样历史匹配仍挂在同一个订阅下，而不是凭空多出一条；</li>
     *   <li>否则新建，outcome=CREATED。</li>
     * </ul>
     *
     * <p>并发：先对用户行加 FOR UPDATE 锁，同一用户的创建请求在这里串行化，
     * 「计数 → 判断上限 → 插入」因此是原子的；部分唯一索引是最后一道防线。
     * 不使用任何单机内存计数器。
     */
    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, CREATE_FIELDS);
        UUID userId = UUID.fromString(uid);
        String school = requireSchool(userId);
        Conditions conditions = parse(body, userId, school, true);

        users.lockById(userId);
        String fingerprint = conditions.fingerprint();

        UUID existing = demands.selectActiveByFingerprint(userId, fingerprint);
        if (existing != null) return envelope(existing, userId, "EXISTING");

        // 同一教材版本只能有一条启用订阅：条件不同（例如预算）也不另建，引导去修改原订阅
        if (conditions.textbookEditionId() != null
                && demands.selectActiveByTextbook(userId, conditions.textbookEditionId()) != null) {
            throw ApiException.conflict("你已订阅这个教材版本，可以修改原订阅的范围或预算");
        }

        UUID inactive = demands.selectInactiveByFingerprint(userId, fingerprint);
        requireCapacity(userId);
        if (inactive != null) {
            demands.setActive(inactive, userId, true);
            return envelope(inactive, userId, "REACTIVATED");
        }

        UUID id = UUID.randomUUID();
        demands.insertSubscription(id, userId, school, conditions.keyword(), conditions.normalizedKeyword(),
                conditions.category(), conditions.minPrice(), conditions.maxPrice(), conditions.geoScope(),
                conditions.campusId(), conditions.buildingId(), fingerprint, conditions.textbookEditionId(), conditions.circleId());
        return envelope(id, userId, "CREATED");
    }

    public List<Map<String, Object>> list(String uid) {
        return demands.selectSubscriptionsByUser(UUID.fromString(uid)).stream()
                .map(DemandSubscriptionService::project).toList();
    }

    /**
     * 修改条件或启用状态。条件变化会重新计算指纹；若与本人另一条启用订阅撞车，返回 409。
     */
    @Transactional
    public Map<String, Object> update(String uid, String id, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, PATCH_FIELDS);
        UUID userId = UUID.fromString(uid);
        UUID subscriptionId = parseId(id);
        users.lockById(userId);

        Map<String, Object> current = demands.selectSubscriptionForUser(subscriptionId, userId);
        if (current == null) throw ApiException.notFound("订阅不存在");

        // 以现值为底，叠加本次提交的字段，再整体重新校验
        Map<String, Object> merged = new LinkedHashMap<>();
        merged.put("keyword", current.get("keyword"));
        merged.put("category", current.get("category"));
        merged.put("minPrice", current.get("min_price"));
        merged.put("maxPrice", current.get("max_price"));
        merged.put("geoScope", current.get("geo_scope"));
        merged.put("campusId", current.get("campus_id"));
        merged.put("buildingId", current.get("building_id"));
        merged.put("textbookEditionId", current.get("textbook_edition_id"));
        merged.put("circleId", current.get("circle_id") == null ? null : current.get("circle_id").toString());
        for (String key : CREATE_FIELDS) if (body.containsKey(key) && !"textbookEditionId".equals(key) && !"circleId".equals(key)) merged.put(key, body.get(key));
        // 切换范围时，旧范围的锚点不应被带进新范围
        if (body.containsKey("geoScope") && !body.containsKey("campusId")) merged.remove("campusId");
        if (body.containsKey("geoScope") && !body.containsKey("buildingId")) merged.remove("buildingId");

        String school = requireSchool(userId);
        boolean wasActive = Boolean.TRUE.equals(current.get("active"));
        boolean active = body.containsKey("active") ? parseBoolean(body.get("active")) : wasActive;
        // 模块 6：只有继续启用时才要求仍是圈子的在籍成员；退出圈子后仍可以停用或修改一条已停用的订阅
        Conditions conditions = parse(merged, userId, school, active);
        String fingerprint = conditions.fingerprint();

        if (active) {
            UUID clash = demands.selectActiveByFingerprint(userId, fingerprint);
            if (clash != null && !clash.equals(subscriptionId)) {
                throw ApiException.conflict("已有一条相同条件的订阅");
            }
            if (conditions.textbookEditionId() != null) {
                UUID sameBook = demands.selectActiveByTextbook(userId, conditions.textbookEditionId());
                if (sameBook != null && !sameBook.equals(subscriptionId)) {
                    throw ApiException.conflict("你已订阅这个教材版本");
                }
            }
            if (!wasActive) requireCapacity(userId);
        }
        demands.updateSubscription(subscriptionId, userId, conditions.keyword(), conditions.normalizedKeyword(),
                conditions.category(), conditions.minPrice(), conditions.maxPrice(), conditions.geoScope(),
                conditions.campusId(), conditions.buildingId(), fingerprint, active);
        return project(demands.selectSubscriptionForUser(subscriptionId, userId));
    }

    /** 删除即软停用：历史匹配仍然引用这条订阅，物理删除会破坏它们。幂等。 */
    @Transactional
    public Map<String, Object> deactivate(String uid, String id) {
        UUID userId = UUID.fromString(uid);
        UUID subscriptionId = parseId(id);
        if (demands.setActive(subscriptionId, userId, false) == 0) throw ApiException.notFound("订阅不存在");
        return project(demands.selectSubscriptionForUser(subscriptionId, userId));
    }

    // ------------------------------------------------------------------

    private void requireCapacity(UUID userId) {
        if (demands.countActive(userId) >= MAX_ACTIVE_PER_USER) {
            throw ApiException.conflict("启用中的订阅已达 " + MAX_ACTIVE_PER_USER + " 个上限，请先停用一些");
        }
    }

    private String requireSchool(UUID userId) {
        String school = demands.selectUserSchool(userId);
        if (school == null) throw ApiException.unauthorized("登录已失效，请重新登录");
        return school;
    }

    /**
     * 模块 6：在基本条件之外解析圈子范围。圈子订阅固定为全校范围（圈子本身就是范围），不与教材版本组合；
     * requireMembership 时对圈子行与成员行加共享锁并确认在籍——并发的移除要等本事务提交，
     * 然后会在它自己的事务里把这条订阅一并停用。
     */
    private Conditions parse(Map<String, Object> body, UUID userId, String school, boolean requireMembership) {
        Conditions base = parseBase(body, userId, school);
        Object rawCircle = body.get("circleId");
        if (rawCircle == null || String.valueOf(rawCircle).isBlank()) return base;
        UUID circleId;
        try {
            circleId = UUID.fromString(String.valueOf(rawCircle));
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("圈子不存在");
        }
        if (!"SCHOOL".equals(base.geoScope())) throw ApiException.badRequest("圈子订阅的范围就是这个圈子，不需要再选校区或楼栋");
        if (base.textbookEditionId() != null) throw ApiException.badRequest("圈子订阅不能同时订阅教材版本");
        if (requireMembership && circles.lockUsableCircles(userId, school, List.of(circleId)).isEmpty()) {
            throw ApiException.notFound("圈子不存在或你不是这个圈子的成员");
        }
        return base.withCircle(circleId);
    }

    private Conditions parseBase(Map<String, Object> body, UUID userId, String school) {
        // ---- 关键词 ----
        String keyword = null, normalized = null;
        Object rawKeyword = body.get("keyword");
        if (rawKeyword != null) {
            if (!(rawKeyword instanceof String text)) throw ApiException.badRequest("keyword 格式无效");
            String candidate = DemandText.normalize(text);
            if (!candidate.isEmpty()) {
                if (candidate.length() > DemandText.MAX_KEYWORD_LENGTH) {
                    throw ApiException.badRequest("关键词最多 " + DemandText.MAX_KEYWORD_LENGTH + " 个字");
                }
                keyword = text.strip().replaceAll("(?U)\\s+", " ");
                normalized = candidate;
            }
        }

        // ---- 分类 ----
        String category = null;
        Object rawCategory = body.get("category");
        if (rawCategory != null && !String.valueOf(rawCategory).isBlank()) {
            category = String.valueOf(rawCategory);
            if (!MarketService.CATEGORIES.contains(category)) throw ApiException.badRequest("分类无效");
        }

        // ---- 精确教材版本（模块 4）----
        // 按版本 id 精确匹配，不按书名：带版本的订阅不接受关键词，分类固定为教材书籍。
        // 版本必须属于本人所在学校的目录，其他学校的 id 与不存在一样 404。
        String textbookEditionId = null;
        Object rawEdition = body.get("textbookEditionId");
        if (rawEdition != null && !String.valueOf(rawEdition).isBlank()) {
            if (!(rawEdition instanceof String editionText)) throw ApiException.badRequest("textbookEditionId 格式无效");
            if (normalized != null) throw ApiException.badRequest("教材版本订阅按版本精确匹配，不需要关键词");
            if (category != null && !MarketService.TEXTBOOK_CATEGORY.equals(category)) {
                throw ApiException.badRequest("教材版本订阅的分类只能是教材书籍");
            }
            textbookEditionId = editionText.trim();
            if (demands.countEditionInSchool(textbookEditionId, school) == 0) throw ApiException.notFound("教材版本不存在");
            category = MarketService.TEXTBOOK_CATEGORY;
        }
        if (normalized == null && category == null) {
            // 「全校任何东西」会让每件新商品通知每个人，没有意义也会被滥用
            throw ApiException.badRequest("请至少填写关键词或选择分类");
        }

        // ---- 价格 ----
        BigDecimal min = price(body.get("minPrice"), "minPrice");
        BigDecimal max = price(body.get("maxPrice"), "maxPrice");
        if (min != null && max != null && min.compareTo(max) > 0) {
            throw ApiException.badRequest("最低价不能高于最高价");
        }

        // ---- 地理范围 ----
        Object rawScope = body.get("geoScope");
        String scope = rawScope == null || String.valueOf(rawScope).isBlank() ? "SCHOOL" : String.valueOf(rawScope);
        if (!SCOPES.contains(scope)) throw ApiException.badRequest("范围无效");
        String requestedCampus = blankToNull(body.get("campusId"));
        String requestedBuilding = blankToNull(body.get("buildingId"));

        return switch (scope) {
            case "SCHOOL" -> {
                if (requestedCampus != null || requestedBuilding != null) {
                    throw ApiException.badRequest("全校范围不需要指定校区或楼栋");
                }
                yield new Conditions(keyword, normalized, category, min, max, scope, null, null, null, textbookEditionId, null);
            }
            case "CAMPUS" -> {
                if (requestedBuilding != null) throw ApiException.badRequest("校区范围不需要指定楼栋");
                String campus = requestedCampus != null ? requestedCampus : users.selectCampus(userId);
                if (!school.equals(demands.selectCampusSchool(campus))) {
                    throw ApiException.badRequest("校区不属于你所在的学校");
                }
                yield new Conditions(keyword, normalized, category, min, max, scope, campus, null, null, textbookEditionId, null);
            }
            default -> {
                // BUILDING / ZONE：锚点楼栋。未显式指定时使用本人宿舍楼；
                // 两者都没有就拒绝，绝不替用户猜楼栋
                String buildingId = requestedBuilding;
                if (buildingId == null) {
                    Map<String, Object> me = users.selectRowById(userId);
                    buildingId = me == null ? null : DomainMapper.nullableText(me.get("dorm_building_id"));
                    if (buildingId == null) {
                        throw ApiException.conflict("请先在个人资料中设置宿舍楼，或选择一栋楼");
                    }
                }
                Map<String, Object> building = buildings.rowById(buildingId);
                if (building == null) throw ApiException.notFound("楼栋不存在");
                if (!Boolean.TRUE.equals(building.get("active"))) {
                    throw ApiException.badRequest("该楼栋已停用，请选择其他楼栋");
                }
                String campus = DomainMapper.text(building.get("campus_id"));
                if (!school.equals(demands.selectCampusSchool(campus))) {
                    throw ApiException.badRequest("楼栋不属于你所在的学校");
                }
                if (requestedCampus != null && !requestedCampus.equals(campus)) {
                    throw ApiException.badRequest("所选楼栋不属于该校区");
                }
                // 园区只由楼栋推导，不接受任何客户端传入的园区文本
                String zone = DomainMapper.text(building.get("zone"));
                yield new Conditions(keyword, normalized, category, min, max, scope, campus, buildingId, zone, textbookEditionId, null);
            }
        };
    }

    private static BigDecimal price(Object raw, String name) {
        if (raw == null || (raw instanceof String s && s.isBlank())) return null;
        try {
            BigDecimal value = new BigDecimal(String.valueOf(raw));
            if (value.signum() < 0 || value.scale() > 2 || value.compareTo(new BigDecimal("99999999")) > 0) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(name + " 无效");
        }
    }

    private static boolean parseBoolean(Object raw) {
        if (raw instanceof Boolean b) return b;
        throw ApiException.badRequest("active 必须是布尔值");
    }

    private static String blankToNull(Object raw) {
        if (raw == null) return null;
        String value = String.valueOf(raw).trim();
        return value.isEmpty() ? null : value;
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("订阅不存在");
        }
    }

    private Map<String, Object> envelope(UUID id, UUID userId, String outcome) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("outcome", outcome);
        result.put("subscription", project(demands.selectSubscriptionForUser(id, userId)));
        return result;
    }

    /** 订阅投影。不含 fingerprint、school_id 与 user_id：它们对客户端没有用途。 */
    static Map<String, Object> project(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("keyword", DomainMapper.nullableText(row.get("keyword")));
        result.put("category", DomainMapper.nullableText(row.get("category")));
        result.put("minPrice", row.get("min_price") == null ? null : ((BigDecimal) row.get("min_price")).doubleValue());
        result.put("maxPrice", row.get("max_price") == null ? null : ((BigDecimal) row.get("max_price")).doubleValue());
        result.put("geoScope", DomainMapper.text(row.get("geo_scope")));
        result.put("campusId", DomainMapper.nullableText(row.get("campus_id")));
        result.put("buildingId", DomainMapper.nullableText(row.get("building_id")));
        result.put("zone", DomainMapper.nullableText(row.get("anchor_zone")));
        result.put("buildingName", DomainMapper.nullableText(row.get("anchor_building_name")));
        // 模块 4：精确教材版本订阅的版本摘要（非教材订阅为 null）
        // 无 ISBN 的版本（含全部演示教材）isbn 为 null，而不是空字符串
        Map<String, Object> textbook = null;
        if (row.get("textbook_edition_id") != null) {
            textbook = new LinkedHashMap<>();
            textbook.put("id", DomainMapper.text(row.get("textbook_edition_id")));
            textbook.put("isbn", DomainMapper.nullableText(row.get("textbook_isbn")));
            textbook.put("title", DomainMapper.text(row.get("textbook_title")));
            textbook.put("editionLabel", DomainMapper.text(row.get("textbook_edition_label")));
            textbook.put("publisher", DomainMapper.text(row.get("textbook_publisher")));
        }
        result.put("textbook", textbook);
        // 模块 6：圈子范围订阅写明具体圈子名称
        Map<String, Object> circle = null;
        if (row.get("circle_id") != null) {
            circle = new LinkedHashMap<>();
            circle.put("id", DomainMapper.text(row.get("circle_id")));
            circle.put("name", DomainMapper.nullableText(row.get("circle_name")));
        }
        result.put("circle", circle);
        result.put("active", Boolean.TRUE.equals(row.get("active")));
        result.put("matchCount", row.get("match_count") instanceof Number n ? n.longValue() : 0L);
        result.put("createdAt", epoch(row.get("created_at")));
        result.put("updatedAt", epoch(row.get("updated_at")));
        return result;
    }

    private static Object epoch(Object value) {
        if (value instanceof java.sql.Timestamp t) return t.getTime();
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant().toEpochMilli();
        return value;
    }
}
