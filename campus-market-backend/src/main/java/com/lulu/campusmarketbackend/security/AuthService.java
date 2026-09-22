package com.lulu.campusmarketbackend.security;

import com.lulu.campusmarketbackend.api.ApiException;
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
    private static final String DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.5JYlD9wzFj4z7KjwxP4g1Tf51EYxf3a";
    private final UserMapper users;
    private final SessionMapper sessions;
    private final JwtService jwt;
    private final DomainMapper mapper;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);
    private final SecureRandom random = new SecureRandom();
    private final String webOrigin;
    private final boolean secureCookies;
    private final long refreshDays;

    public AuthService(UserMapper users, SessionMapper sessions, JwtService jwt, DomainMapper mapper,
                       @Value("${campus-market.web-origin}") String webOrigin,
                       @Value("${campus-market.secure-cookies}") boolean secureCookies,
                       @Value("${campus-market.refresh-token-days}") long refreshDays) {
        this.users = users; this.sessions = sessions; this.jwt = jwt; this.mapper = mapper;
        this.webOrigin = webOrigin; this.secureCookies = secureCookies; this.refreshDays = refreshDays;
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
        String account = field(body, "account", 64), password = string(body, "password", 8, 72), nickname = string(body, "nickname", 1, 40), campus = campus(body.get("campus")), contact = optional(body, "contact", 100);
        UserEntity user = new UserEntity(); user.setId(UUID.randomUUID()); user.setAccount(account); user.setPasswordHash(passwordEncoder.encode(password)); user.setNickname(nickname); user.setAvatar(""); user.setCampus(campus); user.setContact(contact);
        try { users.insert(user); } catch (org.springframework.dao.DuplicateKeyException e) { throw ApiException.conflict("账号已存在"); }
        return session(users.selectRowById(user.getId()), response);
    }

    public Map<String, Object> login(Map<String, Object> body, HttpServletResponse response) {
        String account = field(body, "account", 64), password = string(body, "password", 1, 72);
        Map<String, Object> user = users.selectRowByAccount(account);
        boolean valid = passwordEncoder.matches(password, user == null ? DUMMY_HASH : String.valueOf(user.get("password_hash")));
        if (user == null || !valid) throw ApiException.unauthorized("账号或密码错误");
        return session(user, response);
    }

    @Transactional
    public Map<String, Object> refresh(HttpServletRequest request, HttpServletResponse response) {
        checkOrigin(request); String[] pair = refreshPair(request); String replacement = randomToken();
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
        return DomainMapper.map("accessToken", jwt.create(DomainMapper.text(user.get("id")), sid), "expiresAtIso", java.time.Instant.now().plusSeconds(900).toString(), "user", mapper.user(user, true));
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
    public static String campus(Object raw) { String value = raw == null ? "" : String.valueOf(raw); if (!java.util.Set.of("东校区", "西校区", "南校区", "北校区").contains(value)) throw ApiException.badRequest("校区无效"); return value; }
}
