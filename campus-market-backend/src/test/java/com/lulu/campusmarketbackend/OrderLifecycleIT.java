package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.service.OrderTransitionExecutor;
import org.assertj.core.api.SoftAssertions;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 订单生命周期出口测试（R-06 / 0.7A）。
 *
 * <p>背景：{@code BUYER_CONFIRMED} 曾经三面封闭——不可取消、不被过期任务处理、
 * 唯一出口是卖家提交确认码；0.6C 让确认码 5 次上限真正生效后，卖家输错 5 次即可
 * 把订单和商品永久锁死（商品停留在「预约中」，被部分唯一索引占用，卖家连下架都不行）。
 *
 * <p>本类验证两条新出口：买家带原因取消、以及独立的 24 小时自动过期；
 * 同时覆盖确认码缺失不再消耗次数，以及完成与过期并发时的终态一致性。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderLifecycleIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String TEST_DB = "campus_market_lifecycle";
    private static final String TEST_USER = "campus_lifecycle";
    private static final String TEST_PASSWORD = "campus_lifecycle_only";

    private static final String CAMPUS = "东校区";
    private static final String ACCOUNT_PASSWORD = "test-password-2026";
    private static final int MAX_CODE_ATTEMPTS = 5;

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
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "order-lifecycle-it-secret-0123456789abcd");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;
    /** 直接调用真实执行器触发过期扫描，不 mock，也不等 60 秒定时任务。 */
    @Autowired private OrderTransitionExecutor transitions;

    // ==================================================================
    // A. 买家从 BUYER_CONFIRMED 取消
    // ==================================================================

    @Test
    @DisplayName("A1. 买家可从 BUYER_CONFIRMED 带原因取消，商品恢复在售并释放名额")
    void buyerCanCancelFromBuyerConfirmed() throws Exception {
        Scenario s = buyerConfirmed("a1");

        MvcResult result = transition(s.buyer(), s.orderId(),
                Map.of("to", "CANCELLED", "reasonCode", "CHANGED_MIND", "reason", "临时有事，无法面交"));

        assertThat(result.getResponse().getStatus()).as("买家取消应成功").isEqualTo(200);
        assertThat(orderStatus(s.orderId())).isEqualTo("CANCELLED");
        assertThat(productStatus(s.productId())).as("商品应恢复在售").isEqualTo("在售");
        assertThat(eventCountTo(s.orderId(), "CANCELLED")).as("仅写入一条取消事件").isEqualTo(1);
        assertThat(activeOrderCount(s.productId())).as("活跃订单名额已释放").isZero();

        // 另一个买家可以重新下单
        Actor other = register("a1-other");
        String newOrderId = createOrder(other, s.productId(), pickMeetingPoint(other));
        assertThat(orderStatus(newOrderId)).isEqualTo("PENDING_SELLER_CONFIRM");
        assertThat(productStatus(s.productId())).isEqualTo("预约中");
    }

    @Test
    @DisplayName("A2. 取消原因缺失 / 空串 / 纯空白一律 400，且不取消")
    void cancelFromBuyerConfirmedRequiresReason() throws Exception {
        Scenario s = buyerConfirmed("a2");
        SoftAssertions soft = new SoftAssertions();

        for (Map<String, Object> body : List.of(
                Map.<String, Object>of("to", "CANCELLED"),
                Map.<String, Object>of("to", "CANCELLED", "reason", ""),
                Map.<String, Object>of("to", "CANCELLED", "reason", "   "))) {
            MvcResult result = transition(s.buyer(), s.orderId(), body);
            soft.assertThat(result.getResponse().getStatus())
                    .as("原因为 %s 时应 400", body.get("reason")).isEqualTo(400);
        }
        // reason 显式为 null
        Map<String, Object> nullReason = new HashMap<>();
        nullReason.put("to", "CANCELLED");
        nullReason.put("reason", null);
        soft.assertThat(transition(s.buyer(), s.orderId(), nullReason).getResponse().getStatus())
                .as("原因为 null 时应 400").isEqualTo(400);

        soft.assertThat(orderStatus(s.orderId())).as("订单不得被取消").isEqualTo("BUYER_CONFIRMED");
        soft.assertThat(productStatus(s.productId())).isEqualTo("预约中");
        soft.assertThat(eventCountTo(s.orderId(), "CANCELLED")).isZero();
        soft.assertAll();
    }

    @Test
    @DisplayName("A3. 卖家不能从 BUYER_CONFIRMED 取消（409），无关用户 403")
    void sellerCannotCancelFromBuyerConfirmed() throws Exception {
        Scenario s = buyerConfirmed("a3");
        Actor outsider = register("a3-outsider");

        assertThat(transition(s.seller(), s.orderId(), Map.of("to", "CANCELLED", "reasonCode", "CHANGED_MIND", "reason", "不想卖了"))
                .getResponse().getStatus()).as("卖家取消应 409").isEqualTo(409);
        assertThat(transition(outsider, s.orderId(), Map.of("to", "CANCELLED", "reasonCode", "CHANGED_MIND", "reason", "路过"))
                .getResponse().getStatus()).as("无关用户应 403").isEqualTo(403);

        assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        assertThat(productStatus(s.productId())).isEqualTo("预约中");
    }

    @Test
    @DisplayName("A4. 卖家输错 5 次锁定后，买家仍可取消并释放商品")
    void buyerCanStillCancelAfterCodeLock() throws Exception {
        Scenario s = buyerConfirmed("a4");
        String wrong = wrongCodeFor(s.realCode());
        for (int i = 0; i < MAX_CODE_ATTEMPTS; i++) submitCode(s.seller(), s.orderId(), wrong);
        assertThat(codeAttempts(s.orderId())).isEqualTo(MAX_CODE_ATTEMPTS);

        // 锁定确认：正确码也不行
        assertThat(submitCode(s.seller(), s.orderId(), s.realCode()).getResponse().getStatus())
                .isBetween(400, 499);

        // 买家仍有出口
        assertThat(transition(s.buyer(), s.orderId(), Map.of("to", "CANCELLED", "reasonCode", "CHANGED_MIND", "reason", "卖家核销失败"))
                .getResponse().getStatus()).as("锁定后买家仍可取消").isEqualTo(200);

        assertThat(orderStatus(s.orderId())).isEqualTo("CANCELLED");
        assertThat(productStatus(s.productId())).as("商品必须解除占用").isEqualTo("在售");
        assertThat(activeOrderCount(s.productId())).isZero();
    }

    // ==================================================================
    // B. BUYER_CONFIRMED 24 小时自动过期
    // ==================================================================

    @Test
    @DisplayName("B1. BUYER_CONFIRMED 未到 24 小时不过期")
    void buyerConfirmedDoesNotExpireBeforeThreshold() throws Exception {
        Scenario s = buyerConfirmed("b1");
        backdateUpdatedAt(s.orderId(), 23);      // 23 小时前

        transitions.sweepExpired();

        assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        assertThat(productStatus(s.productId())).isEqualTo("预约中");
        assertThat(eventCountTo(s.orderId(), "EXPIRED")).isZero();
    }

    @Test
    @DisplayName("B2. BUYER_CONFIRMED 超过 24 小时自动 EXPIRED，商品恢复在售")
    void buyerConfirmedExpiresAfterThreshold() throws Exception {
        Scenario s = buyerConfirmed("b2");
        backdateUpdatedAt(s.orderId(), 25);      // 25 小时前

        transitions.sweepExpired();

        assertThat(orderStatus(s.orderId())).as("应自动过期").isEqualTo("EXPIRED");
        assertThat(productStatus(s.productId())).as("商品应恢复在售").isEqualTo("在售");
        assertThat(eventCountTo(s.orderId(), "EXPIRED")).as("仅一条过期事件").isEqualTo(1);
        assertThat(activeOrderCount(s.productId())).isZero();

        // 另一买家可以重新下单
        Actor other = register("b2-other");
        String newOrderId = createOrder(other, s.productId(), pickMeetingPoint(other));
        assertThat(orderStatus(newOrderId)).isEqualTo("PENDING_SELLER_CONFIRM");

        // 重复扫描不得重复写事件
        transitions.sweepExpired();
        assertThat(eventCountTo(s.orderId(), "EXPIRED")).isEqualTo(1);
    }

    @Test
    @DisplayName("B3. 已完成与已取消的订单不会被过期扫描改动")
    void terminalOrdersAreNeverExpired() throws Exception {
        Scenario completed = buyerConfirmed("b3-done");
        assertThat(submitCode(completed.seller(), completed.orderId(), completed.realCode())
                .getResponse().getStatus()).isEqualTo(200);
        assertThat(orderStatus(completed.orderId())).isEqualTo("COMPLETED");

        Scenario cancelled = buyerConfirmed("b3-cancel");
        assertThat(transition(cancelled.buyer(), cancelled.orderId(),
                Map.of("to", "CANCELLED", "reasonCode", "CHANGED_MIND", "reason", "不要了")).getResponse().getStatus()).isEqualTo(200);

        backdateUpdatedAt(completed.orderId(), 100);
        backdateUpdatedAt(cancelled.orderId(), 100);
        transitions.sweepExpired();

        assertThat(orderStatus(completed.orderId())).isEqualTo("COMPLETED");
        assertThat(productStatus(completed.productId())).isEqualTo("已售出");
        assertThat(orderStatus(cancelled.orderId())).isEqualTo("CANCELLED");
        assertThat(eventCountTo(completed.orderId(), "EXPIRED")).isZero();
        assertThat(eventCountTo(cancelled.orderId(), "EXPIRED")).isZero();
    }

    // ==================================================================
    // C. 确认码缺失 / 格式非法不得消耗次数
    // ==================================================================

    @Test
    @DisplayName("C1. 缺失 / 空白 / 非 6 位确认码一律 400 且不消耗次数；仅错误的六位数字才计数")
    void onlyWrongSixDigitCodeConsumesAttempt() throws Exception {
        Scenario s = buyerConfirmed("c1");
        SoftAssertions soft = new SoftAssertions();

        // 缺 confirmationCode
        soft.assertThat(transition(s.seller(), s.orderId(), Map.of("to", "COMPLETED"))
                .getResponse().getStatus()).as("缺确认码应 400").isEqualTo(400);
        soft.assertThat(codeAttempts(s.orderId())).as("缺确认码不得计数").isZero();

        // 显式 null
        Map<String, Object> nullCode = new HashMap<>();
        nullCode.put("to", "COMPLETED");
        nullCode.put("confirmationCode", null);
        soft.assertThat(transition(s.seller(), s.orderId(), nullCode).getResponse().getStatus())
                .as("null 确认码应 400").isEqualTo(400);
        soft.assertThat(codeAttempts(s.orderId())).as("null 不得计数").isZero();

        // 空串与纯空白
        for (String blank : List.of("", "      ")) {
            soft.assertThat(submitCode(s.seller(), s.orderId(), blank).getResponse().getStatus())
                    .as("空白确认码应 400").isEqualTo(400);
        }
        soft.assertThat(codeAttempts(s.orderId())).as("空白不得计数").isZero();

        // 非 6 位数字
        for (String bad : List.of("12345", "1234567", "abcdef", "12 456")) {
            soft.assertThat(submitCode(s.seller(), s.orderId(), bad).getResponse().getStatus())
                    .as("非 6 位数字应 400").isEqualTo(400);
        }
        soft.assertThat(codeAttempts(s.orderId())).as("格式非法不得计数").isZero();

        // 错误的六位数字 —— 唯一应该计数的情况
        soft.assertThat(submitCode(s.seller(), s.orderId(), wrongCodeFor(s.realCode()))
                .getResponse().getStatus()).isBetween(400, 499);
        soft.assertThat(codeAttempts(s.orderId())).as("错误六位数字才计数").isEqualTo(1);

        soft.assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        soft.assertAll();
    }

    // ==================================================================
    // D. 完成与过期并发一致性
    // ==================================================================

    @Test
    @DisplayName("D1. 完成与过期扫描并发时，终态与商品状态、事件保持原子一致")
    void completionAndExpiryAreMutuallyExclusive() throws Exception {
        Scenario s = buyerConfirmed("d1");
        backdateUpdatedAt(s.orderId(), 25);      // 使其同时具备过期资格

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        try {
            // 一半线程尝试用正确码完成，一半线程触发过期扫描
            for (int i = 0; i < threads; i++) {
                boolean complete = i % 2 == 0;
                futures.add(pool.submit(() -> {
                    gate.await();
                    if (complete) submitCode(s.seller(), s.orderId(), s.realCode());
                    else transitions.sweepExpired();
                    return null;
                }));
            }
            gate.countDown();
            for (Future<?> f : futures) f.get(60, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        String finalStatus = orderStatus(s.orderId());
        String finalProduct = productStatus(s.productId());
        long completedEvents = eventCountTo(s.orderId(), "COMPLETED");
        long expiredEvents = eventCountTo(s.orderId(), "EXPIRED");

        assertThat(finalStatus).as("必须落在一个确定终态").isIn("COMPLETED", "EXPIRED");
        if ("COMPLETED".equals(finalStatus)) {
            assertThat(finalProduct).as("完成则商品已售出").isEqualTo("已售出");
            assertThat(completedEvents).isEqualTo(1);
            assertThat(expiredEvents).as("不得同时出现过期事件").isZero();
        } else {
            assertThat(finalProduct).as("过期则商品在售").isEqualTo("在售");
            assertThat(expiredEvents).isEqualTo(1);
            assertThat(completedEvents).as("不得同时出现完成事件").isZero();
        }
    }

    // ==================================================================
    // 场景搭建与辅助
    // ==================================================================

    private record Actor(String id, String token) {}
    private record Scenario(Actor seller, Actor buyer, String productId, String orderId, String realCode) {}

    private Scenario buyerConfirmed(String tag) throws Exception {
        Actor seller = register(tag + "s");
        Actor buyer = register(tag + "b");
        String productId = publishProduct(seller);
        String orderId = createOrder(buyer, productId, pickMeetingPoint(buyer));
        assertThat(transition(seller, orderId, Map.of("to", "PENDING_MEETING"))
                .getResponse().getStatus()).isEqualTo(200);
        // 模块 3：有验货清单的订单，买家须先当面验货并提交，才能确认
        com.lulu.campusmarketbackend.support.InspectionFixtures.submitAllMatch(mockMvc, objectMapper, buyer.token(), orderId);
        assertThat(transition(buyer, orderId, Map.of("to", "BUYER_CONFIRMED"))
                .getResponse().getStatus()).isEqualTo(200);
        assertThat(orderStatus(orderId)).isEqualTo("BUYER_CONFIRMED");
        return new Scenario(seller, buyer, productId, orderId, readRealCode(buyer, orderId));
    }

    /** 把 updated_at 回拨若干小时，模拟订单在该状态停留过久。 */
    private void backdateUpdatedAt(String orderId, int hours) {
        jdbc.update("UPDATE orders SET updated_at = now() - (? * interval '1 hour') WHERE id = ?::uuid",
                hours, orderId);
    }

    private String readRealCode(Actor buyer, String orderId) throws Exception {
        for (JsonNode order : orderList(buyer, "buyer")) {
            if (orderId.equals(order.path("id").asText())) {
                String code = order.path("confirmationCode").asText();
                assertThat(code).matches("\\d{6}");
                return code;
            }
        }
        throw new AssertionError("买家订单列表中未找到该订单");
    }

    private static String wrongCodeFor(String realCode) {
        return "000000".equals(realCode) ? "000001" : "000000";
    }

    private Actor register(String role) throws Exception {
        String account = role.replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", ACCOUNT_PASSWORD);
        body.put("nickname", role);
        body.put("campus", CAMPUS);
        body.put("contact", "13800000000");
        MvcResult result = mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).as("注册 %s", role).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Actor(data.path("user").path("id").asText(), data.path("accessToken").asText());
    }

    private String publishProduct(Actor seller) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "生命周期回归测试商品");
        body.put("description", "由 OrderLifecycleIT 创建，仅存在于一次性容器");
        body.put("price", 42.00);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "几乎全新");
        body.put("campus", CAMPUS);
        body.put("images", List.of("https://example.invalid/test.png"));
        body.put("contact", "13800000001");
        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText();
    }

    private String pickMeetingPoint(Actor actor) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/meeting-points"), actor)).andReturn();
        for (JsonNode point : objectMapper.readTree(result.getResponse().getContentAsString()).path("data")) {
            if (CAMPUS.equals(point.path("campus").asText())) return point.path("id").asText();
        }
        throw new AssertionError("未找到面交点");
    }

    private String createOrder(Actor buyer, String productId, String meetingPointId) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("productId", productId);
        body.put("meetingPointId", meetingPointId);
        body.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).toString());
        body.put("contact", "13800000002");
        MvcResult result = mockMvc.perform(authorized(post("/v1/orders"), buyer)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).as("下单应成功").isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText();
    }

    private MvcResult submitCode(Actor actor, String orderId, String code) throws Exception {
        return transition(actor, orderId, Map.of("to", "COMPLETED", "confirmationCode", code));
    }

    private MvcResult transition(Actor actor, String orderId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(authorized(post("/v1/orders/" + orderId + "/transitions"), actor)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private List<JsonNode> orderList(Actor actor, String role) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/orders").param("role", role), actor)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        List<JsonNode> list = new ArrayList<>();
        objectMapper.readTree(result.getResponse().getContentAsString()).path("data").forEach(list::add);
        return list;
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder b, Actor a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private int codeAttempts(String orderId) {
        Integer v = jdbc.queryForObject("SELECT code_attempts FROM orders WHERE id = ?::uuid", Integer.class, orderId);
        return v == null ? -1 : v;
    }

    private String orderStatus(String orderId) {
        return jdbc.queryForObject("SELECT status FROM orders WHERE id = ?::uuid", String.class, orderId);
    }

    private String productStatus(String productId) {
        return jdbc.queryForObject("SELECT status FROM products WHERE id = ?::uuid", String.class, productId);
    }

    private long eventCountTo(String orderId, String toStatus) {
        Long c = jdbc.queryForObject(
                "SELECT count(*) FROM order_events WHERE order_id = ?::uuid AND to_status = ?",
                Long.class, orderId, toStatus);
        return c == null ? 0 : c;
    }

    private long activeOrderCount(String productId) {
        Long c = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE product_id = ?::uuid "
                        + "AND status NOT IN ('CANCELLED','EXPIRED','COMPLETED')", Long.class, productId);
        return c == null ? 0 : c;
    }
}
