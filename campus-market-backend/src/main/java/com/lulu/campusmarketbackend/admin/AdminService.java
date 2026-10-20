package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.governance.ConflictGuard;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import com.lulu.campusmarketbackend.governance.StaffModerationService;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.*;

/**
 * 运营后台。阶段 2 起：
 * <ul>
 *   <li>涉及学校管理员（授予、降级、停用）的人员变更由一人发起、另一位本校学校管理员确认才生效（admin_role_requests）；
 *       每校至少保留一名在岗学校管理员（服务端预检 + V17 数据库守卫）；</li>
 *   <li>读取用户、历史订单、授权审计、复核请求与读取审计时留痕（admin_read_audit；搜索词只存 SHA-256）；</li>
 *   <li>按工作人员限流：读取与写入分开计数；</li>
 *   <li>商品的直接管理做利益回避：本人商品、本人举报过、与它有联系申请往来的工作人员都不能管理（V17 staff_product_conflict）。</li>
 * </ul>
 */
@Service
public class AdminService {
    private static final Set<String> AUDITED_READS = Set.of("users", "orders", "audit", "role-requests", "read-audit");
    private final JdbcTemplate jdbc;
    private final AdminPermissions access;
    private final DomainMapper mapper;
    private final StaffModerationService moderation;
    private final ConflictGuard conflicts;
    private final RateLimitService rateLimit;
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
        "users", new Resource("u.id, u.account, u.nickname, u.campus, u.created_at AS \"createdAt\", s.role, COALESCE(s.active,false) AS active, (u.deleted_at IS NOT NULL) AS deleted",
            "users u JOIN campuses c ON c.id=u.campus LEFT JOIN staff_members s ON s.user_id=u.id AND s.school_id=c.school_id",
            "c.school_id", "u.nickname || ' ' || u.account", Map.of("id", "u.id", "createdAt", "u.created_at", "nickname", "u.nickname")),
        "products", new Resource("p.id, p.title, p.category, p.price, p.status, p.campus, p.condition, p.listing_kind AS \"listingKind\", p.images ->> 0 AS image, p.seller_id AS \"sellerId\", seller.nickname AS \"sellerNickname\", seller.account AS \"sellerAccount\", p.created_at AS \"createdAt\", (p.moderation_hidden_at IS NOT NULL) AS \"moderationHidden\", md5(jsonb_build_array(p.title,p.description,p.price,p.status,p.moderation_hidden_action_id)::text) AS version",
            "products p JOIN campuses c ON c.id=p.campus JOIN users seller ON seller.id=p.seller_id", "c.school_id", "concat_ws(' ',p.title,p.id::text,seller.nickname,seller.account)", Map.of("id", "p.id", "createdAt", "p.created_at", "title", "p.title", "price", "p.price")),
        "orders", new Resource(ORDER_FIELDS, ORDER_JOINS, "COALESCE(o.school_id_snapshot,c.school_id)",
            "concat_ws(' ',o.id::text,p.title,buyer.nickname,buyer.account,seller.nickname,seller.account)",
            Map.of("id", "o.id", "createdAt", "o.created_at", "price", "COALESCE(o.price_snapshot,o.price)")),
        "audit", new Resource("a.id, a.staff_user_id AS \"actorId\", a.target_user_id AS \"targetId\", a.old_role AS \"oldRole\", a.new_role AS \"newRole\", a.old_active AS \"oldActive\", a.new_active AS \"newActive\", a.note, a.request_id AS \"requestId\", a.confirmed_by AS \"confirmedBy\", a.role_request_id AS \"roleRequestId\", a.created_at AS \"createdAt\"",
            "admin_staff_audit a", "a.school_id", "a.target_user_id::text", Map.of("id", "a.id", "createdAt", "a.created_at")),
        "role-requests", new Resource("""
            r.id, r.target_user_id AS "targetId", t.nickname AS "targetNickname", t.account AS "targetAccount",
            r.requested_by AS "requestedBy", rq.nickname AS "requesterNickname", r.old_role AS "oldRole", r.old_active AS "oldActive",
            r.new_role AS "newRole", r.new_active AS "newActive", r.note,
            CASE WHEN r.status = 'PENDING' AND r.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE r.status END AS status,
            r.decided_by AS "decidedBy", d.nickname AS "deciderNickname", r.decision_note AS "decisionNote",
            r.decided_at AS "decidedAt", r.expires_at AS "expiresAt", r.created_at AS "createdAt"
            """,
            "admin_role_requests r JOIN users t ON t.id=r.target_user_id JOIN users rq ON rq.id=r.requested_by LEFT JOIN users d ON d.id=r.decided_by",
            "r.school_id", "concat_ws(' ',t.nickname,t.account,rq.nickname)", Map.of("id", "r.id", "createdAt", "r.created_at")),
        "read-audit", new Resource("""
            a.id, a.staff_user_id AS "actorId", u.nickname AS "actorNickname", a.resource, a.record_id AS "recordId",
            a.result_count AS "resultCount", (a.query_digest IS NOT NULL) AS "withQuery", a.request_id AS "requestId", a.created_at AS "createdAt"
            """,
            "admin_read_audit a JOIN users u ON u.id=a.staff_user_id", "a.school_id", "concat_ws(' ',u.nickname,a.resource)",
            Map.of("id", "a.id", "createdAt", "a.created_at"))
    );

    public AdminService(JdbcTemplate jdbc, AdminPermissions access, DomainMapper mapper, StaffModerationService moderation,
                        ConflictGuard conflicts, RateLimitService rateLimit) {
        this.jdbc = jdbc; this.access = access; this.mapper = mapper; this.moderation = moderation;
        this.conflicts = conflicts; this.rateLimit = rateLimit;
    }

    public Map<String, Object> me(String uid) {
        StaffGuard.Staff member = access.identity(uid);
        Map<String, Object> user = jdbc.queryForMap("SELECT nickname FROM users WHERE id=?", member.userId());
        return Map.of("id", uid, "fullName", user.get("nickname"), "schoolId", member.schoolId(),
                "role", member.role(), "permissions", AdminPermissions.permissions(member.role()));
    }

    public Map<String, Object> list(String uid, String resource, Map<String, String> query, String requestId) {
        StaffGuard.Staff member = access.require(uid, resource + ":read");
        rateLimit.consume(RateLimitService.Scope.ADMIN_READ, uid);
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
        if ("role-requests".equals(resource) && query.get("status") != null && !query.get("status").isBlank()) {
            String status = query.get("status");
            if (!Set.of("PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED").contains(status)) throw ApiException.badRequest("复核状态无效");
            where += switch (status) {
                case "PENDING" -> " AND r.status='PENDING' AND r.expires_at > clock_timestamp()";
                case "EXPIRED" -> " AND (r.status='EXPIRED' OR (r.status='PENDING' AND r.expires_at <= clock_timestamp()))";
                default -> " AND r.status=?";
            };
            if (!Set.of("PENDING", "EXPIRED").contains(status)) args.add(status);
        }
        if ("products".equals(resource)) {
            for (String field : List.of("status", "category", "campus")) {
                String value = query.get(field);
                if (value != null && !value.isBlank()) {
                    if (value.length() > 100) throw ApiException.badRequest("筛选参数过长");
                    where += " AND p." + field + "=?"; args.add(value);
                }
            }
            if (query.containsKey("moderationHidden")) {
                String value = query.get("moderationHidden");
                if (!Set.of("true", "false").contains(value)) throw ApiException.badRequest("隐藏状态无效");
                where += " AND (p.moderation_hidden_at IS NOT NULL)=?"; args.add(Boolean.parseBoolean(value));
            }
        }
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
        if (AUDITED_READS.contains(resource)) auditRead(member, resource, null, rows.size(), keyword, requestId);
        List<Map<String, Object>> items = rows.stream().map(AdminService::normalize).map(this::signImages).toList();
        return Map.of("items", items, "total", total == null ? 0L : total);
    }

    /** 后台详情：限流并为个人信息类记录留痕。 */
    @Transactional(isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String, Object> one(String uid, String resource, String id, String requestId) {
        StaffGuard.Staff member = access.require(uid, resource + ":read");
        rateLimit.consume(RateLimitService.Scope.ADMIN_READ, uid);
        if ("read-audit".equals(resource)) throw ApiException.notFound("记录不存在");
        Map<String, Object> result = one(uid, resource, id);
        if (AUDITED_READS.contains(resource)) auditRead(member, resource, uuid(id), null, null, requestId);
        return result;
    }

    /** 只记录谁、何时、读了哪类记录与条数；搜索词可能本身就是个人信息，只存它的 SHA-256。 */
    private void auditRead(StaffGuard.Staff member, String resource, UUID recordId, Integer count, String keyword, String requestId) {
        String digest = keyword == null || keyword.isBlank() ? null : sha256(keyword.trim().toLowerCase(Locale.ROOT));
        jdbc.update("INSERT INTO admin_read_audit(school_id,staff_user_id,resource,record_id,result_count,query_digest,request_id) VALUES (?,?,?,?,?,?,?)",
                member.schoolId(), member.userId(), resource, recordId, count, digest, requestId);
    }

    private static String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 内部读取（不限流、不留痕）：调用方已经完成授权与审计。 */
    private Map<String, Object> one(String uid, String resource, String id) {
        StaffGuard.Staff member = access.require(uid, resource + ":read");
        if ("roles".equals(resource)) {
            if (!AdminPermissions.ROLES.containsKey(id)) throw ApiException.notFound("角色不存在");
            return Map.of("id", id, "name", AdminPermissions.ROLES.get(id), "permissions", AdminPermissions.permissions(id));
        }
        Resource definition = definition(resource);
        String fields = definition.fields;
        if ("products".equals(resource)) fields += ", p.description, p.images, p.original_price AS \"originalPrice\", p.views, p.visibility";
        if ("orders".equals(resource)) fields += ", p.description AS \"productDescription\", p.condition AS \"productCondition\", p.price AS \"productCurrentPrice\", p.listing_kind AS \"productListingKind\", p.images AS \"productImages\"";
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT " + fields + " FROM " + definition.from
                + " WHERE " + definition.scope + "=? AND " + definition.sorts.get("id") + "=?", member.schoolId(), uuid(id));
        if (rows.isEmpty()) throw ApiException.notFound("记录不存在");
        Map<String, Object> result = signImages(normalize(rows.get(0)));
        if ("orders".equals(resource)) addOrderDetails(result);
        if ("products".equals(resource)) {
            result.put("images", mapper.imageUrls(result.get("images")));
            result.put("bundleItems", jdbc.queryForList("SELECT item_code AS id,name,category,condition,quantity,note FROM bundle_items WHERE product_id=? ORDER BY sort_order,item_code", uuid(id)));
            result.put("history", jdbc.queryForList("""
                SELECT h.*, u.nickname AS "actorNickname" FROM (
                    SELECT id,staff_user_id AS "actorId",action_code AS action,note,created_at AS "createdAt"
                    FROM moderation_actions WHERE target_type='PRODUCT' AND target_id=? AND school_id=?
                    UNION ALL
                    SELECT id,staff_user_id,'EDIT_PRODUCT',note,created_at FROM admin_product_audit WHERE product_id=? AND school_id=?
                ) h JOIN users u ON u.id=h."actorId" ORDER BY h."createdAt" DESC,h.id DESC
                """, uuid(id), member.schoolId(), uuid(id), member.schoolId()).stream().map(AdminService::normalize).toList());
        }
        return result;
    }

    private Map<String, Object> lockManagedProduct(String uid, String id, Map<String, Object> body) {
        StaffGuard.Staff actor = access.require(uid, "products:write");
        jdbc.queryForObject("SELECT id FROM schools WHERE id=? FOR UPDATE", String.class, actor.schoolId());
        actor = access.require(uid, "products:write");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT p.id FROM products p JOIN campuses c ON c.id=p.campus WHERE p.id=? AND c.school_id=? FOR UPDATE OF p", uuid(id), actor.schoolId());
        if (rows.isEmpty()) throw ApiException.notFound("商品不存在");
        Map<String, Object> product = one(uid, "products", id);
        // 利益回避：本人商品、本人举报过、与它有联系申请往来（V17 staff_product_conflict）
        conflicts.requireNoProductConflict(uuid(id), actor.userId());
        if (!Objects.equals(product.get("version"), body.get("version"))) throw ApiException.conflict("商品已发生变化，请刷新后重试");
        return product;
    }

    @Transactional
    public Map<String, Object> updateProduct(String uid, String id, Map<String, Object> body, String requestId) {
        access.require(uid, "products:write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
        JsonFieldPolicy.rejectUnknown(body, Set.of("title", "description", "price", "note", "version"));
        String title = AuthService.string(body, "title", 1, 100), description = AuthService.string(body, "description", 1, 4000);
        String note = AuthService.string(body, "note", 1, 500);
        java.math.BigDecimal price;
        try {
            if (!(body.get("price") instanceof Number)) throw new IllegalArgumentException();
            price = new java.math.BigDecimal(body.get("price").toString());
            if (price.signum() < 0 || price.scale() > 2 || price.compareTo(new java.math.BigDecimal("9999999999.99")) > 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) { throw ApiException.badRequest("价格需为非负金额，最多两位小数"); }
        Map<String, Object> old = lockManagedProduct(uid, id, body);
        // 历史订单在 V16 已全部结束并冻结，不再阻止编辑；已售出的商品仍不能改
        if (!Set.of("在售", "已下架").contains(old.get("status")))
            throw ApiException.conflict("已售出的商品不能编辑");
        Map<String, Object> before = Map.of("title", old.get("title"), "description", old.get("description"), "price", old.get("price"));
        Map<String, Object> after = Map.of("title", title, "description", description, "price", price);
        if (title.equals(old.get("title")) && description.equals(old.get("description")) && price.compareTo(new java.math.BigDecimal(old.get("price").toString())) == 0) return old;
        jdbc.update("UPDATE products SET title=?,description=?,price=? WHERE id=?", title, description, price, uuid(id));
        jdbc.update("INSERT INTO admin_product_audit(id,school_id,product_id,staff_user_id,old_values,new_values,note,request_id) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)",
                UUID.randomUUID(), access.identity(uid).schoolId(), uuid(id), uuid(uid), mapper.json(before), mapper.json(after), note, requestId);
        return one(uid, "products", id);
    }

    @Transactional
    public Map<String, Object> productVisibility(String uid, String id, Map<String, Object> body) {
        access.require(uid, "products:write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
        JsonFieldPolicy.rejectUnknown(body, Set.of("action", "note", "version"));
        String action = AuthService.string(body, "action", 1, 40), note = AuthService.string(body, "note", 1, 500);
        if (!Set.of("HIDE_PRODUCT", "RESTORE_PRODUCT").contains(action)) throw ApiException.badRequest("商品管理动作无效");
        // 先做利益回避，再检查未结案件；直接管理不能覆盖正在处理的举报或申诉。
        one(uid, "products", id);
        conflicts.requireNoProductConflict(uuid(id), uuid(uid));
        if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM moderation_cases WHERE target_type='PRODUCT' AND target_id=? AND status IN ('OPEN','UNDER_REVIEW','APPEALED'))", Boolean.class, uuid(id))))
            throw ApiException.conflict("商品有未结治理案件，请到治理案件中处理");
        UUID caseId = UUID.randomUUID();
        int inserted = jdbc.update("INSERT INTO moderation_cases(id,school_id,target_type,target_id) VALUES (?,?,'PRODUCT',?) ON CONFLICT DO NOTHING", caseId, access.identity(uid).schoolId(), uuid(id));
        if (inserted == 0) throw ApiException.conflict("商品有未结治理案件，请到治理案件中处理");
        Map<String, Object> product = lockManagedProduct(uid, id, body);
        boolean hidden = Boolean.TRUE.equals(product.get("moderationHidden"));
        if (hidden == "HIDE_PRODUCT".equals(action)) throw ApiException.conflict("商品展示状态已变化，请刷新后重试");
        moderation.decide(uid, caseId.toString(), Map.of("action", action, "reasonCode", "OTHER", "note", note));
        return one(uid, "products", id);
    }

    private void addOrderDetails(Map<String, Object> order) {
        UUID orderId = uuid(String.valueOf(order.get("id")));
        order.put("productImages", mapper.imageUrls(order.get("productImages")));
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

    /**
     * 授权与审计同一事务提交；按学校加锁，撤销的操作者权限在锁后再次检查。
     * 涉及学校管理员的变更（授予、降级、停用）只生成一条待确认的复核请求，由另一位本校学校管理员确认后生效。
     */
    @Transactional
    public Map<String, Object> updateStaff(String uid, String id, Map<String, Object> body, String requestId) {
        StaffGuard.Staff actor = access.require(uid, "users:write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
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
        List<Map<String, Object>> targetUsers = jdbc.queryForList("SELECT u.id, u.deleted_at FROM users u JOIN campuses c ON c.id=u.campus WHERE u.id=? AND c.school_id=? FOR UPDATE OF u", target, actor.schoolId());
        if (targetUsers.isEmpty()) throw ApiException.notFound("用户不存在");
        List<Map<String, Object>> oldRows = jdbc.queryForList("SELECT role,active FROM staff_members WHERE user_id=? FOR UPDATE", target);
        Map<String, Object> old = oldRows.isEmpty() ? Map.of() : oldRows.get(0);
        if (role.equals(old.get("role")) && Boolean.valueOf(active).equals(old.get("active"))) return one(uid, "users", id);
        if (active && targetUsers.get(0).get("deleted_at") != null) throw ApiException.conflict("该账号已注销，不能授予后台权限");
        if ("SCHOOL_ADMIN".equals(old.get("role")) || "SCHOOL_ADMIN".equals(role)) {
            requireAnotherAdminRemains(actor.schoolId(), target, old, role, active);
            expireStaleRequests(target);
            UUID requestUuid = UUID.randomUUID();
            int created = jdbc.update("""
                    INSERT INTO admin_role_requests(id,school_id,target_user_id,requested_by,old_role,old_active,new_role,new_active,note,request_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING
                    """, requestUuid, actor.schoolId(), target, actor.userId(), old.get("role"), old.get("active"), role, active, note, requestId);
            if (created == 0) throw ApiException.conflict("该用户已有一条待确认的学校管理员变更，请先处理");
            Map<String, Object> result = new LinkedHashMap<>(one(uid, "users", id));
            result.put("pendingRoleRequest", one(uid, "role-requests", requestUuid.toString()));
            return result;
        }
        applyStaffChange(actor.schoolId(), target, old, role, active);
        jdbc.update("INSERT INTO admin_staff_audit(id,school_id,staff_user_id,target_user_id,old_role,new_role,old_active,new_active,note,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID(), actor.schoolId(), actor.userId(), target, old.get("role"), role, old.get("active"), active, note, requestId);
        return one(uid, "users", id);
    }

    /**
     * 另一位本校学校管理员确认、驳回，或发起人撤回一条复核请求。确认时在同一事务里生效并写审计（发起人 + 确认人）。
     * 业务拒绝（ApiException）不回滚：过期请求在拒绝前写入的 EXPIRED 要保留；其余拒绝都发生在任何写入之前。
     */
    @Transactional(noRollbackFor = ApiException.class)
    public Map<String, Object> decideRoleRequest(String uid, String id, String decision, Map<String, Object> body, String requestId) {
        StaffGuard.Staff actor = access.require(uid, "users:write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
        JsonFieldPolicy.rejectUnknown(body, Set.of("note"));
        String note = body == null || body.get("note") == null ? null : AuthService.string(body, "note", 1, 500);
        if (!"cancel".equals(decision) && note == null) throw ApiException.badRequest("请写明确认或驳回的理由");
        jdbc.queryForObject("SELECT id FROM schools WHERE id=? FOR UPDATE", String.class, actor.schoolId());
        actor = access.require(uid, "users:write");
        UUID requestUuid = uuid(id);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM admin_role_requests WHERE id=? AND school_id=? FOR UPDATE", requestUuid, actor.schoolId());
        if (rows.isEmpty()) throw ApiException.notFound("复核请求不存在");
        Map<String, Object> request = rows.get(0);
        if (!"PENDING".equals(request.get("status"))) throw ApiException.conflict("这条复核请求已经处理");
        if (((Timestamp) request.get("expires_at")).toInstant().isBefore(java.time.Instant.now())) {
            jdbc.update("UPDATE admin_role_requests SET status='EXPIRED', decided_at=clock_timestamp() WHERE id=?", requestUuid);
            throw ApiException.conflict("这条复核请求已过期，请重新发起");
        }
        UUID requester = (UUID) request.get("requested_by"), target = (UUID) request.get("target_user_id");
        if ("cancel".equals(decision)) {
            if (!actor.userId().equals(requester)) throw ApiException.forbidden("只有发起人可以撤回这条复核请求");
            jdbc.update("UPDATE admin_role_requests SET status='CANCELLED', decided_at=clock_timestamp() WHERE id=?", requestUuid);
            return one(uid, "role-requests", id);
        }
        if (!"SCHOOL_ADMIN".equals(actor.role())) throw ApiException.forbidden("只有学校管理员可以确认学校管理员变更");
        if (actor.userId().equals(requester)) throw ApiException.forbidden("不能确认自己发起的变更，需要另一位学校管理员确认");
        if (actor.userId().equals(target)) throw ApiException.forbidden("不能确认与自己有关的变更");
        if ("reject".equals(decision)) {
            jdbc.update("UPDATE admin_role_requests SET status='REJECTED', decided_by=?, decision_note=?, decided_at=clock_timestamp() WHERE id=?",
                    actor.userId(), note, requestUuid);
            return one(uid, "role-requests", id);
        }
        // 确认：以当前状态重新校验（发起之后目标可能已有变化）
        List<Map<String, Object>> current = jdbc.queryForList("SELECT role,active FROM staff_members WHERE user_id=? FOR UPDATE", target);
        Map<String, Object> old = current.isEmpty() ? Map.of() : current.get(0);
        if (!Objects.equals(old.get("role"), request.get("old_role")) || !Objects.equals(old.get("active"), request.get("old_active"))) {
            throw ApiException.conflict("目标账号的后台权限在发起后已经变化，请驳回后重新发起");
        }
        if (jdbc.queryForList("SELECT 1 FROM users u JOIN campuses c ON c.id=u.campus WHERE u.id=? AND c.school_id=?", target, actor.schoolId()).isEmpty()) {
            throw ApiException.conflict("目标账号已不在本校");
        }
        String role = String.valueOf(request.get("new_role"));
        boolean active = Boolean.TRUE.equals(request.get("new_active"));
        requireAnotherAdminRemains(actor.schoolId(), target, old, role, active);
        applyStaffChange(actor.schoolId(), target, old, role, active);
        jdbc.update("UPDATE admin_role_requests SET status='APPROVED', decided_by=?, decision_note=?, decided_at=clock_timestamp() WHERE id=?",
                actor.userId(), note, requestUuid);
        jdbc.update("INSERT INTO admin_staff_audit(id,school_id,staff_user_id,target_user_id,old_role,new_role,old_active,new_active,note,request_id,confirmed_by,role_request_id) "
                + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", UUID.randomUUID(), actor.schoolId(), requester, target, old.get("role"), role, old.get("active"),
                active, String.valueOf(request.get("note")), requestId, actor.userId(), requestUuid);
        return one(uid, "role-requests", id);
    }

    private void applyStaffChange(String schoolId, UUID target, Map<String, Object> old, String role, boolean active) {
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role,active) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET school_id=EXCLUDED.school_id,role=EXCLUDED.role,active=EXCLUDED.active,updated_at=clock_timestamp()",
                target, schoolId, role, active);
    }

    /** 服务端预检（数据库守卫兜底）：降级或停用之后本校仍至少有一名在岗学校管理员。 */
    private void requireAnotherAdminRemains(String schoolId, UUID target, Map<String, Object> old, String role, boolean active) {
        boolean losesAdmin = "SCHOOL_ADMIN".equals(old.get("role")) && Boolean.TRUE.equals(old.get("active"))
                && !("SCHOOL_ADMIN".equals(role) && active);
        if (!losesAdmin) return;
        Long others = jdbc.queryForObject("SELECT count(*) FROM staff_members WHERE school_id=? AND role='SCHOOL_ADMIN' AND active AND user_id<>?",
                Long.class, schoolId, target);
        if (others == null || others == 0) throw ApiException.conflict("这是本校最后一名学校管理员，不能降级或停用");
    }

    private void expireStaleRequests(UUID target) {
        jdbc.update("UPDATE admin_role_requests SET status='EXPIRED', decided_at=clock_timestamp() WHERE target_user_id=? AND status='PENDING' AND expires_at <= clock_timestamp()", target);
    }

    /** 列表与详情里的首图 / 商品首图：上传的图片换成短时签名地址（工作人员同样需要能看到图片才能处理） */
    private Map<String, Object> signImages(Map<String, Object> row) {
        for (String key : List.of("image", "productImage")) if (row.get(key) != null) row.put(key, mapper.imageUrl(row.get(key)));
        return row;
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
        if ("products".equals(resource)) allowed.addAll(Set.of("status", "category", "campus", "moderationHidden"));
        if ("role-requests".equals(resource)) allowed.add("status");
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
