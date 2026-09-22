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
        if (secret.length() < 32) throw new IllegalStateException("JWT_SECRET 至少需要 32 个字符");
        this.mapper = mapper;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.issuer = issuer;
        this.audience = audience;
        this.accessTokenSeconds = accessTokenMinutes * 60;
    }

    public String create(String userId, String sessionId) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
        Map<String, Object> payload = new HashMap<>();
        payload.put("sub", userId);
        payload.put("sid", sessionId);
        payload.put("iss", issuer);
        payload.put("aud", audience);
        payload.put("iat", now);
        payload.put("exp", now + accessTokenSeconds);
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

    private byte[] sign(String value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }
}
