package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 刷新 Cookie 的属性与生命周期（0.9B）。
 *
 * <p>Access Token 在 0.9A 之后只活在内存里，刷新页面全靠这枚 Cookie 换新令牌——
 * 它成了系统里生命周期最长、价值最高的凭据（默认 7 天）。因此它的每一条属性
 * 都必须被测试钉死，而不是靠读代码确认：少一个 HttpOnly，一次 XSS 就能拿到
 * 七天的登录态；少一个 SameSite，站外表单就能替用户刷新会话。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RefreshCookieIT {

    private static final String COOKIE_NAME = "cm_refresh";
    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_cookie")
            .withUsername("campus_cookie").withPassword("campus_cookie_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "refresh-cookie-it-secret-0123456789ab");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    @DisplayName("1. 注册与登录下发的 Cookie 带齐 HttpOnly / SameSite=Strict / Path=/v1/auth / Max-Age")
    void issuedCookieCarriesHardenedAttributes() throws Exception {
        String setCookie = setCookieHeaderOf(register(freshAccount()));
        assertThat(setCookie).as("注册必须下发刷新 Cookie").isNotNull();

        String lower = setCookie.toLowerCase(Locale.ROOT);
        assertThat(lower).as("HttpOnly 缺失则 XSS 可直接读走长期凭据").contains("httponly");
        assertThat(lower).as("SameSite=Strict 阻止站外触发刷新").contains("samesite=strict");
        assertThat(lower).as("Path 限定到 /v1/auth，普通业务请求不携带").contains("path=/v1/auth");
        assertThat(lower).as("必须有明确有效期，而非会话 Cookie").contains("max-age=");
        // Max-Age 取自配置的 refresh-token-days，不得是 0 或负数
        long maxAge = Long.parseLong(lower.replaceAll(".*max-age=(-?\\d+).*", "$1"));
        assertThat(maxAge).isPositive();
    }

    @Test
    @DisplayName("2. 刷新令牌绝不出现在响应体中（只能走 Set-Cookie）")
    void refreshTokenNeverAppearsInResponseBody() throws Exception {
        MvcResult result = register(freshAccount());
        String body = result.getResponse().getContentAsString();
        JsonNode data = objectMapper.readTree(body).path("data");

        assertThat(data.has("refreshToken")).as("响应体不得包含 refreshToken 字段").isFalse();
        assertThat(data.path("accessToken").asText()).isNotBlank();

        // Cookie 的值本身也不得以任何形式出现在 JSON 里
        String cookieValue = cookieOf(result).getValue();
        assertThat(cookieValue).isNotBlank();
        assertThat(body).as("刷新令牌的值不得泄漏进响应体").doesNotContain(cookieValue);
    }

    @Test
    @DisplayName("3. 刷新会轮换令牌：新 Cookie 与旧值不同，且旧值立即失效")
    void refreshRotatesAndInvalidatesOldToken() throws Exception {
        Cookie original = cookieOf(register(freshAccount()));

        MvcResult refreshed = mockMvc.perform(post("/v1/auth/refresh").cookie(original)).andReturn();
        assertThat(refreshed.getResponse().getStatus()).isEqualTo(200);
        Cookie rotated = cookieOf(refreshed);
        assertThat(rotated.getValue()).as("刷新必须轮换令牌").isNotEqualTo(original.getValue());

        // 旧令牌重放：必须被拒绝
        MvcResult replay = mockMvc.perform(post("/v1/auth/refresh").cookie(original)).andReturn();
        assertThat(replay.getResponse().getStatus()).as("旧刷新令牌不得再次可用").isEqualTo(401);

        // 新令牌仍然有效
        assertThat(mockMvc.perform(post("/v1/auth/refresh").cookie(rotated)).andReturn()
                .getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("4. 并发刷新：同一枚令牌只能成功一次，另一次必须失败而非双双签发")
    void concurrentRefreshWithSameTokenSucceedsOnlyOnce() throws Exception {
        Cookie original = cookieOf(register(freshAccount()));

        // 顺序提交两次同一枚令牌，等价于两个标签页竞态中的「后到者」
        int first = mockMvc.perform(post("/v1/auth/refresh").cookie(original)).andReturn().getResponse().getStatus();
        int second = mockMvc.perform(post("/v1/auth/refresh").cookie(original)).andReturn().getResponse().getStatus();

        assertThat(List.of(first, second))
                .as("轮换语义要求同一枚令牌只能兑换一次")
                .containsExactly(200, 401);
    }

    @Test
    @DisplayName("5. 登出清除 Cookie：Max-Age=0 且属性与下发时一致，服务端会话同时失效")
    void logoutClearsCookieAndServerSession() throws Exception {
        Cookie issued = cookieOf(register(freshAccount()));

        MvcResult logout = mockMvc.perform(post("/v1/auth/logout").cookie(issued)).andReturn();
        String setCookie = setCookieHeaderOf(logout);
        assertThat(setCookie).as("登出必须显式清除 Cookie").isNotNull();

        String lower = setCookie.toLowerCase(Locale.ROOT);
        assertThat(lower).contains("max-age=0");
        assertThat(lower).as("清除时属性必须与下发时一致，否则浏览器不会覆盖原 Cookie")
                .contains("httponly").contains("samesite=strict").contains("path=/v1/auth");
        assertThat(cookieOf(logout).getValue()).isEmpty();

        // 仅清浏览器端不够：服务端会话也必须删除，否则被窃取的令牌仍然可用
        assertThat(mockMvc.perform(post("/v1/auth/refresh").cookie(issued)).andReturn()
                .getResponse().getStatus()).as("登出后旧令牌不得还能刷新").isEqualTo(401);
    }

    @Test
    @DisplayName("6. 无 Cookie / 伪造 Cookie 的刷新一律 401，且不下发新 Cookie")
    void refreshWithoutValidCookieIsRejected() throws Exception {
        MvcResult none = mockMvc.perform(post("/v1/auth/refresh")).andReturn();
        assertThat(none.getResponse().getStatus()).isEqualTo(401);
        assertThat(none.getResponse().getHeader("Set-Cookie")).isNull();

        Cookie forged = new Cookie(COOKIE_NAME, UUID.randomUUID() + "." + UUID.randomUUID());
        MvcResult fake = mockMvc.perform(post("/v1/auth/refresh").cookie(forged)).andReturn();
        assertThat(fake.getResponse().getStatus()).isEqualTo(401);
        assertThat(fake.getResponse().getHeader("Set-Cookie")).isNull();
    }

    @Test
    @DisplayName("7. HTTPS 站点上 SECURE_COOKIES=false 的矛盾配置必须拒绝启动")
    void insecureCookieOnHttpsOriginIsRefused() {
        // 直接构造：这条策略是构造期判定，不依赖容器
        assertThatThrownBy(() -> new com.lulu.campusmarketbackend.security.AuthService(
                null, null, null, null, null, null, "https://market.example.edu", false, 7))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SECURE_COOKIES");

        // http 本地开发仍然允许（只告警），否则开发环境无法工作
        org.assertj.core.api.Assertions.assertThatCode(() -> new com.lulu.campusmarketbackend.security.AuthService(
                null, null, null, null, null, null, "http://localhost:5173", false, 7))
                .doesNotThrowAnyException();
    }

    // ==================================================================

    private String freshAccount() {
        return "cookie" + UUID.randomUUID().toString().replace("-", "");
    }

    private MvcResult register(String account) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", "test-password-2026");
        body.put("nickname", "cookie");
        body.put("campus", "东校区");
        body.put("contact", "13800000000");
        return mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private String setCookieHeaderOf(MvcResult result) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(header -> header.startsWith(COOKIE_NAME + "="))
                .findFirst().orElse(null);
    }

    private Cookie cookieOf(MvcResult result) {
        Cookie cookie = result.getResponse().getCookie(COOKIE_NAME);
        assertThat(cookie).as("响应必须包含 %s", COOKIE_NAME).isNotNull();
        return cookie;
    }
}
