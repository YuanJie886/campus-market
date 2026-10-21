package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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

import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Access Token 过期时间单一真值测试（0.8D）。
 *
 * <p>改造前 {@code JwtService} 按可配置的 {@code access-token-minutes} 计算 JWT 的 {@code exp}，
 * 而 {@code AuthService} 返回的 {@code expiresAtIso} 是硬编码的 900 秒。
 * 只要把配置改成 15 分钟以外的值，两者立刻漂移，前端的刷新调度随之失真。
 *
 * <p>现在两者来自 {@code JwtService.issue()} 的<b>同一次</b>计算。
 * 本类分别用 1 分钟与 30 分钟两种配置验证一致性，并覆盖注册 / 登录 / refresh 三条签发路径。
 * 全程不打印 token 内容。
 */
@Testcontainers
class TokenExpiryConsistencyIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String CAMPUS = "东校区";
    private static final String PASSWORD = "test-password-2026";
    /** JWT exp 只精确到秒，允许 1 秒的取整误差，但不容忍按分钟重新独立计算造成的漂移。 */
    private static final long TOLERANCE_SECONDS = 1;

    /** 抽出公共断言，供不同有效期配置的嵌套类复用。 */
    abstract static class ExpiryContract {

        @Autowired protected MockMvc mockMvc;
        @Autowired protected ObjectMapper objectMapper;

        abstract long expectedMinutes();

        @Test
        @DisplayName("注册 / 登录 / refresh 三条路径的 expiresAtIso 都与 JWT exp 一致")
        void allIssuancePathsAgree() throws Exception {
            String account = "exp" + UUID.randomUUID().toString().replace("-", "");

            MvcResult registered = register(account);
            assertThat(registered.getResponse().getStatus()).isEqualTo(200);
            assertAgrees(registered, "注册");

            MvcResult loggedIn = login(account);
            assertThat(loggedIn.getResponse().getStatus()).isEqualTo(200);
            assertAgrees(loggedIn, "登录");

            String setCookie = loggedIn.getResponse().getHeader("Set-Cookie");
            assertThat(setCookie).isNotNull();
            MvcResult refreshed = refresh(setCookie);
            assertThat(refreshed.getResponse().getStatus()).isEqualTo(200);
            assertAgrees(refreshed, "refresh");
        }

        /** 断言响应的 expiresAtIso 与 JWT 的 exp 同源，且符合当前配置的有效期。 */
        private void assertAgrees(MvcResult result, String path) throws Exception {
            JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
            String token = data.path("accessToken").asText();
            Instant reported = Instant.parse(data.path("expiresAtIso").asText());

            JsonNode claims = objectMapper.readTree(
                    Base64.getUrlDecoder().decode(token.split("\\.")[1]));
            Instant jwtExp = Instant.ofEpochSecond(claims.path("exp").asLong());

            assertThat(Math.abs(reported.getEpochSecond() - jwtExp.getEpochSecond()))
                    .as("%s：expiresAtIso 必须与 JWT exp 同源", path)
                    .isLessThanOrEqualTo(TOLERANCE_SECONDS);

            long lifetime = jwtExp.getEpochSecond() - claims.path("iat").asLong();
            assertThat(lifetime)
                    .as("%s：有效期应等于配置的 %d 分钟", path, expectedMinutes())
                    .isEqualTo(expectedMinutes() * 60);

            // 其余 claim 不因本次改造变化
            assertThat(claims.path("iss").asText()).isEqualTo("campus-market");
            assertThat(claims.path("aud").asText()).isEqualTo("campus-market-web");
            assertThat(claims.path("sub").asText()).isNotBlank();
            assertThat(claims.path("sid").asText()).isNotBlank();
        }

        private MvcResult register(String account) throws Exception {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("account", account);
            body.put("password", PASSWORD);
            body.put("nickname", "过期一致性");
            body.put("campus", CAMPUS);
            body.put("contact", "13800000000");
            return mockMvc.perform(post("/v1/auth/register")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(body))).andReturn();
        }

        private MvcResult login(String account) throws Exception {
            return mockMvc.perform(post("/v1/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(
                            Map.of("account", account, "password", PASSWORD)))).andReturn();
        }

        private MvcResult refresh(String setCookieHeader) throws Exception {
            String pair = setCookieHeader.split(";", 2)[0];
            int eq = pair.indexOf('=');
            jakarta.servlet.http.Cookie cookie =
                    new jakarta.servlet.http.Cookie(pair.substring(0, eq), pair.substring(eq + 1));
            return mockMvc.perform(post("/v1/auth/refresh").cookie(cookie)).andReturn();
        }
    }

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_exp")
            .withUsername("campus_exp").withPassword("campus_exp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "token-expiry-it-secret-0123456789abc");
    }

    @Nested
    @Testcontainers
    @SpringBootTest(properties = {
            "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=false",
            "campus-market.access-token-minutes=1",
    })
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    @DisplayName("配置为 1 分钟")
    class OneMinute extends ExpiryContract {
        @Override long expectedMinutes() { return 1; }
    }

    @Nested
    @Testcontainers
    @SpringBootTest(properties = {
            "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=false",
            "campus-market.access-token-minutes=30",
    })
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    @DisplayName("配置为 30 分钟")
    class ThirtyMinutes extends ExpiryContract {
        @Override long expectedMinutes() { return 30; }
    }

    @Nested
    @Testcontainers
    @SpringBootTest(properties = {
            "spring.flyway.enabled=true", "spring.flyway.baseline-on-migrate=false",
    })
    @AutoConfigureMockMvc
    @ActiveProfiles("test")
    @DisplayName("默认 15 分钟行为不变")
    class DefaultFifteenMinutes extends ExpiryContract {
        @Override long expectedMinutes() { return 15; }
    }
}
