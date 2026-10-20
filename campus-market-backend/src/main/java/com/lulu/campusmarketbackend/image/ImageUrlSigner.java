package com.lulu.campusmarketbackend.image;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.UUID;

/**
 * 图片地址签名。访问令牌只在内存里，{@code <img>} 带不上请求头，所以图片用短时签名地址：
 * 只有能看到这件商品的人才会在商品响应里拿到它（与商品可见性同一套判断），1 小时后失效。
 * 签名密钥由 JWT 密钥派生（不同用途、不同前缀），不新增需要运维的密钥。
 */
@Component
public class ImageUrlSigner {
    public static final String REF_PREFIX = "upload:";
    private static final long TTL_SECONDS = 3600;
    private final byte[] key;

    public ImageUrlSigner(@Value("${campus-market.jwt-secret}") String jwtSecret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(jwtSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            this.key = mac.doFinal("campus-market:image-url:v1".getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 把商品里存的引用变成可直接放进 {@code <img>} 的地址；外部示例图原样返回。 */
    public String publicUrl(String stored) {
        if (stored == null || !stored.startsWith(REF_PREFIX)) return stored;
        try {
            return sign(UUID.fromString(stored.substring(REF_PREFIX.length())), System.currentTimeMillis() / 1000 + TTL_SECONDS);
        } catch (IllegalArgumentException e) {
            return "";
        }
    }

    public String sign(UUID id, long expiresEpochSecond) {
        return "/v1/images/" + id + "?exp=" + expiresEpochSecond + "&sig=" + signature(id, expiresEpochSecond);
    }

    public boolean verify(UUID id, long expiresEpochSecond, String sig) {
        if (sig == null || expiresEpochSecond < System.currentTimeMillis() / 1000) return false;
        return MessageDigest.isEqual(signature(id, expiresEpochSecond).getBytes(StandardCharsets.US_ASCII), sig.getBytes(StandardCharsets.US_ASCII));
    }

    private String signature(UUID id, long exp) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal((id + ":" + exp).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
