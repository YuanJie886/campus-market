package com.lulu.campusmarketbackend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 阶段 3：微信小程序 code2session（auth.code2Session）。
 *
 * <p>只在服务端用 AppID + AppSecret 换取 openid / unionid；AppSecret、session_key 与临时登录凭证都不记录、不落库、不返回给前端。
 * 两个配置任一为空时视为未开通。接口地址可配置，测试用本机桩服务器。
 */
@Component
public class WeChatClient {

    public record Identity(String appId, String openid, String unionid) {}

    private final String appId;
    private final String appSecret;
    private final String apiBase;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    public WeChatClient(@Value("${campus-market.wechat.app-id:}") String appId,
                        @Value("${campus-market.wechat.app-secret:}") String appSecret,
                        @Value("${campus-market.wechat.api-base:https://api.weixin.qq.com}") String apiBase,
                        ObjectMapper json) {
        this.appId = appId == null ? "" : appId.trim();
        this.appSecret = appSecret == null ? "" : appSecret.trim();
        this.apiBase = apiBase.replaceAll("/+$", "");
        this.json = json;
    }

    public boolean enabled() {
        return !appId.isEmpty() && !appSecret.isEmpty();
    }

    public String appId() {
        return appId;
    }

    public Identity exchange(String code) {
        if (!enabled()) throw new ApiException(503, "微信登录尚未开通", null);
        String url = apiBase + "/sns/jscode2session?appid=" + enc(appId) + "&secret=" + enc(appSecret)
                + "&js_code=" + enc(code) + "&grant_type=authorization_code";
        JsonNode body;
        try {
            HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(5)).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) throw new ApiException(503, "微信登录暂时不可用，请稍后重试", null);
            body = json.readTree(response.body());
        } catch (ApiException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(503, "微信登录暂时不可用，请稍后重试", null);
        } catch (Exception e) {
            // 不把异常信息（可能含完整请求地址与密钥）带进日志或响应
            throw new ApiException(503, "微信登录暂时不可用，请稍后重试", null);
        }
        int errcode = body.path("errcode").asInt(0);
        String openid = body.path("openid").asText("");
        if (errcode != 0 || openid.isEmpty() || openid.length() > 128) {
            // 40029 code 无效、40163 code 已被使用、45011 频率限制等：一律视为凭证无效，让小程序重新 wx.login
            throw ApiException.badRequest("微信登录凭证无效或已过期，请重试");
        }
        String unionid = body.path("unionid").asText("");
        return new Identity(appId, openid, unionid.isEmpty() || unionid.length() > 128 ? null : unionid);
    }

    // ================= 阶段 4：文本内容安全（msg_sec_check v2） =================

    public enum Verdict { PASS, REVIEW, RISKY, UNAVAILABLE }

    public record SecurityResult(Verdict verdict, String label) {}

    private volatile String accessToken;
    private volatile long accessTokenExpiresAt;

    /** 服务端调用凭证：缓存到过期前 5 分钟；拿不到时返回 null（调用方按「检测不可用」处理）。 */
    private synchronized String accessToken() {
        long now = System.currentTimeMillis();
        if (accessToken != null && now < accessTokenExpiresAt) return accessToken;
        try {
            String url = apiBase + "/cgi-bin/token?grant_type=client_credential&appid=" + enc(appId) + "&secret=" + enc(appSecret);
            HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(5)).GET().build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode body = json.readTree(response.body());
            String token = body.path("access_token").asText("");
            if (response.statusCode() != 200 || token.isEmpty()) return null;
            accessToken = token;
            accessTokenExpiresAt = now + Math.max(60, body.path("expires_in").asLong(7200) - 300) * 1000;
            return token;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 文本内容安全检测。scene：1 资料、2 评论、3 论坛、4 社交日志（微信定义）。需要用户的 openid，所以只对已绑定微信的用户调用。
     * 网络或接口错误返回 UNAVAILABLE，由调用方决定（当前：放行并记录告警，关键词过滤仍然生效）。
     */
    public SecurityResult msgSecCheck(String openid, int scene, String content) {
        if (!enabled()) return new SecurityResult(Verdict.UNAVAILABLE, "disabled");
        String token = accessToken();
        if (token == null) return new SecurityResult(Verdict.UNAVAILABLE, "token");
        try {
            String payload = json.writeValueAsString(java.util.Map.of("content", content, "version", 2, "scene", scene, "openid", openid));
            HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(apiBase + "/wxa/msg_sec_check?access_token=" + enc(token)))
                            .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)).build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode body = json.readTree(response.body());
            int errcode = body.path("errcode").asInt(0);
            if (errcode == 40001 || errcode == 42001) accessToken = null;       // 凭证失效：下次重新获取
            if (response.statusCode() != 200 || errcode != 0) return new SecurityResult(Verdict.UNAVAILABLE, "errcode-" + errcode);
            String suggest = body.path("result").path("suggest").asText("");
            String label = body.path("result").path("label").asText("0");
            return switch (suggest) {
                case "pass" -> new SecurityResult(Verdict.PASS, label);
                case "review" -> new SecurityResult(Verdict.REVIEW, "wechat-" + label);
                case "risky" -> new SecurityResult(Verdict.RISKY, "wechat-" + label);
                default -> new SecurityResult(Verdict.UNAVAILABLE, "suggest");
            };
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new SecurityResult(Verdict.UNAVAILABLE, "interrupted");
        } catch (Exception e) {
            return new SecurityResult(Verdict.UNAVAILABLE, "network");
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
