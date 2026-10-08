package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.inspection.InspectionService;
import com.lulu.campusmarketbackend.support.InspectionFixtures;
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
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 验货快照与订单同事务（3.3A）：快照失败时订单必须一起回滚，商品锁定也一并撤销。
 * 独立测试类：spy 会改变 Spring 上下文。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderSnapshotTransactionIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_snap_tx")
            .withUsername("campus_stx").withPassword("campus_stx_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "order-snapshot-tx-secret-0123456789ab");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;
    @MockitoSpyBean InspectionService inspections;

    @Test
    @DisplayName("快照写入失败 → 下单返回 500，订单、快照都不落库，商品仍是「在售」")
    void snapshotFailureRollsBackOrder() throws Exception {
        String seller = register(), buyer = register();
        String productId = publish(seller);
        // snapshotForOrder 要求 MANDATORY 事务；打桩调用也会经过代理，因此在事务里打桩
        transactions.executeWithoutResult(s ->
                doThrow(new IllegalStateException("模拟快照失败")).when(inspections).snapshotForOrder(any(UUID.class), any(UUID.class)));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("productId", productId);
        body.put("meetingPointId", "东校区-library");
        body.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).toString());
        body.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/orders").header("Authorization", "Bearer " + buyer)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andReturn();

        assertThat(r.getResponse().getStatus()).isEqualTo(500);
        assertThat(r.getResponse().getContentAsString()).doesNotContain("模拟快照失败");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id=?::uuid", Integer.class, productId)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_inspections", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, productId)).isEqualTo("在售");
    }

    private String register() throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "stx" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "tx");
        b.put("campus", "东校区");
        b.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
        return json.readTree(r.getResponse().getContentAsString()).path("data").path("accessToken").asText();
    }

    private String publish(String token) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", "快照事务");
        b.put("description", "d");
        b.put("price", 10);
        b.put("category", "数码电子");
        b.put("condition", "全新");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        b.put("inspection", InspectionFixtures.fullDisclosure("数码电子"));
        MvcResult r = mockMvc.perform(post("/v1/products").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(b))).andReturn();
        return json.readTree(r.getResponse().getContentAsString()).path("data").path("id").asText();
    }
}
