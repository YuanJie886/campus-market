package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.demand.DemandMatchService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 匹配失败时，商品发布必须整体失败（2.3 第五节）。
 *
 * <p>「商品发了、匹配没跑」是最糟糕的中间态：卖家以为发布成功，订阅者永远收不到通知，
 * 而且没有任何后台任务会补上。这里让匹配引擎抛错，确认接口返回失败、商品不落库。
 * 使用独立的测试类，是因为 spy 会改变 Spring 上下文，不应影响其他用例。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DemandTransactionIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_demand_tx")
            .withUsername("campus_dtx").withPassword("campus_dtx_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "demand-tx-it-secret-0123456789abcdef");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean DemandMatchService matches;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;

    @Test
    @DisplayName("匹配引擎只能在商品事务内调用：事务外调用直接失败，不会产生游离的匹配")
    void evaluateRequiresSurroundingTransaction() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> matches.evaluate(UUID.randomUUID()))
                .isInstanceOf(org.springframework.transaction.IllegalTransactionStateException.class);
    }

    @Test
    @DisplayName("匹配引擎抛错 → 发布接口返回 500，商品与匹配都不落库")
    void matchingFailureRollsBackProduct() throws Exception {
        String token = register();
        String title = "tx" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        // 打桩调用本身也会经过事务代理；evaluate 要求 MANDATORY，因此在一个事务里打桩
        transactions.executeWithoutResult(status ->
                doThrow(new IllegalStateException("模拟匹配失败")).when(matches).evaluate(any(UUID.class)));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("description", "d");
        body.put("price", 10);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "全新");
        body.put("campus", "东校区");
        body.put("images", List.of("https://example.invalid/a.png"));
        body.put("contact", "13800000000");
        MvcResult result = mockMvc.perform(post("/v1/products")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();

        assertThat(result.getResponse().getStatus()).as("不得返回「发布成功」").isEqualTo(500);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title=?", Integer.class, title))
                .as("商品必须随匹配失败一起回滚").isZero();
        // 500 响应也不泄露内部异常信息
        assertThat(result.getResponse().getContentAsString()).doesNotContain("模拟匹配失败");
    }

    private String register() throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "dtx" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "tx");
        b.put("campus", "东校区");
        b.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(b))).andReturn();
        return objectMapper.readTree(r.getResponse().getContentAsString()).path("data").path("accessToken").asText();
    }
}
