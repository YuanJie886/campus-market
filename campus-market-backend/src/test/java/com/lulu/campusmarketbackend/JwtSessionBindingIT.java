package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * JWT 签名校验与服务端 session 绑定的安全边界测试（R-03 配套）。
 *
 * <p>本类回答一个关键问题：<b>仅仅知道签名密钥，是否就能冒充任意用户？</b>
 * {@code AuthService.authenticate()} 在 JWT 验签通过之后，还会用
 * {@code sessions.countValid(sid, sub)} 回查数据库，要求 {@code (sid, user_id)}
 * 这一对同时命中且未过期。因此签名密钥泄露与身份冒充之间还隔着一道会话绑定。
 * 这里用真实 HTTP 请求把这道边界的每一个方向都测一遍。
 *
 * <p>测试全部使用真实注册流程取得 token，不 mock {@code AuthService} / {@code JwtService}，
 * 不手工塞 SecurityContext，不绕过 sessions 表。伪造 token 时直接用本测试注入的
 * 一次性密钥按生产相同格式签发，全程不打印 token、sid 或密钥。
 */
@Testcontainers
@SpringBootTest(properties = {
        // FlywayAutoConfiguration 的条件在自动配置选择阶段求值，DynamicPropertySource 对它不生效。
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JwtSessionBindingIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    private static final String TEST_DB = "campus_market_jwt";
    private static final String TEST_USER = "campus_jwt";
    private static final String TEST_PASSWORD = "campus_jwt_only";

    /** 本测试上下文运行时使用的签名密钥；仅测试用，不出现在任何生产资源中。 */
    private static final String RUNTIME_SECRET = "jwt-session-binding-it-secret-0123456789";
    /** 与上面不同的另一把密钥，用于构造「签名错误」的 token。 */
    private static final String WRONG_SECRET = "jwt-session-binding-it-WRONG-key-9876543210";

    private static final String ISSUER = "campus-market";
    private static final String AUDIENCE = "campus-market-web";

    private static final String CAMPUS = "东校区";
    private static final String ACCOUNT_PASSWORD = "test-password-2026";

    /** 受保护接口：需要认证，且不依赖任何业务前置数据。 */
    private static final String PROTECTED_ENDPOINT = "/v1/auth/me";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName(TEST_DB)
            .withUsername(TEST_USER)
            .withPassword(TEST_PASSWORD);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        // application-test.yaml 把 driver 固定为 org.h2.Driver，必须覆盖。
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.expiry-job-enabled", () -> "false");
        registry.add("campus-market.jwt-secret", () -> RUNTIME_SECRET);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    // ==================================================================
    // 基线：真实 token 必须可用
    // ==================================================================

    @Test
    @DisplayName("1. 真实注册得到的 access token 可以访问受保护接口")
    void genuineTokenAccessesProtectedEndpoint() throws Exception {
        Actor user = register("legit");

        MvcResult result = mockMvc.perform(get(PROTECTED_ENDPOINT)
                        .header("Authorization", "Bearer " + user.token()))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        assertThat(data.path("id").asText()).isEqualTo(user.id());
    }

    // ==================================================================
    // 会话绑定：sid 必须真实存在，且必须与 sub 属于同一行
    // ==================================================================

    @Test
    @DisplayName("2. 用正确密钥签发但 sid 为随机 UUID 的 token 必须 401")
    void correctlySignedTokenWithRandomSessionIdIsRejected() throws Exception {
        Actor user = register("randomsid");

        String forged = mintToken(RUNTIME_SECRET, user.id(), UUID.randomUUID().toString(),
                ISSUER, AUDIENCE, validExp());

        assertUnauthorized(forged, "随机 sid 在 sessions 表中不存在，必须拒绝");
    }

    @Test
    @DisplayName("3. 用 attacker 真实 sid 但把 sub 改成 victim 的 token 必须 401")
    void attackerSessionIdWithVictimSubjectIsRejected() throws Exception {
        Actor attacker = register("attacker");
        Actor victim = register("victim");

        // attacker 自己 token 里的 sid 是真实存在的会话
        String attackerSid = readSidFromToken(attacker.token());

        String forged = mintToken(RUNTIME_SECRET, victim.id(), attackerSid,
                ISSUER, AUDIENCE, validExp());

        assertUnauthorized(forged,
                "countValid 要求 (sid, user_id) 同时命中，attacker 的会话行 user_id 不是 victim");
    }

    @Test
    @DisplayName("4. 用 victim 的 sub 配随机 sid 的 token 必须 401")
    void victimSubjectWithRandomSessionIdIsRejected() throws Exception {
        Actor victim = register("victim2");

        String forged = mintToken(RUNTIME_SECRET, victim.id(), UUID.randomUUID().toString(),
                ISSUER, AUDIENCE, validExp());

        assertUnauthorized(forged, "仅知道受害者 userId 不足以通过认证");
    }

    // ==================================================================
    // JWT 自身校验：签名 / 过期 / issuer / audience
    // ==================================================================

    @Test
    @DisplayName("5. 用错误密钥签发、其余 claims 合法的 token 必须 401")
    void wronglySignedTokenIsRejected() throws Exception {
        Actor user = register("wrongsig");
        String sid = readSidFromToken(user.token());

        String forged = mintToken(WRONG_SECRET, user.id(), sid, ISSUER, AUDIENCE, validExp());

        assertUnauthorized(forged, "签名不匹配必须拒绝");
    }

    @Test
    @DisplayName("6. 已过期的 token 必须 401")
    void expiredTokenIsRejected() throws Exception {
        Actor user = register("expired");
        String sid = readSidFromToken(user.token());

        long expiredAt = Instant.now().getEpochSecond() - 60;
        String forged = mintToken(RUNTIME_SECRET, user.id(), sid, ISSUER, AUDIENCE, expiredAt);

        assertUnauthorized(forged, "exp 已过必须拒绝");
    }

    @Test
    @DisplayName("7. issuer 或 audience 不匹配的 token 必须 401")
    void wrongIssuerOrAudienceIsRejected() throws Exception {
        Actor user = register("issaud");
        String sid = readSidFromToken(user.token());

        String wrongIssuer = mintToken(RUNTIME_SECRET, user.id(), sid,
                "not-campus-market", AUDIENCE, validExp());
        assertUnauthorized(wrongIssuer, "issuer 不匹配必须拒绝");

        String wrongAudience = mintToken(RUNTIME_SECRET, user.id(), sid,
                ISSUER, "not-campus-market-web", validExp());
        assertUnauthorized(wrongAudience, "audience 不匹配必须拒绝");
    }

    @Test
    @DisplayName("8. 缺少 Authorization 头或格式错误必须 401")
    void missingOrMalformedAuthorizationHeaderIsRejected() throws Exception {
        assertThat(mockMvc.perform(get(PROTECTED_ENDPOINT)).andReturn().getResponse().getStatus())
                .as("无 Authorization 头").isEqualTo(401);

        assertThat(mockMvc.perform(get(PROTECTED_ENDPOINT).header("Authorization", "Token abc"))
                        .andReturn().getResponse().getStatus())
                .as("非 Bearer 前缀").isEqualTo(401);

        assertThat(mockMvc.perform(get(PROTECTED_ENDPOINT).header("Authorization", "Bearer not-a-jwt"))
                        .andReturn().getResponse().getStatus())
                .as("结构非法的 token").isEqualTo(401);
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    private record Actor(String id, String token) {}

    private Actor register(String role) throws Exception {
        String account = role + UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", ACCOUNT_PASSWORD);
        body.put("nickname", role);
        body.put("campus", CAMPUS);
        body.put("contact", "13800000000");

        MvcResult result = mockMvc.perform(post("/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();

        assertThat(result.getResponse().getStatus()).as("注册 %s 应成功", role).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        String token = data.path("accessToken").asText();
        String id = data.path("user").path("id").asText();
        assertThat(token).isNotBlank();
        assertThat(id).isNotBlank();
        return new Actor(id, token);
    }

    /** 断言伪造 token 被拒绝，且响应不回显 token 内容。 */
    private void assertUnauthorized(String token, String because) throws Exception {
        MvcResult result = mockMvc.perform(get(PROTECTED_ENDPOINT)
                        .header("Authorization", "Bearer " + token))
                .andReturn();

        String responseBody = result.getResponse().getContentAsString();
        assertThat(result.getResponse().getStatus()).as(because).isEqualTo(401);
        assertThat(objectMapper.readTree(responseBody).path("code").asInt()).isEqualTo(401);
        assertThat(responseBody).as("错误响应不得回显 token").doesNotContain(token);
    }

    private static long validExp() {
        return Instant.now().getEpochSecond() + 900;
    }

    /**
     * 只读取 payload 中的 sid，不需要密钥（JWT payload 本就是 Base64 明文）。
     * 返回值仅在内存中用于构造测试 token，不打印。
     */
    private String readSidFromToken(String token) throws Exception {
        String payload = token.split("\\.")[1];
        JsonNode claims = objectMapper.readTree(Base64.getUrlDecoder().decode(payload));
        String sid = claims.path("sid").asText();
        assertThat(sid).isNotBlank();
        return sid;
    }

    /** 按生产 JwtService 相同的格式签发一个 HS256 token，用于构造各种攻击载荷。 */
    private String mintToken(String secret, String sub, String sid,
                             String issuer, String audience, long exp) throws Exception {
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();

        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("sub", sub);
        payload.put("sid", sid);
        payload.put("iss", issuer);
        payload.put("aud", audience);
        payload.put("iat", Instant.now().getEpochSecond());
        payload.put("exp", exp);

        String content = encoder.encodeToString(objectMapper.writeValueAsBytes(header))
                + "." + encoder.encodeToString(objectMapper.writeValueAsBytes(payload));

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return content + "." + encoder.encodeToString(mac.doFinal(content.getBytes(StandardCharsets.UTF_8)));
    }
}
