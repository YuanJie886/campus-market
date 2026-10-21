package com.lulu.campusmarketbackend.security;

import com.lulu.campusmarketbackend.admin.AdminPermissions;
import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 阶段 3：账号生命周期。
 *
 * <ul>
 *   <li><b>修改密码</b>：核对当前密码；成功后结束本人其他设备上的全部会话（当前会话保留）；</li>
 *   <li><b>人工找回</b>：没有邮件 / 短信通道时，由本校学校管理员线下核对身份后签发一次性重置码（只显示一次，库里只存 SHA-256，
 *       30 分钟内有效、最多 5 次错误）；用户凭账号 + 重置码设新密码，成功后结束全部会话。失败一律同一句话，不透露账号是否存在；</li>
 *   <li><b>注销</b>：核对密码与确认语后，下架在售商品、清除全部商品上的联系方式、关闭未完成的联系申请、退出圈子、停用需求订阅与协助邀请、
 *       解除微信绑定、结束全部会话，并把资料匿名化（昵称「已注销用户」、账号改为不可登录的占位值）；只留不含个人信息的审计。
 *       仍有后台权限或仍是在用圈子的所有者时拒绝（先停用 / 移交）；</li>
 *   <li><b>微信登录</b>：code2session 换得 openid；已绑定则直接签发会话，未绑定返回 10 分钟的一次性绑定票据，用户用账号密码登录后绑定。</li>
 * </ul>
 */
@Service
public class AccountService {
    private static final String DELETE_CONFIRMATION = "确认注销";
    private static final String RESET_FAILURE = "账号或重置码无效或已过期";

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final UserMapper users;
    private final RateLimitService rateLimit;
    private final AdminPermissions admin;
    private final WeChatClient wechat;
    private final SecureRandom random = new SecureRandom();

    public AccountService(JdbcTemplate jdbc, AuthService auth, UserMapper users, RateLimitService rateLimit, AdminPermissions admin,
                          WeChatClient wechat) {
        this.jdbc = jdbc; this.auth = auth; this.users = users; this.rateLimit = rateLimit; this.admin = admin; this.wechat = wechat;
    }

    // ================= 修改密码 =================

    @Transactional
    public Map<String, Object> changePassword(HttpServletRequest request, Map<String, Object> body) {
        String uid = auth.authenticate(request, false);
        JsonFieldPolicy.rejectUnknown(body, Set.of("currentPassword", "newPassword"));
        String current = AuthService.string(body, "currentPassword", 1, 72), next = AuthService.string(body, "newPassword", 8, 72);
        rateLimit.consume(RateLimitService.Scope.ACCOUNT_SECURITY, uid);
        UUID me = UUID.fromString(uid);
        users.lockById(me);
        if (!auth.passwordMatches(users.selectRowById(me), current)) throw ApiException.badRequest("当前密码不正确");
        if (current.equals(next)) throw ApiException.badRequest("新密码不能与当前密码相同");
        jdbc.update("UPDATE users SET password_hash=?, password_changed_at=clock_timestamp() WHERE id=?", auth.hashPassword(next), me);
        int ended = jdbc.update("DELETE FROM sessions WHERE user_id=? AND id<>?", me, auth.currentSessionId(request));
        return Map.of("changed", true, "otherSessionsEnded", ended);
    }

    // ================= 人工找回 =================

    /** 学校管理员线下核对身份后签发；重置码只在这次响应里出现一次。 */
    @Transactional
    public Map<String, Object> issueResetCode(String staffUid, String userId, Map<String, Object> body, String requestId) {
        StaffGuard.Staff staff = admin.require(staffUid, "users:write");
        rateLimit.consume(RateLimitService.Scope.ADMIN_WRITE, staffUid);
        JsonFieldPolicy.rejectUnknown(body, Set.of("note"));
        String note = AuthService.string(body == null ? Map.of() : body, "note", 1, 500);
        if (note.matches("(?s).*[<>].*")) throw ApiException.badRequest("说明不能包含尖括号");
        UUID target;
        try { target = UUID.fromString(userId); } catch (Exception e) { throw ApiException.notFound("用户不存在"); }
        if (target.equals(staff.userId())) throw ApiException.forbidden("不能为自己签发重置码，请由其他学校管理员处理");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT u.id FROM users u JOIN campuses c ON c.id=u.campus "
                + "WHERE u.id=? AND c.school_id=? AND u.deleted_at IS NULL FOR UPDATE OF u", target, staff.schoolId());
        if (rows.isEmpty()) throw ApiException.notFound("用户不存在");
        jdbc.update("UPDATE password_reset_tickets SET revoked_at=clock_timestamp() WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL", target);
        String code = newCode();
        UUID id = UUID.randomUUID();
        Instant expires = jdbc.queryForObject("""
                INSERT INTO password_reset_tickets(id,user_id,school_id,issued_by,code_hash,note,request_id,expires_at)
                VALUES (?,?,?,?,?,?,?,clock_timestamp() + interval '30 minutes') RETURNING expires_at
                """, (rs, n) -> rs.getTimestamp(1).toInstant(), id, target, staff.schoolId(), staff.userId(), digest(normalizeCode(code)), note, requestId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ticketId", id.toString());
        result.put("code", code);
        result.put("expiresAt", expires.toEpochMilli());
        return result;
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Map<String, Object> resetWithCode(Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of("account", "code", "newPassword"));
        String account = AuthService.field(body, "account", 64), code = AuthService.string(body, "code", 1, 40);
        String next = AuthService.string(body, "newPassword", 8, 72);
        rateLimit.consume(RateLimitService.Scope.PASSWORD_RESET, RateLimitService.normalizeAccount(account));
        List<Map<String, Object>> tickets = jdbc.queryForList("""
                SELECT t.id, t.code_hash, t.user_id FROM password_reset_tickets t JOIN users u ON u.id = t.user_id
                WHERE u.account = ? AND u.deleted_at IS NULL AND t.used_at IS NULL AND t.revoked_at IS NULL
                  AND t.expires_at > clock_timestamp() AND t.attempts < 5
                FOR UPDATE OF t
                """, account);
        if (tickets.isEmpty()) throw ApiException.badRequest(RESET_FAILURE);
        Map<String, Object> ticket = tickets.get(0);
        boolean matches = MessageDigest.isEqual(digest(normalizeCode(code)).getBytes(StandardCharsets.US_ASCII),
                String.valueOf(ticket.get("code_hash")).getBytes(StandardCharsets.US_ASCII));
        if (!matches) {
            // 错误次数在这里提交（不随 400 回滚）；第 5 次之后这张重置码作废
            jdbc.update("UPDATE password_reset_tickets SET attempts = attempts + 1 WHERE id=?", ticket.get("id"));
            throw ApiException.badRequest(RESET_FAILURE);
        }
        UUID user = (UUID) ticket.get("user_id");
        users.lockById(user);
        jdbc.update("UPDATE password_reset_tickets SET used_at=clock_timestamp() WHERE id=?", ticket.get("id"));
        jdbc.update("UPDATE users SET password_hash=?, password_changed_at=clock_timestamp() WHERE id=?", auth.hashPassword(next), user);
        jdbc.update("DELETE FROM sessions WHERE user_id=?", user);
        return Map.of("reset", true);
    }

    /** 与注册邀请码同一套字母表与格式（{@link OneTimeCodes}）。 */
    private String newCode() {
        return OneTimeCodes.generate(random);
    }

    private static String normalizeCode(String code) {
        return OneTimeCodes.normalize(code);
    }

    // ================= 注销 =================

    @Transactional
    public Map<String, Object> deleteAccount(HttpServletRequest request, HttpServletResponse response, Map<String, Object> body, String requestId) {
        String uid = auth.authenticate(request, false);
        JsonFieldPolicy.rejectUnknown(body, Set.of("password", "confirmation"));
        String password = AuthService.string(body, "password", 1, 72);
        if (!DELETE_CONFIRMATION.equals(body.get("confirmation"))) throw ApiException.badRequest("请输入「" + DELETE_CONFIRMATION + "」确认注销");
        rateLimit.consume(RateLimitService.Scope.ACCOUNT_SECURITY, uid);
        UUID me = UUID.fromString(uid);
        users.lockById(me);
        Map<String, Object> user = users.selectRowById(me);
        if (!auth.passwordMatches(user, password)) throw ApiException.badRequest("密码不正确");
        if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM staff_members WHERE user_id=? AND active)", Boolean.class, me))) {
            throw ApiException.conflict("你仍有后台工作人员权限，请先请学校管理员停用后再注销");
        }
        if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM circles WHERE owner_user_id=? AND status='ACTIVE')", Boolean.class, me))) {
            throw ApiException.conflict("你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销");
        }
        String school = jdbc.queryForObject("SELECT c.school_id FROM users u JOIN campuses c ON c.id=u.campus WHERE u.id=?", String.class, me);

        int productsTakenDown = jdbc.update("UPDATE products SET status='已下架' WHERE seller_id=? AND status='在售'", me);
        jdbc.update("UPDATE products SET contact='', contact_public=false WHERE seller_id=? AND (contact<>'' OR contact_public)", me);
        int requests = jdbc.update("UPDATE contact_requests SET status='WITHDRAWN', updated_at=now() WHERE buyer_id=? AND status='PENDING'", me)
                + jdbc.update("UPDATE contact_requests SET status='REJECTED', decided_at=now(), updated_at=now(), buyer_seen_at=NULL WHERE seller_id=? AND status='PENDING'", me)
                + jdbc.update("UPDATE contact_requests SET status='REVOKED', decided_at=now(), updated_at=now(), buyer_seen_at=NULL WHERE seller_id=? AND status='APPROVED'", me);
        int memberships = 0;
        for (UUID circle : jdbc.queryForList("SELECT circle_id FROM circle_memberships WHERE user_id=? AND status='ACTIVE' AND role<>'OWNER'", UUID.class, me)) {
            memberships += jdbc.update("UPDATE circle_memberships SET status='LEFT', role='MEMBER', ended_at=clock_timestamp(), updated_at=clock_timestamp() "
                    + "WHERE circle_id=? AND user_id=? AND status='ACTIVE'", circle, me);
            jdbc.update("INSERT INTO circle_events(circle_id, actor_user_id, target_user_id, event_code) VALUES (?,?,?,'MEMBER_LEFT')", circle, me, me);
        }
        jdbc.update("UPDATE demand_subscriptions SET active=false, updated_at=clock_timestamp() WHERE user_id=? AND active", me);
        jdbc.update("UPDATE listing_assist_invites SET status='REVOKED', revoked_at=clock_timestamp() WHERE owner_user_id=? AND status<>'REVOKED'", me);
        jdbc.update("DELETE FROM user_wechat_identities WHERE user_id=?", me);
        // 阶段 4：本人上传的图片不再可读（已经发出的签名地址同样失效）
        jdbc.update("UPDATE uploaded_images SET status='DELETED', status_changed_at=clock_timestamp() WHERE owner_user_id=? AND status<>'DELETED'", me);
        jdbc.update("DELETE FROM sessions WHERE user_id=?", me);
        jdbc.update("UPDATE users SET account=?, password_hash=?, nickname='已注销用户', avatar='', contact='', dorm_building_id=NULL, deleted_at=clock_timestamp() WHERE id=?",
                "deleted-" + me, auth.hashPassword(HexFormat.of().formatHex(randomBytes())), me);
        jdbc.update("INSERT INTO account_deletions(user_id, school_id, products_taken_down, requests_closed, memberships_ended, request_id) VALUES (?,?,?,?,?,?)",
                me, school, productsTakenDown, requests, memberships, requestId);
        auth.clearRefreshCookie(response);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("deleted", true);
        result.put("productsTakenDown", productsTakenDown);
        result.put("requestsClosed", requests);
        result.put("membershipsEnded", memberships);
        return result;
    }

    // ================= 微信登录 =================

    public Map<String, Object> wechatStatus(HttpServletRequest request) {
        String uid = auth.authenticate(request, true);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", wechat.enabled());
        result.put("bound", uid != null && Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM user_wechat_identities WHERE user_id=?)", Boolean.class, UUID.fromString(uid))));
        return result;
    }

    @Transactional
    public Map<String, Object> wechatLogin(Map<String, Object> body, HttpServletResponse response) {
        JsonFieldPolicy.rejectUnknown(body, Set.of("code"));
        String code = AuthService.string(body, "code", 1, 128);
        if (!code.matches("[A-Za-z0-9_-]+")) throw ApiException.badRequest("微信登录凭证无效或已过期，请重试");
        if (!wechat.enabled()) throw new ApiException(503, "微信登录尚未开通", null);
        rateLimit.consume(RateLimitService.Scope.WECHAT_LOGIN, "global");
        WeChatClient.Identity identity = wechat.exchange(code);
        List<UUID> bound = jdbc.queryForList("SELECT w.user_id FROM user_wechat_identities w JOIN users u ON u.id=w.user_id "
                + "WHERE w.app_id=? AND w.openid=? AND u.deleted_at IS NULL", UUID.class, identity.appId(), identity.openid());
        if (!bound.isEmpty()) {
            Map<String, Object> session = new LinkedHashMap<>(auth.issueSession(users.selectRowById(bound.get(0)), response));
            session.put("bound", true);
            return session;
        }
        String ticket = HexFormat.of().formatHex(randomBytes());
        Instant expires = jdbc.queryForObject("""
                INSERT INTO wechat_bind_tickets(id,ticket_hash,app_id,openid,unionid,expires_at)
                VALUES (?,?,?,?,?,clock_timestamp() + interval '10 minutes') RETURNING expires_at
                """, (rs, n) -> rs.getTimestamp(1).toInstant(), UUID.randomUUID(), digest(ticket), identity.appId(), identity.openid(), identity.unionid());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("bound", false);
        result.put("bindTicket", ticket);
        result.put("expiresAt", expires.toEpochMilli());
        return result;
    }

    @Transactional
    public Map<String, Object> wechatBind(HttpServletRequest request, Map<String, Object> body) {
        String uid = auth.authenticate(request, false);
        JsonFieldPolicy.rejectUnknown(body, Set.of("bindTicket"));
        String ticket = AuthService.string(body, "bindTicket", 64, 64);
        UUID me = UUID.fromString(uid);
        users.lockById(me);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM wechat_bind_tickets WHERE ticket_hash=? AND used_at IS NULL "
                + "AND expires_at > clock_timestamp() FOR UPDATE", digest(ticket));
        if (rows.isEmpty()) throw ApiException.badRequest("绑定已过期，请重新用微信登录");
        Map<String, Object> row = rows.get(0);
        jdbc.update("UPDATE wechat_bind_tickets SET used_at=clock_timestamp() WHERE id=?", row.get("id"));
        if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM user_wechat_identities WHERE user_id=?)", Boolean.class, me))) {
            throw ApiException.conflict("这个账号已经绑定了微信，请先解除绑定");
        }
        try {
            jdbc.update("INSERT INTO user_wechat_identities(user_id, app_id, openid, unionid) VALUES (?,?,?,?)",
                    me, row.get("app_id"), row.get("openid"), row.get("unionid"));
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw ApiException.conflict("这个微信已经绑定了其他账号");
        }
        return Map.of("bound", true);
    }

    @Transactional
    public Map<String, Object> wechatUnbind(HttpServletRequest request) {
        String uid = auth.authenticate(request, false);
        jdbc.update("DELETE FROM user_wechat_identities WHERE user_id=?", UUID.fromString(uid));
        return Map.of("bound", false);
    }

    private byte[] randomBytes() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return bytes;
    }

    private static String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
