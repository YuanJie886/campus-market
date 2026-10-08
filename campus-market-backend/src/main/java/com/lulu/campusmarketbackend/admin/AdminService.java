package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.*;

@Service
public class AdminService {
    private final JdbcTemplate jdbc;
    private final AdminPermissions access;
    private final DomainMapper mapper;
    private record Resource(String fields, String from, String scope, String search, Map<String, String> sorts) {}
    private static final String ORDER_FIELDS = """
        o.id, o.product_id AS "productId", o.buyer_id AS "buyerId", o.seller_id AS "sellerId", o.status,
        COALESCE(o.price_snapshot,o.price) AS price, o.price_snapshot AS "priceSnapshot", o.currency,
        o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.expires_at AS "expiresAt",
        o.meeting_at AS "meetingAt", o.meeting_ends_at AS "meetingEndsAt", o.meeting_revision AS "meetingRevision",
        o.meeting_point_id AS "meetingPointId", mp.name AS "meetingPointName", mp.campus_id AS "meetingCampus",
        o.category_snapshot AS "categorySnapshot", o.condition_snapshot AS "conditionSnapshot",
        o.listing_kind_snapshot AS "listingKindSnapshot", o.school_id_snapshot AS "schoolIdSnapshot",
        p.title AS "productTitle", p.category AS "productCategory", p.campus AS "productCampus",
        p.status AS "productStatus", p.images ->> 0 AS "productImage",
        buyer.nickname AS "buyerNickname", buyer.account AS "buyerAccount", buyer.campus AS "buyerCampus", buyer.avatar AS "buyerAvatar",
        seller.nickname AS "sellerNickname", seller.account AS "sellerAccount", seller.campus AS "sellerCampus", seller.avatar AS "sellerAvatar"
        """;
    private static final String ORDER_JOINS = """
        orders o JOIN products p ON p.id=o.product_id JOIN campuses c ON c.id=p.campus
        JOIN users buyer ON buyer.id=o.buyer_id JOIN users seller ON seller.id=o.seller_id
        LEFT JOIN meeting_points mp ON mp.id=o.meeting_point_id
        """;
    // SQL 结构只从此白名单读取；搜索、学校、ID、页码都用绑定参数。
    private static final Map<String, Resource> RESOURCES = Map.of(
        "users", new Resource("u.id, u.account, u.nickname, u.campus, u.created_at AS \"createdAt\", s.role, COALESCE(s.active,false) AS active",
            "users u JOIN campuses c ON c.id=u.campus LEFT JOIN staff_members s ON s.user_id=u.id AND s.school_id=c.school_id",
            "c.school_id", "u.nickname || ' ' || u.account", Map.of("id", "u.id", "createdAt", "u.created_at", "nickname", "u.nickname")),
        "products", new Resource("p.id, p.title, p.category, p.price, p.status, p.campus, p.seller_id AS \"sellerId\", p.created_at AS \"createdAt\", (p.moderation_hidden_at IS NOT NULL) AS \"moderationHidden\"",
            "products p JOIN campuses c ON c.id=p.campus", "c.school_id", "p.title", Map.of("id", "p.id", "createdAt", "p.created_at", "title", "p.title", "price", "p.price")),
        "orders", new Resource(ORDER_FIELDS, ORDER_JOINS, "COALESCE(o.school_id_snapshot,c.school_id)",
            "concat_ws(' ',o.id::text,p.title,buyer.nickname,buyer.account,seller.nickname,seller.account)",
            Map.of("id", "o.id", "createdAt", "o.created_at", "price", "COALESCE(o.price_snapshot,o.price)")),
        "audit", new Resource("a.id, a.staff_user_id AS \"actorId\", a.target_user_id AS \"targetId\", a.old_role AS \"oldRole\", a.new_role AS \"newRole\", a.old_active AS \"oldActive\", a.new_active AS \"newActive\", a.note, a.request_id AS \"requestId\", a.created_at AS \"createdAt\"",
            "admin_staff_audit a", "a.school_id", "a.target_user_id::text", Map.of("id", "a.id", "createdAt", "a.created_at"))
    );

    public AdminService(JdbcTemplate jdbc, AdminPermissions access, DomainMapper mapper) { this.jdbc = jdbc; this.access = access; this.mapper = mapper; }

    public Map<String, Object> me(String uid) {
        StaffGuard.Staff member = access.identity(uid);
        Map<String, Object> user = jdbc.queryForMap("SELECT nickname FROM users WHERE id=?", member.userId());
        return Map.of("id", uid, "fullName", user.get("nickname"), "schoolId", member.schoolId(),
                "role", member.role(), "permissions", AdminPermissions.permissions(member.role()));
    }

    public Map<String, Object> list(String uid, String resource, Map<String, String> query) {
        StaffGuard.Staff member = access.require(uid, resource + ":read");
        rejectQuery(query, resource);
        int page = positive(query.getOrDefault("page", "1"), 10000);
        int perPage = positive(query.getOrDefault("perPage", "25"), 100);
        if ("roles".equals(resource)) {
            List<Map<String, Object>> roles = AdminPermissions.ROLES.entrySet().stream().sorted(Map.Entry.comparingByKey())
                    .map(e -> Map.<String, Object>of("id", e.getKey(), "name", e.getValue(), "permissions", AdminPermissions.permissions(e.getKey()))).toList();
            int start = Math.min((page - 1) * perPage, roles.size());
            return Map.of("items", roles.subList(start, Math.min(start + perPage, roles.size())), "total", roles.size());
        }
        Resource definition = definition(resource);
        String sort = query.getOrDefault("sort", "createdAt"), order = query.getOrDefault("order", "DESC");
        if (!definition.sorts.containsKey(sort) || !Set.of("ASC", "DESC").contains(order)) throw ApiException.badRequest("排序参数无效");
        String keyword = query.getOrDefault("q", "").trim();
        if (keyword.length() > 100) throw ApiException.badRequest("搜索内容过长");
        String where = " WHERE " + definition.scope + "=?";
        List<Object> args = new ArrayList<>(List.of(member.schoolId()));

        if (!keyword.isEmpty()) {
            // literal contains search: %, _ 和反斜杠不能被当成通配符。
            where += " AND " + definition.search + " ILIKE ? ESCAPE '\\'";
            args.add("%" + keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM " + definition.from + where, Long.class, args.toArray());
        args.add(perPage); args.add((page - 1) * perPage);
        String sortSql = definition.sorts.get(sort) + " " + order;
        if (!"id".equals(sort)) sortSql += ", " + definition.sorts.get("id") + " " + order;
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT " + definition.fields + " FROM " + definition.from + where
                + " ORDER BY " + sortSql + " LIMIT ? OFFSET ?", args.toArray());
        return Map.of("items", rows.stream().map(AdminService::normalize).toList(), "total", total == null ? 0L : total);
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String, Object> one(String uid, String resource, String id) {
        StaffGuard.Staff member = access.require(uid, resource + ":read");
        if ("roles".equals(resource)) {
            if (!AdminPermissions.ROLES.containsKey(id)) throw ApiException.notFound("角色不存在");
            return Map.of("id", id, "name", AdminPermissions.ROLES.get(id), "permissions", AdminPermissions.permissions(id));
        }
        Resource definition = definition(resource);
        String fields = definition.fields;
        if ("orders".equals(resource)) fields += ", p.description AS \"productDescription\", p.condition AS \"productCondition\", p.price AS \"productCurrentPrice\", p.listing_kind AS \"productListingKind\", p.images AS \"productImages\"";
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT " + fields + " FROM " + definition.from
                + " WHERE " + definition.scope + "=? AND " + definition.sorts.get("id") + "=?", member.schoolId(), uuid(id));
        if (rows.isEmpty()) throw ApiException.notFound("记录不存在");
        Map<String, Object> result = normalize(rows.get(0));
        if ("orders".equals(resource)) addOrderDetails(result);

        return result;
    }

    private void addOrderDetails(Map<String, Object> order) {
        UUID orderId = uuid(String.valueOf(order.get("id")));
        order.put("productImages", mapper.jsonArray(order.get("productImages")));
        // 只投影交易展示所需字段，不返回确认码、会话、联系方式或幂等凭据。
        List<Map<String, Object>> events = jdbc.queryForList("""
            SELECT h.*, actor.nickname AS "actorNickname" FROM (
                SELECT e.id::text AS id, e.actor_id AS "actorId", e.from_status AS "fromStatus", e.to_status AS "toStatus",
                    'STATUS_CHANGED' AS "eventCode", NULL::integer AS "meetingRevision", e.reason, e.created_at AS "createdAt"
                FROM order_events e WHERE e.order_id=?
                UNION ALL
                SELECT 'flow-' || f.seq::text AS id, f.actor_id AS "actorId", NULL, NULL,
                    f.event_code, f.meeting_revision, NULL, f.created_at
                FROM order_flow_events f WHERE f.order_id=?
            ) h LEFT JOIN users actor ON actor.id=h."actorId" ORDER BY h."createdAt", h.id
            """, orderId, orderId);
        order.put("events", events.stream().map(AdminService::normalize).toList());
        order.put("reviews", jdbc.queryForList("""
            SELECT r.id, r.reviewer_id AS "reviewerId", u.nickname AS "reviewerNickname", r.rating, r.comment, r.created_at AS "createdAt"
            FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.order_id=? ORDER BY r.created_at,r.id
            """, orderId).stream().map(AdminService::normalize).toList());
        List<Map<String, Object>> cancellations = jdbc.queryForList("""
            SELECT actor_user_id AS "actorId", phase, reason_code AS "reasonCode", note, created_at AS "createdAt"
            FROM order_cancellations WHERE order_id=?
            """, orderId);
        order.put("cancellation", cancellations.isEmpty() ? null : normalize(cancellations.get(0)));
        order.put("bundleItems", jdbc.queryForList("""
            SELECT item_code AS id, name, category, condition, quantity, note
            FROM bundle_items WHERE product_id=? ORDER BY sort_order,item_code
            """, uuid(String.valueOf(order.get("productId")))).stream().map(AdminService::normalize).toList());
    }

    /** 授权与审计同一事务提交；按学校加锁，撤销的操作者权限在锁后再次检查。 */
    @Transactional
    public Map<String, Object> updateStaff(String uid, String id, Map<String, Object> body, String requestId) {
        StaffGuard.Staff actor = access.require(uid, "users:write");
        JsonFieldPolicy.rejectUnknown(body, Set.of("role", "active", "note"));
        String role = AuthService.string(body, "role", 1, 40);
        if (!AdminPermissions.ROLES.containsKey(role)) throw ApiException.badRequest("角色无效");
        if (!(body.get("active") instanceof Boolean active)) throw ApiException.badRequest("请选择是否启用后台权限");
        String note = AuthService.string(body, "note", 1, 500);
        UUID target = uuid(id);
        if (target.equals(actor.userId())) throw ApiException.forbidden("不能修改自己的后台权限");
        jdbc.queryForObject("SELECT id FROM schools WHERE id=? FOR UPDATE", String.class, actor.schoolId());
        actor = access.require(uid, "users:write");
        // 锁住目标账号，防止校区在校验与授权之间被修改。
        List<Map<String, Object>> targetUsers = jdbc.queryForList("SELECT u.id FROM users u JOIN campuses c ON c.id=u.campus WHERE u.id=? AND c.school_id=? FOR UPDATE OF u", target, actor.schoolId());
        if (targetUsers.isEmpty()) throw ApiException.notFound("用户不存在");
        List<Map<String, Object>> oldRows = jdbc.queryForList("SELECT role,active FROM staff_members WHERE user_id=? FOR UPDATE", target);
        Map<String, Object> old = oldRows.isEmpty() ? Map.of() : oldRows.get(0);
        if (role.equals(old.get("role")) && Boolean.valueOf(active).equals(old.get("active"))) return one(uid, "users", id);
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role,active) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET school_id=EXCLUDED.school_id,role=EXCLUDED.role,active=EXCLUDED.active,updated_at=clock_timestamp()",
                target, actor.schoolId(), role, active);
        jdbc.update("INSERT INTO admin_staff_audit(id,school_id,staff_user_id,target_user_id,old_role,new_role,old_active,new_active,note,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID(), actor.schoolId(), actor.userId(), target, old.get("role"), role, old.get("active"), active, note, requestId);
        return one(uid, "users", id);
    }

    private static Resource definition(String resource) {
        Resource definition = RESOURCES.get(resource);
        if (definition == null) throw ApiException.notFound("资源不存在");
        return definition;
    }
    public static UUID uuid(String id) {
        try { return UUID.fromString(id); } catch (IllegalArgumentException | NullPointerException e) { throw ApiException.badRequest("编号无效"); }
    }
    public static int positive(String raw, int max) {
        try { int value = Integer.parseInt(raw); if (value > 0 && value <= max) return value; }
        catch (NumberFormatException ignored) { }
        throw ApiException.badRequest("分页参数无效");
    }
    private static void rejectQuery(Map<String, String> query, String resource) {
        Set<String> allowed = new HashSet<>(Set.of("page", "perPage", "sort", "order", "q"));
        if (!allowed.containsAll(query.keySet())) throw ApiException.badRequest("查询参数无效");
    }
    private static Map<String, Object> normalize(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        row.forEach((key, value) -> {
            if (value instanceof UUID) value = value.toString();
            if (value instanceof Timestamp t) value = t.toInstant().toEpochMilli();
            if (value instanceof OffsetDateTime t) value = t.toInstant().toEpochMilli();
            result.put(key, value);
        });
        return result;
    }
}
