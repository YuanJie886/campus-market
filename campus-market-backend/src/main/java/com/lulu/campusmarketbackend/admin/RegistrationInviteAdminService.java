package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.registration.RegistrationInvites;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 后台「注册邀请码」（V23）：本校学校管理员签发、撤销、查看；只读审计员只能查看；其他角色 403。只看得到本校的邀请码，他校的一律 404。
 *
 * <ul>
 *   <li>读取（列表、详情）按工作人员计入 ADMIN_READ 并写读取留痕（详情会显示使用者昵称）；签发、撤销计入 ADMIN_WRITE；</li>
 *   <li>邀请码明文只出现在签发的那一次响应里；列表、详情只有末 4 位提示（codeHint）。</li>
 * </ul>
 */
@Service
public class RegistrationInviteAdminService {
    static final String RESOURCE = "registration-invites";
    private static final String STATUS = """
            CASE WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
                 WHEN i.used_count >= i.max_uses THEN 'USED_UP'
                 WHEN i.expires_at <= clock_timestamp() THEN 'EXPIRED'
                 ELSE 'ACTIVE' END""";
    private static final String FIELDS = "i.id, i.code_hint AS \"codeHint\", i.max_uses AS \"maxUses\", i.used_count AS \"usedCount\", "
            + "i.expires_at AS \"expiresAt\", i.revoked_at AS \"revokedAt\", i.note, creator.nickname AS \"createdBy\", "
            + "i.created_at AS \"createdAt\", " + STATUS + " AS status";
    private static final String FROM = " FROM registration_invites i LEFT JOIN users creator ON creator.id = i.created_by";
    private static final Map<String, String> STATUS_FILTERS = Map.of(
            "ACTIVE", " AND i.revoked_at IS NULL AND i.used_count < i.max_uses AND i.expires_at > clock_timestamp()",
            "USED_UP", " AND i.revoked_at IS NULL AND i.used_count >= i.max_uses",
            "EXPIRED", " AND i.revoked_at IS NULL AND i.used_count < i.max_uses AND i.expires_at <= clock_timestamp()",
            "REVOKED", " AND i.revoked_at IS NOT NULL");
    private static final String NOT_FOUND = "邀请码不存在";

    private final JdbcTemplate jdbc;
    private final AdminPermissions access;
    private final AdminService admin;
    private final RateLimitService rateLimit;
    private final RegistrationInvites invites;

    public RegistrationInviteAdminService(JdbcTemplate jdbc, AdminPermissions access, AdminService admin, RateLimitService rateLimit,
                                          RegistrationInvites invites) {
        this.jdbc = jdbc; this.access = access; this.admin = admin; this.rateLimit = rateLimit; this.invites = invites;
    }

    public Map<String, Object> list(String uid, Map<String, String> query, String requestId) {
        StaffGuard.Staff member = access.require(uid, RESOURCE + ":read");
        rateLimit.consume(RateLimitService.Scope.ADMIN_READ, uid);
        if (!Set.of("status", "page", "size").containsAll(query.keySet())) throw ApiException.badRequest("查询参数无效");
        int page = AdminService.positive(query.getOrDefault("page", "1"), 10000);
        int size = AdminService.positive(query.getOrDefault("size", "20"), 50);
        String where = " WHERE i.school_id = ?";
        String status = query.get("status");
        if (status != null && !status.isBlank()) {
            if (!STATUS_FILTERS.containsKey(status)) throw ApiException.badRequest("邀请码状态无效");
            where += STATUS_FILTERS.get(status);
        }
        Long total = jdbc.queryForObject("SELECT count(*)" + FROM + where, Long.class, member.schoolId());
        List<Map<String, Object>> items = jdbc.queryForList("SELECT " + FIELDS + FROM + where
                + " ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?", member.schoolId(), size, (page - 1) * size)
                .stream().map(RegistrationInviteAdminService::normalize).toList();
        admin.auditRead(member, RESOURCE, null, items.size(), null, requestId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total == null ? 0L : total);
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    @Transactional(isolation = Isolation.REPEATABLE_READ)
    public Map<String, Object> detail(String uid, String id, String requestId) {
        StaffGuard.Staff member = access.require(uid, RESOURCE + ":read");
        rateLimit.consume(RateLimitService.Scope.ADMIN_READ, uid);
        UUID inviteId = AdminService.uuid(id);
        Map<String, Object> result = item(member.schoolId(), inviteId);
        result.put("uses", jdbc.queryForList("""
                SELECT u.user_id AS "userId", usr.nickname, u.used_at AS "usedAt"
                FROM registration_invite_uses u JOIN users usr ON usr.id = u.user_id
                WHERE u.invite_id = ? ORDER BY u.used_at, u.id
                """, inviteId).stream().map(RegistrationInviteAdminService::normalize).toList());
        admin.auditRead(member, RESOURCE, inviteId, null, null, requestId);
        return result;
    }

    /** 签发：响应里带一次明文 code，之后任何接口都不再返回。 */
    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        StaffGuard.Staff member = access.require(uid, RESOURCE + ":write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
        Map<String, Object> input = body == null ? Map.of() : body;
        JsonFieldPolicy.rejectUnknown(input, Set.of("maxUses", "expiresInDays", "note"));
        int maxUses = integer(input.get("maxUses"), "可用次数需为 1～" + RegistrationInvites.MAX_USES + " 的整数");
        int days = integer(input.get("expiresInDays"), "有效天数需为 1～" + RegistrationInvites.MAX_DAYS + " 的整数");
        String note = note(input.get("note"));
        RegistrationInvites.validate(maxUses, days, note);
        RegistrationInvites.Issued issued = invites.issue(member.schoolId(), maxUses, days, note, member.userId());
        Map<String, Object> result = item(member.schoolId(), issued.id());
        result.put("code", issued.code());
        return result;
    }

    /** 撤销（幂等）：已撤销的直接返回原状。已用完、已过期的同样可以撤销。 */
    @Transactional
    public Map<String, Object> revoke(String uid, String id, Map<String, Object> body) {
        StaffGuard.Staff member = access.require(uid, RESOURCE + ":write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, uid);
        JsonFieldPolicy.rejectUnknown(body, Set.of());
        UUID inviteId = AdminService.uuid(id);
        jdbc.update("UPDATE registration_invites SET revoked_at = clock_timestamp(), revoked_by = ? "
                + "WHERE id = ? AND school_id = ? AND revoked_at IS NULL", member.userId(), inviteId, member.schoolId());
        return item(member.schoolId(), inviteId);
    }

    private Map<String, Object> item(String schoolId, UUID id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT " + FIELDS + FROM + " WHERE i.school_id = ? AND i.id = ?", schoolId, id);
        if (rows.isEmpty()) throw ApiException.notFound(NOT_FOUND);
        return normalize(rows.get(0));
    }

    private static int integer(Object raw, String message) {
        if (raw instanceof Integer || raw instanceof Long || raw instanceof Short) {
            long value = ((Number) raw).longValue();
            if (value >= Integer.MIN_VALUE && value <= Integer.MAX_VALUE) return (int) value;
        }
        throw ApiException.badRequest(message);
    }

    private static String note(Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof String text)) throw ApiException.badRequest("备注格式无效");
        String trimmed = text.trim();
        return trimmed.isEmpty() ? null : trimmed;
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
