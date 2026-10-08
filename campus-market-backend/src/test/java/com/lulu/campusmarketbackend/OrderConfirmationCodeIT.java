package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * 订单核销确认码的错误次数持久化与锁定测试（R-02）。
 *
 * <p>背景：{@code OrderService.transition()} 曾经在同一个 {@code @Transactional} 方法内
 * 先调用 {@code incrementCodeAttempts} 再抛出继承自 {@code RuntimeException} 的
 * {@code ApiException}，Spring 默认回滚规则把这次计数一并撤销，导致
 * {@code code_attempts} 永远停留在 0、{@code >= 5} 的锁定分支永不可达，
 * 持有合法会话的卖家可以对自己参与的订单无限次爆破 6 位确认码。
 *
 * <p>本类通过真实 HTTP 接口走完
 * {@code PENDING_SELLER_CONFIRM → PENDING_MEETING → BUYER_CONFIRMED} 全链路，
 * 再在真实 PostgreSQL 上逐次核对 {@code orders.code_attempts}。
 * 不 mock 任何 Service / Mapper，不手工塞 SecurityContext，不用 H2 证明事务行为。
 *
 * <p>真实确认码只从买家视图读入测试内存，不打印、不写入断言消息。
 */
@Testcontainers
@SpringBootTest(properties = {
        // FlywayAutoConfiguration 的条件在自动配置选择阶段求值，DynamicPropertySource 对它不生效。
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderConfirmationCodeIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    private static final String TEST_DB = "campus_market_code";
    private static final String TEST_USER = "campus_code";
    private static final String TEST_PASSWORD = "campus_code_only";

    private static final String CAMPUS = "东校区";
    private static final String ACCOUNT_PASSWORD = "test-password-2026";

    /** 与生产 OrderService 保持一致的错误次数上限。 */
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
        registry.add("campus-market.expiry-job-enabled", () -> "false");
        registry.add("campus-market.jwt-secret",
                () -> "order-confirmation-code-it-secret-0123456789");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbc;

    // ==================================================================
    // 1. 五次错误必须逐次持久化
    // ==================================================================

    @Test
    @DisplayName("1. 卖家连续 5 次错误确认码，code_attempts 必须依次持久化为 1..5")
    void wrongCodeAttemptsArePersistedOneByOne() throws Exception {
        Scenario s = readyForConfirmation("persist");
        String wrongCode = wrongCodeFor(s.realCode());

        SoftAssertions soft = new SoftAssertions();

        for (int attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
            MvcResult result = submitCode(s.seller(), s.orderId(), wrongCode);

            soft.assertThat(result.getResponse().getStatus())
                    .as("第 %d 次错误确认码应被拒绝（4xx）", attempt)
                    .isBetween(400, 499);

            soft.assertThat(codeAttempts(s.orderId()))
                    .as("第 %d 次错误后 code_attempts 必须已持久化", attempt)
                    .isEqualTo(attempt);
        }

        soft.assertThat(orderStatus(s.orderId())).as("订单不得完成").isEqualTo("BUYER_CONFIRMED");
        soft.assertThat(productStatus(s.productId())).as("商品不得变为已售出").isEqualTo("预约中");
        soft.assertThat(completedEventCount(s.orderId())).as("不得生成 COMPLETED 事件").isZero();

        soft.assertAll();
    }

    // ==================================================================
    // 2. 第六次被锁定
    // ==================================================================

    @Test
    @DisplayName("2. 第 6 次错误被锁定拒绝，计数仍为 5，状态不变")
    void sixthWrongAttemptIsLockedAndDoesNotIncrement() throws Exception {
        Scenario s = readyForConfirmation("sixth");
        String wrongCode = wrongCodeFor(s.realCode());

        for (int i = 0; i < MAX_CODE_ATTEMPTS; i++) {
            submitCode(s.seller(), s.orderId(), wrongCode);
        }
        assertThat(codeAttempts(s.orderId())).isEqualTo(MAX_CODE_ATTEMPTS);

        MvcResult sixth = submitCode(s.seller(), s.orderId(), wrongCode);

        SoftAssertions soft = new SoftAssertions();
        soft.assertThat(sixth.getResponse().getStatus())
                .as("第 6 次必须被拒绝").isBetween(400, 499);
        soft.assertThat(codeAttempts(s.orderId()))
                .as("锁定后不得继续累加").isEqualTo(MAX_CODE_ATTEMPTS);
        soft.assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        soft.assertThat(productStatus(s.productId())).isEqualTo("预约中");
        soft.assertThat(completedEventCount(s.orderId())).isZero();
        soft.assertAll();
    }

    // ==================================================================
    // 3. 锁定后正确码也必须被拒
    // ==================================================================

    @Test
    @DisplayName("3. 达到上限后，即使提交真实正确的确认码也必须被拒")
    void correctCodeIsRejectedAfterLock() throws Exception {
        Scenario s = readyForConfirmation("locked");
        String wrongCode = wrongCodeFor(s.realCode());

        for (int i = 0; i < MAX_CODE_ATTEMPTS; i++) {
            submitCode(s.seller(), s.orderId(), wrongCode);
        }
        assertThat(codeAttempts(s.orderId())).isEqualTo(MAX_CODE_ATTEMPTS);

        // 提交真实正确码 —— 值只在内存中流转，不出现在任何断言消息里
        MvcResult result = submitCode(s.seller(), s.orderId(), s.realCode());

        SoftAssertions soft = new SoftAssertions();
        soft.assertThat(result.getResponse().getStatus())
                .as("锁定后正确码同样必须被拒绝").isBetween(400, 499);
        soft.assertThat(codeAttempts(s.orderId()))
                .as("正确码被拒不应额外计数").isEqualTo(MAX_CODE_ATTEMPTS);
        soft.assertThat(orderStatus(s.orderId())).as("订单不得完成").isEqualTo("BUYER_CONFIRMED");
        soft.assertThat(productStatus(s.productId())).as("商品不得成交").isEqualTo("预约中");
        soft.assertThat(completedEventCount(s.orderId())).isZero();
        soft.assertAll();
    }

    // ==================================================================
    // 4. 未锁定前正确码可正常完成
    // ==================================================================

    @Test
    @DisplayName("4. 错 4 次之后提交正确码仍能完成订单，且订单/商品/事件原子一致")
    void correctCodeStillCompletesBeforeLock() throws Exception {
        Scenario s = readyForConfirmation("success");
        String wrongCode = wrongCodeFor(s.realCode());

        for (int i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
            submitCode(s.seller(), s.orderId(), wrongCode);
        }
        assertThat(codeAttempts(s.orderId())).isEqualTo(MAX_CODE_ATTEMPTS - 1);

        MvcResult result = submitCode(s.seller(), s.orderId(), s.realCode());

        assertThat(result.getResponse().getStatus()).as("未锁定时正确码应成功").isEqualTo(200);

        JsonNode order = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        assertThat(order.path("canonicalStatus").asText()).isEqualTo("COMPLETED");

        assertThat(orderStatus(s.orderId())).isEqualTo("COMPLETED");
        assertThat(productStatus(s.productId())).as("商品应变为已售出").isEqualTo("已售出");
        assertThat(completedEventCount(s.orderId())).as("COMPLETED 事件恰好 1 条").isEqualTo(1);
        assertThat(codeAttempts(s.orderId()))
                .as("既有错误计数不要求重置（原契约未定义重置）").isEqualTo(MAX_CODE_ATTEMPTS - 1);

        Integer soldAtSet = jdbc.queryForObject(
                "SELECT count(*) FROM products WHERE id = ?::uuid AND sold_at IS NOT NULL",
                Integer.class, s.productId());
        assertThat(soldAtSet).as("成交时间应已写入").isEqualTo(1);
    }

    // ==================================================================
    // 5. 非卖家不得消耗次数
    // ==================================================================

    @Test
    @DisplayName("5. 买家与无关用户提交错误码：无权限/状态冲突，且不消耗次数")
    void nonSellerAttemptsDoNotConsumeCounter() throws Exception {
        Scenario s = readyForConfirmation("nonseller");
        String wrongCode = wrongCodeFor(s.realCode());
        Actor outsider = register("outsider");

        // 买家在 BUYER_CONFIRMED 状态提交 COMPLETED：角色不允许 → 409
        MvcResult byBuyer = submitCode(s.buyer(), s.orderId(), wrongCode);
        assertThat(byBuyer.getResponse().getStatus()).as("买家不得核销").isEqualTo(409);
        assertThat(codeAttempts(s.orderId())).as("买家尝试不得计数").isZero();

        // 无关用户：非订单参与方 → 403
        MvcResult byOutsider = submitCode(outsider, s.orderId(), wrongCode);
        assertThat(byOutsider.getResponse().getStatus()).as("无关用户应无权限").isEqualTo(403);
        assertThat(codeAttempts(s.orderId())).as("无关用户尝试不得计数").isZero();

        assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        assertThat(completedEventCount(s.orderId())).isZero();
    }

    // ==================================================================
    // 6. 错误订单状态不得消耗次数
    // ==================================================================

    @Test
    @DisplayName("6. 在不允许核销的状态（PENDING_SELLER_CONFIRM）提交错误码不得计数")
    void wrongStateAttemptsDoNotConsumeCounter() throws Exception {
        // 只下单，不推进到 BUYER_CONFIRMED
        Actor seller = register("seller");
        Actor buyer = register("buyer");
        String productId = publishProduct(seller);
        String meetingPointId = pickMeetingPoint(buyer);
        String orderId = createOrder(buyer, productId, meetingPointId);

        assertThat(orderStatus(orderId)).isEqualTo("PENDING_SELLER_CONFIRM");

        MvcResult result = submitCode(seller, orderId, "000000");

        assertThat(result.getResponse().getStatus()).as("状态不允许应 409").isEqualTo(409);
        assertThat(codeAttempts(orderId)).as("状态错误不得消耗次数").isZero();
        assertThat(orderStatus(orderId)).isEqualTo("PENDING_SELLER_CONFIRM");
        assertThat(completedEventCount(orderId)).isZero();
    }

    // ==================================================================
    // 7. 并发错误请求最终恰为 5
    // ==================================================================

    @Test
    @DisplayName("7. 10 个并发错误请求，最终 code_attempts 恰为 5，无 5xx、无死锁")
    void concurrentWrongAttemptsNeverExceedLimit() throws Exception {
        Scenario s = readyForConfirmation("concurrent");
        String wrongCode = wrongCodeFor(s.realCode());

        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch startGate = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();

        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    startGate.await();
                    return submitCode(s.seller(), s.orderId(), wrongCode).getResponse().getStatus();
                }));
            }
            startGate.countDown();   // 同时起跑

            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get(60, TimeUnit.SECONDS));
            }

            assertThat(statuses).hasSize(threads);
            assertThat(statuses)
                    .as("并发响应只能是「确认码错误」或「已锁定」对应的 4xx，不得出现 5xx")
                    .allSatisfy(status -> assertThat(status).isBetween(400, 499));
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(codeAttempts(s.orderId()))
                .as("行锁串行化后，最终计数必须恰为上限，绝不大于 5")
                .isEqualTo(MAX_CODE_ATTEMPTS);
        assertThat(orderStatus(s.orderId())).isEqualTo("BUYER_CONFIRMED");
        assertThat(productStatus(s.productId())).isEqualTo("预约中");
        assertThat(completedEventCount(s.orderId())).isZero();
    }

    // ==================================================================
    // 8. 确认码不得泄露给卖家或无关用户
    // ==================================================================

    @Test
    @DisplayName("8. 卖家与无关用户的订单视图均不得包含 confirmationCode")
    void confirmationCodeIsNotLeakedToSellerOrOutsider() throws Exception {
        Scenario s = readyForConfirmation("leak");
        Actor outsider = register("outsider2");

        assertThat(hasConfirmationCode(orderList(s.buyer(), "buyer"), s.orderId()))
                .as("买家应能看到确认码").isTrue();
        assertThat(hasConfirmationCode(orderList(s.seller(), "seller"), s.orderId()))
                .as("卖家不得获得确认码").isFalse();
        assertThat(orderList(outsider, "all")).as("无关用户看不到该订单").isEmpty();

        // 错误响应体也不得回显确认码
        MvcResult wrong = submitCode(s.seller(), s.orderId(), wrongCodeFor(s.realCode()));
        assertThat(wrong.getResponse().getContentAsString())
                .as("错误响应不得回显正确码")
                .doesNotContain(s.realCode())
                .doesNotContain("confirmationCode");
    }

    // ==================================================================
    // 9. 回滚语义：除错误计数外，其他失败路径不得提交任何变更
    // ==================================================================

    @Test
    @DisplayName("9. 非法 action / 无权限 / 状态冲突均不得提交订单、商品或事件变更")
    void otherFailurePathsStillRollBackCompletely() throws Exception {
        Scenario s = readyForConfirmation("rollback");
        Actor outsider = register("outsider3");

        String orderStatusBefore = orderStatus(s.orderId());
        String productStatusBefore = productStatus(s.productId());
        long eventsBefore = eventCount(s.orderId());
        int attemptsBefore = codeAttempts(s.orderId());

        // (a) 非法 action
        assertThat(transition(s.seller(), s.orderId(), Map.of("to", "NOT_A_STATE"))
                .getResponse().getStatus()).isEqualTo(400);

        // (b) 非参与方
        assertThat(transition(outsider, s.orderId(), Map.of("to", "COMPLETED", "confirmationCode", "000000"))
                .getResponse().getStatus()).isEqualTo(403);

        // (c) 状态不允许：BUYER_CONFIRMED 不可再转 PENDING_MEETING
        assertThat(transition(s.seller(), s.orderId(), Map.of("to", "PENDING_MEETING"))
                .getResponse().getStatus()).isEqualTo(409);

        // (d) 0.7A 起买家可从 BUYER_CONFIRMED 取消，但必须带非空 reason；缺 reason 是 400 失败路径
        assertThat(transition(s.buyer(), s.orderId(), Map.of("to", "CANCELLED"))
                .getResponse().getStatus()).isEqualTo(400);

        // (e) 确认码格式非法
        assertThat(transition(s.seller(), s.orderId(), Map.of("to", "COMPLETED", "confirmationCode", "abc"))
                .getResponse().getStatus()).isEqualTo(400);

        SoftAssertions soft = new SoftAssertions();
        soft.assertThat(orderStatus(s.orderId())).as("订单状态不得变化").isEqualTo(orderStatusBefore);
        soft.assertThat(productStatus(s.productId())).as("商品状态不得变化").isEqualTo(productStatusBefore);
        soft.assertThat(eventCount(s.orderId())).as("不得新增任何 order_event").isEqualTo(eventsBefore);
        soft.assertThat(codeAttempts(s.orderId()))
                .as("以上路径都不是「错误确认码」，不得消耗次数").isEqualTo(attemptsBefore);
        soft.assertAll();
    }

    // ==================================================================
    // 场景搭建：走完真实 HTTP 链路直到可提交确认码
    // ==================================================================

    private record Actor(String id, String token) {}

    private record Scenario(Actor seller, Actor buyer, String productId, String orderId, String realCode) {}

    /** 注册双方、发布商品、下单并推进到 BUYER_CONFIRMED，返回买家可见的真实确认码。 */
    private Scenario readyForConfirmation(String tag) throws Exception {
        Actor seller = register(tag + "-seller");
        Actor buyer = register(tag + "-buyer");
        String productId = publishProduct(seller);
        String meetingPointId = pickMeetingPoint(buyer);
        String orderId = createOrder(buyer, productId, meetingPointId);

        assertThat(transition(seller, orderId, Map.of("to", "PENDING_MEETING"))
                .getResponse().getStatus()).as("卖家接单").isEqualTo(200);
        // 模块 3：有验货清单的订单，买家须先当面验货并提交，才能确认
        com.lulu.campusmarketbackend.support.InspectionFixtures.submitAllMatch(mockMvc, objectMapper, buyer.token(), orderId);
        assertThat(transition(buyer, orderId, Map.of("to", "BUYER_CONFIRMED"))
                .getResponse().getStatus()).as("买家确认").isEqualTo(200);
        assertThat(orderStatus(orderId)).isEqualTo("BUYER_CONFIRMED");
        assertThat(codeAttempts(orderId)).as("初始 code_attempts 必须为 0").isZero();

        return new Scenario(seller, buyer, productId, orderId, readRealCode(buyer, orderId));
    }

    /** 真实确认码只从买家的合法投影读取，仅保存在测试内存。 */
    private String readRealCode(Actor buyer, String orderId) throws Exception {
        for (JsonNode order : orderList(buyer, "buyer")) {
            if (orderId.equals(order.path("id").asText())) {
                String code = order.path("confirmationCode").asText();
                assertThat(code).as("买家应能读到确认码").matches("\\d{6}");
                return code;
            }
        }
        throw new AssertionError("买家订单列表中未找到该订单");
    }

    /** 保证与真实码不同的错误码。不暴露真实码内容。 */
    private static String wrongCodeFor(String realCode) {
        return "000000".equals(realCode) ? "000001" : "000000";
    }

    // ==================================================================
    // HTTP 辅助
    // ==================================================================

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
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        assertThat(result.getResponse().getStatus()).as("注册 %s", role).isEqualTo(200);

        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Actor(data.path("user").path("id").asText(), data.path("accessToken").asText());
    }

    private String publishProduct(Actor seller) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "核销码回归测试商品");
        body.put("description", "由 OrderConfirmationCodeIT 创建，仅存在于一次性容器");
        body.put("price", 55.00);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "几乎全新");
        body.put("campus", CAMPUS);
        body.put("images", List.of("https://example.invalid/test.png"));
        body.put("contact", "13800000001");

        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("id").asText();
    }

    private String pickMeetingPoint(Actor actor) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/meeting-points"), actor)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        for (JsonNode point : objectMapper.readTree(result.getResponse().getContentAsString()).path("data")) {
            if (CAMPUS.equals(point.path("campus").asText())) return point.path("id").asText();
        }
        throw new AssertionError("未找到校区 " + CAMPUS + " 的面交点");
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
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        assertThat(result.getResponse().getStatus()).as("下单应成功").isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("id").asText();
    }

    private MvcResult submitCode(Actor actor, String orderId, String code) throws Exception {
        return transition(actor, orderId, Map.of("to", "COMPLETED", "confirmationCode", code));
    }

    private MvcResult transition(Actor actor, String orderId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(authorized(post("/v1/orders/" + orderId + "/transitions"), actor)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
    }

    private List<JsonNode> orderList(Actor actor, String role) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/orders").param("role", role), actor))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        List<JsonNode> list = new ArrayList<>();
        objectMapper.readTree(result.getResponse().getContentAsString()).path("data").forEach(list::add);
        return list;
    }

    private static boolean hasConfirmationCode(List<JsonNode> orders, String orderId) {
        for (JsonNode order : orders) {
            if (orderId.equals(order.path("id").asText())) return order.hasNonNull("confirmationCode");
        }
        return false;
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder builder, Actor actor) {
        return builder.header("Authorization", "Bearer " + actor.token());
    }

    // ==================================================================
    // 数据库断言辅助
    // ==================================================================

    private int codeAttempts(String orderId) {
        Integer value = jdbc.queryForObject(
                "SELECT code_attempts FROM orders WHERE id = ?::uuid", Integer.class, orderId);
        return value == null ? -1 : value;
    }

    private String orderStatus(String orderId) {
        return jdbc.queryForObject("SELECT status FROM orders WHERE id = ?::uuid", String.class, orderId);
    }

    private String productStatus(String productId) {
        return jdbc.queryForObject("SELECT status FROM products WHERE id = ?::uuid", String.class, productId);
    }

    private long completedEventCount(String orderId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM order_events WHERE order_id = ?::uuid AND to_status = 'COMPLETED'",
                Long.class, orderId);
        return count == null ? 0 : count;
    }

    private long eventCount(String orderId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM order_events WHERE order_id = ?::uuid", Long.class, orderId);
        return count == null ? 0 : count;
    }
}
