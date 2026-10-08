package com.lulu.campusmarketbackend.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

@Service
public class JwtService {
    /** HMAC-SHA256 签名密钥的最小字节数。 */
    private static final int MIN_SECRET_BYTES = 32;
    private static final Base64.Encoder B64E = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private final ObjectMapper mapper;
    private final byte[] secret;
    private final String issuer;
    private final String audience;
    private final long accessTokenSeconds;

    public JwtService(ObjectMapper mapper,
                      @Value("${campus-market.jwt-secret}") String secret,
                      @Value("${campus-market.jwt-issuer}") String issuer,
                      @Value("${campus-market.jwt-audience}") String audience,
                      @Value("${campus-market.access-token-minutes}") long accessTokenMinutes) {
        this.mapper = mapper;
        this.secret = requireStrongSecret(secret);
        this.issuer = issuer;
        this.audience = audience;
        this.accessTokenSeconds = accessTokenMinutes * 60;
    }

    /**
     * 一次签发的结果：令牌与其过期时刻。
     * 让调用方直接复用这里算出的 expiresAt，而不是在别处按分钟配置再算一遍——
     * 那正是 AuthService 曾经硬编码 900 秒、改配置后返回值与 JWT exp 漂移的成因。
     */
    public record IssuedAccessToken(String token, Instant expiresAt) {}

    /** 签发 access token。now 与 expiresAt 各只计算一次，JWT 的 exp 与返回值同源。 */
    public IssuedAccessToken issue(String userId, String sessionId) {
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plusSeconds(accessTokenSeconds);
        return new IssuedAccessToken(create(userId, sessionId, issuedAt, expiresAt), expiresAt);
    }

    public String create(String userId, String sessionId) {
        Instant issuedAt = Instant.now();
        return create(userId, sessionId, issuedAt, issuedAt.plusSeconds(accessTokenSeconds));
    }

    private String create(String userId, String sessionId, Instant issuedAt, Instant expiresAt) {
        long now = issuedAt.getEpochSecond();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> payload = new HashMap<>();
        payload.put("sub", userId);
        payload.put("sid", sessionId);
        payload.put("iss", issuer);
        payload.put("aud", audience);
        payload.put("iat", now);
        payload.put("exp", expiresAt.getEpochSecond());
        try {
            String encodedHeader = B64E.encodeToString(mapper.writeValueAsBytes(header));
            String encodedPayload = B64E.encodeToString(mapper.writeValueAsBytes(payload));
            String content = encodedHeader + "." + encodedPayload;
            return content + "." + B64E.encodeToString(sign(content));
        } catch (Exception e) {
            throw new IllegalStateException("无法生成登录令牌", e);
        }
    }

    public Map<String, Object> verify(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) throw new IllegalArgumentException();
            byte[] expected = sign(parts[0] + "." + parts[1]);
            byte[] actual = B64D.decode(parts[2]);
            if (!java.security.MessageDigest.isEqual(expected, actual)) throw new IllegalArgumentException();
            Map<String, Object> payload = mapper.readValue(B64D.decode(parts[1]), new TypeReference<>() {});
            if (!issuer.equals(payload.get("iss")) || !audience.equals(payload.get("aud"))) throw new IllegalArgumentException();
            Number exp = (Number) payload.get("exp");
            if (exp == null || exp.longValue() <= Instant.now().getEpochSecond()) throw new IllegalArgumentException();
            return payload;
        } catch (Exception e) {
            throw ApiException.unauthorized("登录已失效，请重新登录");
        }
    }

    /**
     * 校验 HMAC 签名密钥强度并返回其字节表示。
     *
     * <p>用 UTF-8 <b>字节</b>长度而不是 Java 字符数衡量：HMAC 密钥的强度取决于字节数，
     * 而多字节字符（如中文）会让字符数显著小于字节数，按字符数判断会误拒合法密钥。
     *
     * <p>异常消息只说明配置缺失或强度不足，不包含密钥本身，也不写日志。
     */
    private static byte[] requireStrongSecret(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("JWT_SECRET 未配置：请通过环境变量提供至少 32 字节的强随机密钥");
        }
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("JWT_SECRET 强度不足：至少需要 " + MIN_SECRET_BYTES + " 字节（UTF-8）");
        }
        return bytes;
    }

    private byte[] sign(String value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }
}
