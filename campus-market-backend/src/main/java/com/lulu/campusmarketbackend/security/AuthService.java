package com.lulu.campusmarketbackend.security;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.entity.SessionEntity;
import com.lulu.campusmarketbackend.entity.UserEntity;
import com.lulu.campusmarketbackend.mapper.SessionMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

@Service
public class AuthService {
    /** 注册请求允许的字段。role / id / createdAt 等一律作为未知字段拒绝。 */
    private static final java.util.Set<String> REGISTER_FIELDS = java.util.Set.of("account", "password", "nickname", "campus", "contact");
    /** 登录请求允许的字段。 */
    private static final java.util.Set<String> LOGIN_FIELDS = java.util.Set.of("account", "password");

    private static final String DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.5JYlD9wzFj4z7KjwxP4g1Tf51EYxf3a";
    private final RateLimitService rateLimit;
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(AuthService.class);
    private final UserMapper users;
    private final SessionMapper sessions;
    private final JwtService jwt;
    private final DomainMapper mapper;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);
    private final SecureRandom random = new SecureRandom();
    private final String webOrigin;
    private final boolean secureCookies;
    private final long refreshDays;

    private final com.lulu.campusmarketbackend.school.SchoolScope schools;

    public AuthService(UserMapper users, SessionMapper sessions, JwtService jwt, DomainMapper mapper, RateLimitService rateLimit,
                       com.lulu.campusmarketbackend.school.SchoolScope schools,
                       @Value("${campus-market.web-origin}") String webOrigin,
                       @Value("${campus-market.secure-cookies}") boolean secureCookies,
                       @Value("${campus-market.refresh-token-days}") long refreshDays) {
        this.users = users; this.sessions = sessions; this.jwt = jwt; this.mapper = mapper; this.rateLimit = rateLimit;
        this.schools = schools;
        this.webOrigin = webOrigin; this.secureCookies = secureCookies; this.refreshDays = refreshDays;
        requireCoherentCookiePolicy(webOrigin, secureCookies);
    }

    /**
     * 拒绝「HTTPS 站点 + 非 Secure 刷新 Cookie」这种自相矛盾的配置。
     *
     * <p>{@code SECURE_COOKIES} 默认 false 是为了本地 http 开发能用，但它<b>静默</b>地
     * 把生产也置于风险中：一旦忘记设置，refresh Cookie 就会随明文 HTTP 请求发出，
     * 中间人可以直接拿走一枚七天有效的长期凭据。部署时这种遗漏不会有任何征兆。
     *
     * <p>判据取 {@code WEB_ORIGIN}：它是运维必然会改的值。origin 是 https 就说明
     * 站点跑在 TLS 上，此时 Secure=false 只可能是配置遗漏，直接拒绝启动，
     * 让问题在部署时暴露，而不是在事故里暴露。http 开发环境仅记一条启动警告。
     */
    private static void requireCoherentCookiePolicy(String webOrigin, boolean secureCookies) {
        if (secureCookies) return;
        String origin = webOrigin == null ? "" : webOrigin.trim().toLowerCase(java.util.Locale.ROOT);
        if (origin.startsWith("https://")) {
            throw new IllegalStateException(
                    "SECURE_COOKIES=false 与 HTTPS 的 WEB_ORIGIN 不兼容：刷新 Cookie 会在明文连接上发送。"
                            + "请设置 SECURE_COOKIES=true。");
        }
        LOG.warn("SECURE_COOKIES=false：刷新 Cookie 未带 Secure 标记，仅可用于本地 http 开发，生产环境必须设为 true");
    }

    public String authenticate(HttpServletRequest request, boolean optional) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            if (optional) return null;
            throw ApiException.unauthorized("登录已失效，请重新登录");
        }
        Map<String, Object> claims = jwt.verify(header.substring(7));
        String userId = String.valueOf(claims.get("sub"));
        String sessionId = String.valueOf(claims.get("sid"));
        if (sessions.countValid(UUID.fromString(sessionId), UUID.fromString(userId)) == 0) throw ApiException.unauthorized("登录已失效，请重新登录");
        return userId;
    }

    @Transactional
    public Map<String, Object> register(Map<String, Object> body, HttpServletResponse response) {
        JsonFieldPolicy.rejectUnknown(body, REGISTER_FIELDS);
        String account = field(body, "account", 64), password = string(body, "password", 8, 72), nickname = string(body, "nickname", 1, 40), campus = schools.requireCampus(body.get("campus")), contact = optional(body, "contact", 100);
        // 基础校验通过后才计数，避免格式垃圾把限流表撑大
        rateLimit.consume(RateLimitService.Scope.AUTH_REGISTER, RateLimitService.normalizeAccount(account));
        UserEntity user = new UserEntity(); user.setId(UUID.randomUUID()); user.setAccount(account); user.setPasswordHash(passwordEncoder.encode(password)); user.setNickname(nickname); user.setAvatar(""); user.setCampus(campus); user.setContact(contact);
        try { users.insert(user); } catch (org.springframework.dao.DuplicateKeyException e) { throw ApiException.conflict("账号已存在"); }
        return session(users.selectRowById(user.getId()), response);
    }

    public Map<String, Object> login(Map<String, Object> body, HttpServletResponse response) {
        JsonFieldPolicy.rejectUnknown(body, LOGIN_FIELDS);
        String account = field(body, "account", 64), password = string(body, "password", 1, 72);
        // 必须在读用户与比对口令之前限流：既降低爆破速率，也让存在与不存在的账号
        // 走完全相同的路径，不因限流产生账号枚举差异。
        rateLimit.consume(RateLimitService.Scope.AUTH_LOGIN, RateLimitService.normalizeAccount(account));
        Map<String, Object> user = users.selectRowByAccount(account);
        boolean valid = passwordEncoder.matches(password, user == null ? DUMMY_HASH : String.valueOf(user.get("password_hash")));
        if (user == null || !valid) throw ApiException.unauthorized("账号或密码错误");
        return session(user, response);
    }

    @Transactional
    public Map<String, Object> refresh(HttpServletRequest request, HttpServletResponse response) {
        checkOrigin(request); String[] pair = refreshPair(request);
        rateLimit.consume(RateLimitService.Scope.AUTH_REFRESH, pair[0]);
        String replacement = randomToken();
        if (sessions.rotate(UUID.fromString(pair[0]), digest(pair[1]), digest(replacement)) == 0) throw ApiException.unauthorized("会话已过期");
        SessionEntity session = sessions.selectById(UUID.fromString(pair[0]));
        if (session == null) throw ApiException.unauthorized("会话已过期");
        Map<String, Object> user = users.selectRowById(session.getUserId()); writeCookie(response, pair[0] + "." + replacement); return authResponse(user, pair[0]);
    }

    @Transactional
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        checkOrigin(request); String[] pair = refreshPair(request, false);
        if (pair != null) sessions.deleteByHash(UUID.fromString(pair[0]), digest(pair[1]));
        response.addHeader("Set-Cookie", ResponseCookie.from("cm_refresh", "").httpOnly(true).secure(secureCookies).sameSite("Strict").path("/v1/auth").maxAge(0).build().toString());
    }

    private Map<String, Object> session(Map<String, Object> user, HttpServletResponse response) {
        String sid = UUID.randomUUID().toString(), token = randomToken();
        SessionEntity session = new SessionEntity(); session.setId(UUID.fromString(sid)); session.setUserId(UUID.fromString(DomainMapper.text(user.get("id")))); session.setRefreshHash(digest(token)); session.setExpiresAt(OffsetDateTime.now(ZoneOffset.UTC).plusDays(refreshDays));
        sessions.insert(session); writeCookie(response, sid + "." + token); return authResponse(user, sid);
    }

    private Map<String, Object> authResponse(Map<String, Object> user, String sid) {
        // 令牌与过期时间来自同一次签发，不在此处复制分钟配置。
        JwtService.IssuedAccessToken issued = jwt.issue(DomainMapper.text(user.get("id")), sid);
        return DomainMapper.map("accessToken", issued.token(), "expiresAtIso", issued.expiresAt().toString(), "user", mapper.user(user, true));
    }
    private void writeCookie(HttpServletResponse response, String value) { response.addHeader("Set-Cookie", ResponseCookie.from("cm_refresh", value).httpOnly(true).secure(secureCookies).sameSite("Strict").path("/v1/auth").maxAge(refreshDays * 86400).build().toString()); }
    private void checkOrigin(HttpServletRequest request) { String origin = request.getHeader("Origin"); if (origin != null && !origin.equals(webOrigin)) throw ApiException.forbidden("来源不允许"); }
    private String[] refreshPair(HttpServletRequest request) { return refreshPair(request, true); }
    private String[] refreshPair(HttpServletRequest request, boolean required) {
        String value = null; if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) if ("cm_refresh".equals(cookie.getName())) value = cookie.getValue();
        if (value == null) { if (required) throw ApiException.unauthorized("请重新登录"); return null; }
        String[] pair = value.split("\\.", 2); if (pair.length != 2 || !pair[0].matches("[0-9a-fA-F-]{36}") || pair[1].isBlank()) { if (required) throw ApiException.unauthorized("请重新登录"); return null; } return pair;
    }
    private String randomToken() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return HexFormat.of().formatHex(bytes); }
    private String digest(String value) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
    public static String field(Map<String, Object> body, String name, int max) { String value = string(body, name, 1, max); if (!value.matches("[\\w@.+-]+")) throw ApiException.badRequest(name + " 格式无效"); return value; }
    public static String string(Map<String, Object> body, String name, int min, int max) { Object raw = body.get(name); if (!(raw instanceof String value)) throw ApiException.badRequest(name + " 格式无效"); value = value.trim(); if (value.length() < min || value.length() > max) throw ApiException.badRequest(name + " 长度无效"); return value; }
    public static String optional(Map<String, Object> body, String name, int max) { Object raw = body.get(name); if (raw == null) return ""; if (!(raw instanceof String value) || value.trim().length() > max) throw ApiException.badRequest(name + " 长度无效"); return value.trim(); }
}
