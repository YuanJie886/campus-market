package com.lulu.campusmarketbackend.building;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 楼栋集市 feed：范围自动降级与最近排序（1.3）。
 *
 * <p>「只看本楼」如果只是一个硬过滤，大多数时候的结果是空白页——一栋楼里同时在卖
 * 的东西本来就不多。所以开关打开时按 本楼 → 同园区 → 同校区 → 全校 逐级放宽，
 * 取第一个<b>有结果</b>的范围，并如实告诉用户实际用的是哪一级。
 *
 * <p>三条不可让步的约束：
 * <ul>
 *   <li>降级<b>只</b>在用户主动开启本楼时发生，普通浏览为空就是空；</li>
 *   <li>降级<b>只</b>放宽地理范围，keyword/分类/价格/成色等条件逐条保留；</li>
 *   <li>范围选择基于<b>总数</b>，在分页之前完成——否则翻到第二页时会因为
 *       「这一页碰巧为空」而莫名其妙地扩大范围。</li>
 * </ul>
 */
@Service
public class BuildingFeedService {

    /** 步行速度，米/分钟。用于把直线距离换算成「约 N 分钟」。 */
    public static final double WALK_METERS_PER_MINUTE = 80.0;

    private final ProductMapper products;
    private final UserMapper users;
    private final BuildingService buildings;
    private final DomainMapper mapper;

    public BuildingFeedService(ProductMapper products, UserMapper users,
                               BuildingService buildings, DomainMapper mapper) {
        this.products = products;
        this.users = users;
        this.buildings = buildings;
        this.mapper = mapper;
    }

    /** 一次 feed 查询的全部输入。 */
    public record FeedQuery(String category, String condition, String keyword,
                            Object minPrice, Object maxPrice,
                            BuildingScope requestedScope, String orderBy,
                            int page, int pageSize,
                            // 模块 4：只看关联了这些教材版本的商品；null 表示不限
                            List<String> textbookEditionIds,
                            // 模块 4：教材商品流只列在售商品
                            boolean onSaleOnly,
                            // 模块 6：圈子商品流（调用方已确认查看者是在籍成员）；null 表示不限
                            UUID circleId) {
        /** 楼栋集市原有调用：不限教材版本，沿用原有的状态过滤。 */
        public FeedQuery(String category, String condition, String keyword, Object minPrice, Object maxPrice,
                         BuildingScope requestedScope, String orderBy, int page, int pageSize) {
            this(category, condition, keyword, minPrice, maxPrice, requestedScope, orderBy, page, pageSize, null, false, null);
        }
        public FeedQuery(String category, String condition, String keyword, Object minPrice, Object maxPrice,
                         BuildingScope requestedScope, String orderBy, int page, int pageSize,
                         List<String> textbookEditionIds, boolean onSaleOnly) {
            this(category, condition, keyword, minPrice, maxPrice, requestedScope, orderBy, page, pageSize, textbookEditionIds, onSaleOnly, null);
        }
    }

    /**
     * @param viewerId 已认证用户 id；匿名为 null
     */
    public Map<String, Object> feed(FeedQuery query, String viewerId) {
        boolean needsOrigin = query.requestedScope() != BuildingScope.SCHOOL
                || "nearest".equals(query.orderBy());
        Origin origin = needsOrigin ? resolveOrigin(viewerId, query) : Origin.NONE;

        List<BuildingScope> chain = query.requestedScope().allowsFallback()
                ? query.requestedScope().fallbackChain()
                : List.of(query.requestedScope());

        BuildingScope effective = chain.get(chain.size() - 1);
        long total = 0;
        for (BuildingScope candidate : chain) {
            long count = count(query, viewerId, candidate, origin);
            if (count > 0) {
                effective = candidate;
                total = count;
                break;
            }
        }

        UUID viewer = viewerId == null ? null : UUID.fromString(viewerId);
        List<Map<String, Object>> rows = total == 0 ? List.of() : products.selectFeedRows(
                viewer, query.category(), query.condition(), query.keyword(),
                query.minPrice(), query.maxPrice(),
                effective.name(), origin.buildingId(), origin.campus(), origin.zone(),
                query.orderBy(), origin.buildingId(), origin.latitude(), origin.longitude(),
                query.textbookEditionIds(), query.onSaleOnly(), query.circleId(),
                query.pageSize(), (query.page() - 1) * query.pageSize());

        boolean fallbackApplied = effective != query.requestedScope();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("requestedScope", query.requestedScope().name());
        result.put("effectiveScope", effective.name());
        result.put("effectiveScopeLabel", effective.label());
        result.put("fallbackApplied", fallbackApplied);
        // 机器可读的原因码。前端据此组织文案，不解析中文。
        result.put("fallbackReason", fallbackApplied
                ? (total == 0 ? "NO_RESULTS_IN_ANY_SCOPE" : "NO_RESULTS_IN_REQUESTED_SCOPE")
                : null);
        result.put("items", rows.stream()
                .map(row -> item(row, viewerId, origin))
                .toList());
        result.put("total", total);
        result.put("page", query.page());
        result.put("pageSize", query.pageSize());
        return result;
    }

    private long count(FeedQuery query, String viewerId, BuildingScope scope, Origin origin) {
        UUID viewer = viewerId == null ? null : UUID.fromString(viewerId);
        return products.countFeedRows(viewer, query.category(), query.condition(), query.keyword(),
                query.minPrice(), query.maxPrice(),
                scope.name(), origin.buildingId(), origin.campus(), origin.zone(),
                query.textbookEditionIds(), query.onSaleOnly(), query.circleId());
    }

    private Map<String, Object> item(Map<String, Object> row, String viewerId, Origin origin) {
        Map<String, Object> item = new LinkedHashMap<>(
                mapper.product(row, viewerId != null && viewerId.equals(DomainMapper.text(row.get("seller_id")))));
        boolean sameBuilding = Boolean.TRUE.equals(row.get("same_building"));
        item.put("sameBuilding", sameBuilding);

        Object distance = row.get("distance_meters");
        if (sameBuilding) {
            // 同楼栋就是同楼栋。给一个 0 米 / 0 分钟的「导航结果」是假精确，
            // 用户需要的是「下楼就能拿」这句话，不是一个数字。
            item.put("approximateDistanceMeters", null);
            item.put("approximateWalkMinutes", null);
        } else if (distance instanceof Number meters && origin.hasCoordinates()) {
            long rounded = Math.round(meters.doubleValue());
            item.put("approximateDistanceMeters", rounded);
            item.put("approximateWalkMinutes", walkMinutes(rounded));
        } else {
            // 缺坐标（楼栋还没录入坐标，或商品本就没有楼栋）：不做伪精确估算
            item.put("approximateDistanceMeters", null);
            item.put("approximateWalkMinutes", null);
        }
        return item;
    }

    /** 直线距离 → 约几分钟步行。至少 1 分钟：不存在「0 分钟」的路程。 */
    public static long walkMinutes(long meters) {
        return Math.max(1, (long) Math.ceil(meters / WALK_METERS_PER_MINUTE));
    }

    /**
     * 解析「本楼」的起点。
     *
     * <p>后端<b>绝不</b>猜楼栋：未登录就是 401，没填宿舍楼就是 409，
     * 都不会退而返回全校结果冒充「本楼」。
     */
    private Origin resolveOrigin(String viewerId, FeedQuery query) {
        boolean buildingRequired = query.requestedScope() != BuildingScope.SCHOOL
                && query.requestedScope() != BuildingScope.CAMPUS;
        if (viewerId == null) {
            if (!buildingRequired && !"nearest".equals(query.orderBy())) return Origin.NONE;
            throw ApiException.unauthorized("请先登录后再使用本楼范围");
        }
        Map<String, Object> user = users.selectRowById(UUID.fromString(viewerId));
        if (user == null) throw ApiException.unauthorized("登录已失效，请重新登录");

        String campus = DomainMapper.text(user.get("campus"));
        String dorm = DomainMapper.nullableText(user.get("dorm_building_id"));
        if (dorm == null || dorm.isBlank()) {
            if (buildingRequired || "nearest".equals(query.orderBy())) {
                throw ApiException.conflict("请先在个人资料中选择宿舍楼");
            }
            return new Origin(null, campus, null, null, null);
        }

        Map<String, Object> row = buildings.rowById(dorm);
        if (row == null || !Boolean.TRUE.equals(row.get("active"))) {
            // 宿舍楼被停用：不静默退回校区，让用户重新选一栋
            throw ApiException.conflict("你选择的宿舍楼已停用，请在个人资料中重新选择");
        }
        return new Origin(dorm, DomainMapper.text(row.get("campus_id")), DomainMapper.text(row.get("zone")),
                doubleOrNull(row.get("latitude")), doubleOrNull(row.get("longitude")));
    }

    private static Double doubleOrNull(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }

    /** 距离与范围计算的起点：用户的宿舍楼及其园区、校区与坐标。 */
    private record Origin(String buildingId, String campus, String zone, Double latitude, Double longitude) {
        static final Origin NONE = new Origin(null, null, null, null, null);

        boolean hasCoordinates() {
            return latitude != null && longitude != null;
        }
    }
}
