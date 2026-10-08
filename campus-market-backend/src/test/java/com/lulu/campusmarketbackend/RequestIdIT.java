package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
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

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 全链路 requestId 的集成测试（0.8B）。
 *
 * <p>改造前 {@code ApiEnvelope.ok()} 把成功响应的 requestId 硬编码为 {@code null}，
 * 错误路径又在每个 catch 里各自 {@code UUID.randomUUID()}，与请求入口无关、也不进日志。
 * 现在由 {@code RequestIdFilter} 统一生成，贯穿响应头、envelope、MDC 与访问日志。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.login.limit=1",
        "campus-market.rate-limit.login.window-seconds=600",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@org.springframework.context.annotation.Import(RequestIdIT.FaultyEndpointConfiguration.class)
class RequestIdIT {

    private static final String HEADER = "X-Request-ID";
    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_rid")
            .withUsername("campus_rid").withPassword("campus_rid_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "request-id-it-secret-0123456789abcdef");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    @DisplayName("1. 未传入时自动生成，且 header 与 envelope 一致（成功响应非 null）")
    void generatesRequestIdWhenAbsent() throws Exception {
        MvcResult result = mockMvc.perform(get("/v1/health")).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        String header = result.getResponse().getHeader(HEADER);
        assertThat(header).as("成功响应必须带 X-Request-ID").isNotBlank();

        JsonNode envelope = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(envelope.path("code").asInt()).isZero();
        assertThat(envelope.path("requestId").asText())
                .as("成功响应的 requestId 不再固定 null").isEqualTo(header);
        // 生成值不可预测：应为 UUID 形态而非递增序号
        assertThat(header).matches("[0-9a-f-]{36}");
    }

    @Test
    @DisplayName("2. 合法传入值被沿用")
    void reusesValidIncomingRequestId() throws Exception {
        String incoming = "client-Req_12345";
        MvcResult result = mockMvc.perform(get("/v1/health").header(HEADER, incoming)).andReturn();

        assertThat(result.getResponse().getHeader(HEADER)).isEqualTo(incoming);
        assertThat(objectMapper.readTree(result.getResponse().getContentAsString())
                .path("requestId").asText()).isEqualTo(incoming);
    }

    @Test
    @DisplayName("3. 非法字符 / 过短 / 过长 / 换行注入一律丢弃并重新生成")
    void rejectsInvalidIncomingRequestId() throws Exception {
        List<String> invalid = List.of(
                "short",                                   // 长度不足 8
                "a".repeat(65),                            // 超长
                "has spaces here",                         // 空格
                "has:colon:value",                         // 非法字符
                "bad\r\nX-Injected: evil",                 // CRLF 注入
                "中文请求标识符中文请求标识符");                // 非 ASCII
        for (String value : invalid) {
            MvcResult result = mockMvc.perform(get("/v1/health").header(HEADER, value)).andReturn();
            String header = result.getResponse().getHeader(HEADER);

            assertThat(header).as("非法值 [%s] 应被丢弃", value).isNotEqualTo(value);
            assertThat(header).as("重新生成的值应为 UUID 形态").matches("[0-9a-f-]{36}");
            assertThat(header).as("响应头不得含换行，杜绝 header 注入")
                    .doesNotContain("\r").doesNotContain("\n");
            // 注入的伪造头不得出现
            assertThat(result.getResponse().getHeader("X-Injected")).isNull();
        }
    }

    @Test
    @DisplayName("4. 各类错误响应（400/401/404/409/429/500）都带 requestId，且与 header 一致")
    void allErrorResponsesCarryRequestId() throws Exception {
        // 401：未认证
        assertRequestIdPresent(mockMvc.perform(get("/v1/auth/me")).andReturn(), 401);

        // 400：未知字段（0.8C 白名单）
        assertRequestIdPresent(mockMvc.perform(post("/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"account\":\"a\",\"password\":\"b\",\"role\":\"admin\"}")).andReturn(), 400);

        // 401：6.1A 起未登录不能读取商品（无论商品是否存在）
        assertRequestIdPresent(mockMvc.perform(
                get("/v1/products/" + UUID.randomUUID())).andReturn(), 401);

        // 登录限流 limit=1，因此必须先把要用的令牌取到手，再去触发 429
        String account = "rid" + UUID.randomUUID().toString().replace("-", "");
        registerUser(account);
        String token = tokenOf(account);
        assertThat(token).as("前置条件：首次登录应成功并返回令牌").isNotEqualTo("not-a-valid-token");

        // 404：已登录但订单不存在（不泄漏订单是否存在，统一 404）
        assertRequestIdPresent(mockMvc.perform(
                post("/v1/orders/" + UUID.randomUUID() + "/transitions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"to\":\"CANCELLED\",\"reason\":\"x\"}")).andReturn(), 404);

        // 409：重复注册同一账号
        assertRequestIdPresent(registerRaw(account), 409);

        // 429：登录限流（limit=1，上面已经用掉了唯一一次配额）
        assertRequestIdPresent(mockMvc.perform(loginRequest(account)).andReturn(), 429);

        // 500：仅存在于 test source 的故障端点，生产代码中没有这个接口
        assertRequestIdPresent(mockMvc.perform(get("/__test__/boom")).andReturn(), 500);

        // 8.2 回归：框架层的请求错误保留自己的状态码（曾经一律 500），同样带 requestId
        assertRequestIdPresent(mockMvc.perform(get("/v1/no-such-endpoint")).andReturn(), 404);
        assertRequestIdPresent(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/v1/health")).andReturn(), 405);
        assertRequestIdPresent(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/login")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON).content("{not json")).andReturn(), 400);
    }

    /**
     * 仅测试用的故障端点，用于验证「未处理异常」路径也带 requestId。
     * 放在 test source，不会进入生产构建。
     */
    @org.springframework.boot.test.context.TestConfiguration
    static class FaultyEndpointConfiguration {
        @org.springframework.context.annotation.Bean
        FaultyController faultyController() { return new FaultyController(); }
    }

    @org.springframework.web.bind.annotation.RestController
    static class FaultyController {
        @org.springframework.web.bind.annotation.GetMapping("/__test__/boom")
        public String boom() { throw new IllegalStateException("intentional failure for requestId coverage"); }
    }

    @Test
    @DisplayName("5. 请求完成后 MDC 被清理，且并发请求 requestId 互不串号")
    void mdcIsClearedAndConcurrentRequestsDoNotShareIds() throws Exception {
        mockMvc.perform(get("/v1/health")).andReturn();
        assertThat(MDC.get("requestId")).as("请求结束后 MDC 必须清理，防止线程复用串号").isNull();

        int threads = 12;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        Set<String> seen = ConcurrentHashMap.newKeySet();
        List<Future<String>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return mockMvc.perform(get("/v1/health")).andReturn().getResponse().getHeader(HEADER);
                }));
            }
            gate.countDown();
            for (Future<String> f : futures) {
                String id = f.get(60, TimeUnit.SECONDS);
                assertThat(id).isNotBlank();
                seen.add(id);
            }
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(seen).as("并发请求的 requestId 必须两两不同").hasSize(threads);
    }

    // ==================================================================

    private void assertRequestIdPresent(MvcResult result, int expectedStatus) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(expectedStatus);
        String header = result.getResponse().getHeader(HEADER);
        assertThat(header).as("status=%d 的响应必须带 X-Request-ID", expectedStatus).isNotBlank();

        JsonNode envelope = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(envelope.path("requestId").asText())
                .as("status=%d 的 envelope.requestId 必须与 header 一致", expectedStatus)
                .isEqualTo(header);
    }

    private String tokenOf(String account) throws Exception {
        MvcResult result = mockMvc.perform(loginRequest(account)).andReturn();
        if (result.getResponse().getStatus() != 200) return "not-a-valid-token";
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("accessToken").asText();
    }

    private MvcResult registerRaw(String account) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", "test-password-2026");
        body.put("nickname", "requestId");
        body.put("campus", "东校区");
        body.put("contact", "13800000000");
        return mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private void registerUser(String account) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", "test-password-2026");
        body.put("nickname", "requestId");
        body.put("campus", "东校区");
        body.put("contact", "13800000000");
        mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder loginRequest(String account)
            throws Exception {
        return post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("account", account, "password", "test-password-2026")));
    }
}
