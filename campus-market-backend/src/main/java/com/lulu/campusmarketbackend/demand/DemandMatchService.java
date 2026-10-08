package com.lulu.campusmarketbackend.demand;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.DemandMapper;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 需求匹配引擎与收件箱（2.3 / 2.4）。
 *
 * <p>{@link #evaluate} 只能在商品写入的<b>同一个事务</b>里调用
 * （{@link Propagation#MANDATORY}）：商品接口返回成功时，对应的匹配已经提交；
 * 匹配失败会让整个商品写入回滚，不存在「发布成功但没有匹配」的中间状态。
 * 这里不发送任何外部消息、不调用推送服务。
 */
@Service
public class DemandMatchService {

    private final DemandMapper demands;
    private final ProductMapper products;
    private final DomainMapper mapper;

    private final com.lulu.campusmarketbackend.circle.ProductVisibility visibility;

    public DemandMatchService(DemandMapper demands, ProductMapper products, DomainMapper mapper,
                              com.lulu.campusmarketbackend.circle.ProductVisibility visibility) {
        this.visibility = visibility;
        this.demands = demands;
        this.products = products;
        this.mapper = mapper;
    }

    /**
     * 对一件商品重新计算全部匹配。发布、编辑、上下架都走这一个入口。
     *
     * <ol>
     *   <li>商品不在售 → 候选集为空，全部未处理的匹配标记失效；</li>
     *   <li>否则按硬性条件查出候选订阅（一条 SQL），逐个评分；</li>
     *   <li>候选写入或刷新（一条批量 UPSERT，(订阅, 商品) 唯一，不会重复）；</li>
     *   <li>不在候选里的旧匹配标记失效（一条 UPDATE）。</li>
     * </ol>
     *
     * <p>无论命中多少订阅，都只有固定的几条语句，不产生 N+1。
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void evaluate(UUID productId) {
        Map<String, Object> product = products.selectRowById(productId);
        if (product == null) return;

        List<DemandMapper.MatchRow> rows = new ArrayList<>();
        if ("在售".equals(product.get("status"))) {
            String campus = DomainMapper.text(product.get("campus"));
            String school = demands.selectCampusSchool(campus);
            String buildingId = DomainMapper.nullableText(product.get("building_id"));
            String zone = DomainMapper.nullableText(product.get("building_zone"));
            String title = DemandText.normalize(DomainMapper.text(product.get("title")));
            String description = DemandText.normalize(DomainMapper.text(product.get("description")));
            BigDecimal price = (BigDecimal) product.get("price");
            String category = DomainMapper.text(product.get("category"));
            // 模块 4：商品关联的教材版本（selectRowById 已 LEFT JOIN）；未关联为 null
            String textbookEditionId = DomainMapper.nullableText(product.get("tb_edition_id"));

            // 模块 6：圈子可见的商品只在它关联的圈子里匹配；公开商品只匹配普通订阅（circleIds = null）
            List<UUID> circleIds = "CIRCLE_ONLY".equals(product.get("visibility")) ? visibility.linkedCircles(productId) : null;
            List<Map<String, Object>> candidates = circleIds != null && circleIds.isEmpty() ? List.of() : demands.selectMatchCandidates(
                    school, (UUID) product.get("seller_id"), category, price,
                    title, description, campus, buildingId, zone, textbookEditionId, circleIds);

            DemandScorer.Product scored = new DemandScorer.Product(
                    title, description, category, price, campus, buildingId, zone, textbookEditionId);
            record Ranked(Map<String, Object> row, DemandScorer.Score score) {}
            List<Ranked> ranked = new ArrayList<>();
            for (Map<String, Object> row : candidates) {
                ranked.add(new Ranked(row, DemandScorer.score(subscriptionOf(row), scored)));
            }
            // 确定性顺序：分数降序，其次订阅创建时间、订阅 id
            // 时间按真实时刻比较：OffsetDateTime.toString() 会省略末尾的零，按字符串排序会出错
            ranked.sort(Comparator
                    .comparingInt((Ranked r) -> -r.score().value())
                    .thenComparing(r -> instant(r.row().get("created_at")))
                    .thenComparing(r -> r.row().get("id").toString()));
            for (Ranked r : ranked) {
                rows.add(new DemandMapper.MatchRow(UUID.randomUUID(), (UUID) r.row().get("id"),
                        r.score().value(), "{" + String.join(",", r.score().reasonCodes()) + "}"));
            }
        }

        if (!rows.isEmpty()) demands.upsertMatches(productId, rows);
        demands.invalidateMatchesExcept(productId, rows.stream().map(DemandMapper.MatchRow::subscriptionId).toList());
    }

    private static java.time.Instant instant(Object value) {
        if (value instanceof java.sql.Timestamp t) return t.toInstant();
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant();
        throw new IllegalStateException("无法识别的时间类型：" + value);
    }

    private static DemandScorer.Subscription subscriptionOf(Map<String, Object> row) {
        return new DemandScorer.Subscription(
                DomainMapper.nullableText(row.get("normalized_keyword")),
                DomainMapper.nullableText(row.get("category")),
                (BigDecimal) row.get("min_price"), (BigDecimal) row.get("max_price"),
                DomainMapper.text(row.get("geo_scope")),
                DomainMapper.nullableText(row.get("campus_id")),
                DomainMapper.nullableText(row.get("building_id")),
                DomainMapper.nullableText(row.get("anchor_zone")),
                DomainMapper.nullableText(row.get("textbook_edition_id")));
    }

    // ------------------------------------------------------------------
    // 收件箱
    // ------------------------------------------------------------------

    public Map<String, Object> inbox(String uid, int page, int pageSize) {
        UUID userId = UUID.fromString(uid);
        List<Map<String, Object>> rows = demands.selectMatchesForUser(userId, pageSize, (page - 1) * pageSize);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", rows.stream().map(this::project).toList());
        result.put("total", demands.countMatchesForUser(userId));
        result.put("page", page);
        result.put("pageSize", pageSize);
        return result;
    }

    public Map<String, Object> unreadCount(String uid) {
        return Map.of("count", demands.countUnread(UUID.fromString(uid)));
    }

    @Transactional
    public Map<String, Object> markRead(String uid, String id) {
        if (demands.markRead(parseId(id), UUID.fromString(uid)) == 0) throw ApiException.notFound("匹配不存在");
        return unreadCount(uid);
    }

    @Transactional
    public Map<String, Object> dismiss(String uid, String id) {
        if (demands.dismiss(parseId(id), UUID.fromString(uid)) == 0) throw ApiException.notFound("匹配不存在");
        return unreadCount(uid);
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            // 与「不存在」同一语义：不向调用方暴露 id 的格式细节
            throw ApiException.notFound("匹配不存在");
        }
    }

    /**
     * 收件箱条目。商品按<b>非本人</b>视角投影：卖家联系方式不在这里出现，
     * 买家仍须走站内消息或预约流程。「是否仍可预约」由服务端给出，
     * 前端据此决定是否展示「去预约面交」。
     */
    private Map<String, Object> project(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("match_id")));
        result.put("score", row.get("match_score"));
        // 档位由服务端给出：前端只做「档位 → 文案/样式」映射，不再由分数自行推导
        result.put("tier", DemandScorer.tier(((Number) row.get("match_score")).intValue()));
        result.put("reasonCodes", reasonCodes(row.get("match_reason_codes")));
        result.put("read", row.get("match_read_at") != null);
        boolean invalidated = row.get("match_invalidated_at") != null;
        boolean onSale = "在售".equals(row.get("status"));
        result.put("valid", !invalidated && onSale);
        // 机器可读的失效原因，中文只在前端映射
        result.put("invalidReason", invalidated ? "NO_LONGER_MATCHES" : onSale ? null : "NOT_ON_SALE");
        result.put("createdAt", epoch(row.get("match_created_at")));
        result.put("product", mapper.product(row, false));

        Map<String, Object> subscription = new LinkedHashMap<>();
        subscription.put("id", DomainMapper.text(row.get("sub_id")));
        subscription.put("keyword", DomainMapper.nullableText(row.get("sub_keyword")));
        subscription.put("category", DomainMapper.nullableText(row.get("sub_category")));
        subscription.put("minPrice", row.get("sub_min_price") == null ? null : ((BigDecimal) row.get("sub_min_price")).doubleValue());
        subscription.put("maxPrice", row.get("sub_max_price") == null ? null : ((BigDecimal) row.get("sub_max_price")).doubleValue());
        subscription.put("geoScope", DomainMapper.text(row.get("sub_geo_scope")));
        subscription.put("campusId", DomainMapper.nullableText(row.get("sub_campus_id")));
        subscription.put("buildingId", DomainMapper.nullableText(row.get("sub_building_id")));
        subscription.put("zone", DomainMapper.nullableText(row.get("sub_zone")));
        subscription.put("buildingName", DomainMapper.nullableText(row.get("sub_building_name")));
        Map<String, Object> textbook = null;
        if (row.get("sub_textbook_edition_id") != null) {
            textbook = new LinkedHashMap<>();
            textbook.put("id", DomainMapper.text(row.get("sub_textbook_edition_id")));
            textbook.put("isbn", DomainMapper.nullableText(row.get("sub_textbook_isbn")));
            textbook.put("title", DomainMapper.text(row.get("sub_textbook_title")));
            textbook.put("editionLabel", DomainMapper.text(row.get("sub_textbook_edition_label")));
        }
        subscription.put("textbook", textbook);
        result.put("subscription", subscription);
        return result;
    }

    private static List<String> reasonCodes(Object raw) {
        try {
            if (raw instanceof Array array) return List.of((String[]) array.getArray());
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        if (raw instanceof String[] values) return List.of(values);
        return List.of();
    }

    private static Object epoch(Object value) {
        if (value instanceof java.sql.Timestamp t) return t.getTime();
        if (value instanceof java.time.OffsetDateTime o) return o.toInstant().toEpochMilli();
        return value;
    }
}
