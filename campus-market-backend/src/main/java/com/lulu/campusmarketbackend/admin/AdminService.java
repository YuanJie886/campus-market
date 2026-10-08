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
    // SQL 结构只从此白名单读取；搜索、学校、ID、页码都用绑定参数。
    private static final Map<String, Resource> RESOURCES = Map.of(
        "users", new Resource("u.id, u.account, u.nickname, u.campus, u.created_at AS \"createdAt\", s.role, COALESCE(s.active,false) AS active",
            "users u JOIN campuses c ON c.id=u.campus LEFT JOIN staff_members s ON s.user_id=u.id AND s.school_id=c.school_id",
            "c.school_id", "u.nickname || ' ' || u.account", Map.of("id", "u.id", "createdAt", "u.created_at", "nickname", "u.nickname")),
        "products", new Resource("p.id, p.title, p.category, p.price, p.status, p.campus, p.seller_id AS \"sellerId\", p.created_at AS \"createdAt\", (p.moderation_hidden_at IS NOT NULL) AS \"moderationHidden\"",
            "products p JOIN campuses c ON c.id=p.campus", "c.school_id", "p.title", Map.of("id", "p.id", "createdAt", "p.created_at", "title", "p.title", "price", "p.price")),
        "orders", new Resource("o.id, o.product_id AS \"productId\", o.buyer_id AS \"buyerId\", o.seller_id AS \"sellerId\", o.status, o.price, o.created_at AS \"createdAt\"",
            "orders o JOIN products p ON p.id=o.product_id JOIN campuses c ON c.id=p.campus", "c.school_id", "o.id::text", Map.of("id", "o.id", "createdAt", "o.created_at")),
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
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT " + fields + " FROM " + definition.from
                + " WHERE " + definition.scope + "=? AND " + definition.sorts.get("id") + "=?", member.schoolId(), uuid(id));
        if (rows.isEmpty()) throw ApiException.notFound("记录不存在");
        Map<String, Object> result = normalize(rows.get(0));

        return result;
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
