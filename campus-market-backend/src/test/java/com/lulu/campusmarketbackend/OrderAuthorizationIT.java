package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
// Spring Boot 4 把 webmvc 的测试自动配置迁到了 org.springframework.boot.webmvc.test.autoconfigure
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 订单创建接口的身份授权回归测试（R-01）。
 *
 * <p>背景：{@code OrderService.create()} 曾经用
 * {@code body.getOrDefault("__buyerId", uid)} 取买家身份，使得任意已登录用户
 * 都能在请求体里塞一个 {@code __buyerId} 冒用他人身份下单，把商品锁成「预约中」
 * 并在受害者名下生成订单。本类从真实 HTTP 边界验证该越权已被封堵。
 *
 * <p>本测试刻意<b>不</b>伪造认证上下文：三名用户全部通过
 * {@code POST /v1/auth/register} 真实注册，从响应 envelope 中取出真实
 * Access Token 与用户 id，后续请求一律携带 {@code Authorization: Bearer}，
 * 服务端会照常校验 JWT 签名并回查 sessions 表。用 Mock 认证绕开这条链路
 * 就无法证明真实攻击面。
 *
 * <p>全部数据都在一次性 PostgreSQL 16 Testcontainer 中，不触碰任何本地或生产数据库。
 * 测试不打印密码、Token 或确认码的实际值。
 */
@Testcontainers
@SpringBootTest(properties = {
        // FlywayAutoConfiguration 的 @ConditionalOnProperty 在自动配置选择阶段求值，
        // @DynamicPropertySource 对它不生效，必须用内联属性覆盖
        // application-test.yaml 中的 spring.flyway.enabled=false。
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderAuthorizationIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    /** 仅本次一次性容器使用的测试凭据。 */
    private static final String TEST_DB = "campus_market_authz";
    private static final String TEST_USER = "campus_authz";
    private static final String TEST_PASSWORD = "campus_authz_only";

    /** 三名用户与商品统一使用同一校区，确保通过同校与面交点校区校验。 */
    private static final String CAMPUS = "东校区";

    /** 注册接口要求密码 8-72 位；仅测试使用。 */
    private static final String ACCOUNT_PASSWORD = "test-password-2026";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName(TEST_DB)
            .withUsername(TEST_USER)
            .withPassword(TEST_PASSWORD);

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        // application-test.yaml 把 driver 硬编码成 org.h2.Driver，必须覆盖回 PostgreSQL。
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        // 关闭订单超时释放，避免定时任务干扰断言。
        registry.add("campus-market.expiry-job-enabled", () -> "false");
        registry.add("campus-market.jwt-secret",
                () -> "order-authorization-it-only-jwt-secret-0123456789");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbc;

    // ==================================================================
    // 测试 1：伪造 __buyerId 必须被拒绝
    // ==================================================================

    @Test
    @DisplayName("1. 请求体携带 __buyerId 冒用他人身份下单必须被拒绝，且不产生任何副作用")
    void forgedBuyerIdIsRejectedAndCreatesNoOrder() throws Exception {
        Actor seller = register("seller");
        Actor attacker = register("attacker");
        Actor victim = register("victim");

        String productId = publishProduct(seller);
        String meetingPointId = pickMeetingPointFor(CAMPUS, attacker);

        long victimOrdersBefore = orderCountForBuyer(victim.id());
        long attackerOrdersBefore = orderCountForBuyer(attacker.id());
        long orderEventsBefore = countOf("order_events");

        Map<String, Object> body = orderBody(productId, meetingPointId);
        body.put("__buyerId", victim.id());   // ← 攻击载荷

        MvcResult result = mockMvc.perform(authorized(post("/v1/orders"), attacker)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();

        int status = result.getResponse().getStatus();
        String responseBody = result.getResponse().getContentAsString();
        JsonNode envelope = objectMapper.readTree(responseBody);

        // 用软断言：漏洞回归测试要一次性暴露全部副作用，而不是在第一条断言就中止。
        // 修复前这里会同时报出「HTTP 200」「受害者名下多出订单」「商品被锁成预约中」等多项失败。
        SoftAssertions soft = new SoftAssertions();

        soft.assertThat(status).as("冒用身份的下单请求必须返回 400").isEqualTo(400);
        soft.assertThat(envelope.path("code").asInt()).as("envelope.code 应为 400").isEqualTo(400);
        soft.assertThat(envelope.path("data").isNull() || envelope.path("data").isMissingNode())
                .as("不得返回订单数据").isTrue();
        soft.assertThat(responseBody)
                .as("错误响应不得泄露确认码").doesNotContain("confirmationCode");

        // 数据库侧：没有任何订单被创建
        soft.assertThat(orderCountForBuyer(victim.id()))
                .as("受害者名下不得凭空出现订单").isEqualTo(victimOrdersBefore);
        soft.assertThat(orderCountForBuyer(attacker.id()))
                .as("攻击者名下也不得产生订单").isEqualTo(attackerOrdersBefore);
        soft.assertThat(orderCountForProduct(productId)).as("该商品不得产生订单").isZero();

        // 商品状态未被锁定
        soft.assertThat(productStatus(productId)).as("商品应仍为在售").isEqualTo("在售");

        // 没有状态流水
        soft.assertThat(countOf("order_events"))
                .as("被拒绝的请求不得写入 order_events").isEqualTo(orderEventsBefore);

        soft.assertAll();
    }

    // ==================================================================
    // 测试 2：任意未知字段必须被拒绝
    // ==================================================================

    @Test
    @DisplayName("2. 任意未知字段同样返回 400，证明是字段白名单而非针对 __buyerId 的补丁")
    void unknownOrderFieldIsRejected() throws Exception {
        Actor seller = register("seller");
        Actor attacker = register("attacker");

        String productId = publishProduct(seller);
        String meetingPointId = pickMeetingPointFor(CAMPUS, attacker);
        long orderEventsBefore = countOf("order_events");

        Map<String, Object> body = orderBody(productId, meetingPointId);
        body.put("unexpectedField", "unexpected");

        MvcResult result = mockMvc.perform(authorized(post("/v1/orders"), attacker)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();

        JsonNode envelope = objectMapper.readTree(result.getResponse().getContentAsString());

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(envelope.path("code").asInt()).isEqualTo(400);

        assertThat(orderCountForProduct(productId)).as("不得创建订单").isZero();
        assertThat(productStatus(productId)).as("商品状态不得改变").isEqualTo("在售");
        assertThat(countOf("order_events")).isEqualTo(orderEventsBefore);
    }

    // ==================================================================
    // 测试 3：合法请求必须绑定认证买家，且确认码仅买家可见
    // ==================================================================

    @Test
    @DisplayName("3. 合法请求以认证用户为买家，确认码仅买家可见，幂等键重复返回同一订单")
    void validOrderUsesAuthenticatedUserAsBuyer() throws Exception {
        Actor seller = register("seller");
        Actor attacker = register("attacker");   // 此处作为正常买家
        Actor victim = register("victim");       // 无关第三方

        String productId = publishProduct(seller);
        String meetingPointId = pickMeetingPointFor(CAMPUS, attacker);

        Map<String, Object> body = orderBody(productId, meetingPointId);
        String idempotencyKey = UUID.randomUUID().toString();
        String payload = objectMapper.writeValueAsString(body);

        MvcResult result = mockMvc.perform(authorized(post("/v1/orders"), attacker)
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andReturn();

        assertThat(result.getResponse().getStatus())
                .as("合法预约应成功").isEqualTo(200);

        JsonNode order = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        String orderId = order.path("id").asText();

        assertThat(order.path("buyerId").asText())
                .as("买家必须是认证用户").isEqualTo(attacker.id());
        assertThat(order.path("buyerId").asText())
                .as("买家绝不能是无关的第三方").isNotEqualTo(victim.id());
        assertThat(order.path("sellerId").asText())
                .as("卖家应为商品真实卖家").isEqualTo(seller.id());

        // 数据库侧证据
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT buyer_id, seller_id, status FROM orders WHERE id = ?::uuid", orderId);
        assertThat(row.get("buyer_id").toString()).isEqualTo(attacker.id());
        assertThat(row.get("seller_id").toString()).isEqualTo(seller.id());
        assertThat(row.get("status")).isEqualTo("PENDING_SELLER_CONFIRM");

        // 商品进入预约状态，且只有一个活跃订单
        assertThat(productStatus(productId)).isEqualTo("预约中");
        assertThat(activeOrderCount(productId)).as("同一商品只能有一个活跃订单").isEqualTo(1);

        // 创建事件已写入
        Integer createEvents = jdbc.queryForObject(
                "SELECT count(*) FROM order_events WHERE order_id = ?::uuid "
                        + "AND from_status IS NULL AND to_status = 'PENDING_SELLER_CONFIRM'",
                Integer.class, orderId);
        assertThat(createEvents).as("应写入一条创建事件").isEqualTo(1);

        // ---- 确认码可见性 ----
        assertThat(hasConfirmationCode(orderList(attacker, "buyer"), orderId))
                .as("买家应能看到确认码").isTrue();
        assertThat(hasConfirmationCode(orderList(seller, "seller"), orderId))
                .as("卖家不得获得确认码").isFalse();
        assertThat(orderList(victim, "all").size())
                .as("无关用户不应看到任何订单").isZero();

        // ---- 幂等回归：同一 key + 完全相同请求体应返回同一订单 ----
        MvcResult repeat = mockMvc.perform(authorized(post("/v1/orders"), attacker)
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andReturn();

        assertThat(repeat.getResponse().getStatus()).isEqualTo(200);
        JsonNode repeated = objectMapper.readTree(repeat.getResponse().getContentAsString()).path("data");
        assertThat(repeated.path("id").asText()).as("重复请求应返回同一订单").isEqualTo(orderId);

        assertThat(orderCountForProduct(productId)).as("数据库只应有一条订单").isEqualTo(1);
        assertThat(createEventCount(orderId)).as("不得重复生成创建事件").isEqualTo(1);
    }

    @Test
    @DisplayName("订单返回同一商品和买卖双方的会话；尚无会话时仍返回订单")
    void orderResponseIncludesOnlyItsParticipantsConversation() throws Exception {
        Actor seller = register("seller");
        Actor buyer = register("buyer");
        Actor otherBuyer = register("otherBuyer");
        String productId = publishProduct(seller);
        Map<String, Object> body = orderBody(productId, pickMeetingPointFor(CAMPUS, buyer));

        MvcResult result = mockMvc.perform(authorized(post("/v1/orders"), buyer)
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode order = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        assertThat(order.has("conversationId")).isTrue();
        assertThat(order.path("conversationId").isNull()).isTrue();

        jdbc.update("INSERT INTO conversations(id, product_id, buyer_id, seller_id) VALUES (?, ?::uuid, ?::uuid, ?::uuid)",
                UUID.randomUUID(), productId, otherBuyer.id(), seller.id());
        assertThat(orderList(buyer, "buyer")).singleElement()
                .satisfies(item -> assertThat(item.path("conversationId").isNull()).isTrue());

        UUID conversationId = UUID.randomUUID();
        jdbc.update("INSERT INTO conversations(id, product_id, buyer_id, seller_id) VALUES (?, ?::uuid, ?::uuid, ?::uuid)",
                conversationId, productId, buyer.id(), seller.id());
        for (Actor actor : List.of(buyer, seller)) {
            assertThat(orderList(actor, "all")).singleElement()
                    .satisfies(item -> assertThat(item.path("conversationId").asText()).isEqualTo(conversationId.toString()));
        }
        MvcResult repeat = mockMvc.perform(authorized(post("/v1/orders"), buyer)
                        .header("Idempotency-Key", result.getRequest().getHeader("Idempotency-Key"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        assertThat(repeat.getResponse().getStatus()).isEqualTo(200);
        assertThat(objectMapper.readTree(repeat.getResponse().getContentAsString()).path("data").path("conversationId").asText())
                .isEqualTo(conversationId.toString());
    }

    // ==================================================================
    // HTTP 辅助：全部走真实接口，字段以当前源码要求为准
    // ==================================================================

    /** 注册后持有的真实身份，token 不落日志。 */
    private record Actor(String id, String token) {}

    private Actor register(String role) throws Exception {
        // account 需匹配 [\w@.+-]+，UUID 去掉横线后拼接，保证每个测试用例账号唯一
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

        assertThat(result.getResponse().getStatus())
                .as("注册 %s 应成功", role).isEqualTo(200);

        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        String token = data.path("accessToken").asText();
        String id = data.path("user").path("id").asText();
        assertThat(token).isNotBlank();
        assertThat(id).isNotBlank();
        return new Actor(id, token);
    }

    private String publishProduct(Actor seller) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "授权回归测试商品");
        body.put("description", "由 OrderAuthorizationIT 创建，仅存在于一次性容器");
        body.put("price", 88.00);
        body.put("category", "数码电子");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("数码电子"));
        body.put("condition", "几乎全新");
        body.put("campus", CAMPUS);
        body.put("images", List.of("https://example.invalid/test.png"));
        body.put("contact", "13800000001");

        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();

        assertThat(result.getResponse().getStatus()).as("发布商品应成功").isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        String id = data.path("id").asText();
        assertThat(id).isNotBlank();
        assertThat(data.path("status").asText()).isEqualTo("在售");
        return id;
    }

    /** 从真实接口读取与商品校区匹配的面交点，不硬编码未经验证的 ID。 */
    private String pickMeetingPointFor(String campus, Actor actor) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/meeting-points"), actor)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);

        JsonNode points = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        for (JsonNode point : points) {
            if (campus.equals(point.path("campus").asText())) {
                return point.path("id").asText();
            }
        }
        throw new AssertionError("未找到校区 " + campus + " 的面交点");
    }

    /** 只包含合法业务字段的订单请求体；身份字段一律不出现。 */
    private Map<String, Object> orderBody(String productId, String meetingPointId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("productId", productId);
        body.put("meetingPointId", meetingPointId);
        body.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).toString());
        body.put("contact", "13800000002");
        return body;
    }

    private List<JsonNode> orderList(Actor actor, String role) throws Exception {
        MvcResult result = mockMvc.perform(authorized(get("/v1/orders").param("role", role), actor))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        java.util.ArrayList<JsonNode> list = new java.util.ArrayList<>();
        data.forEach(list::add);
        return list;
    }

    /** 只判断字段是否存在，不读取也不输出确认码的值。 */
    private static boolean hasConfirmationCode(List<JsonNode> orders, String orderId) {
        for (JsonNode order : orders) {
            if (orderId.equals(order.path("id").asText())) {
                return order.hasNonNull("confirmationCode");
            }
        }
        return false;
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder builder, Actor actor) {
        return builder.header("Authorization", "Bearer " + actor.token());
    }

    // ==================================================================
    // 数据库断言辅助
    // ==================================================================

    private long orderCountForBuyer(String buyerId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE buyer_id = ?::uuid", Long.class, buyerId);
        return count == null ? 0 : count;
    }

    private long orderCountForProduct(String productId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE product_id = ?::uuid", Long.class, productId);
        return count == null ? 0 : count;
    }

    private long activeOrderCount(String productId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE product_id = ?::uuid "
                        + "AND status NOT IN ('CANCELLED','EXPIRED','COMPLETED')", Long.class, productId);
        return count == null ? 0 : count;
    }

    private long createEventCount(String orderId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM order_events WHERE order_id = ?::uuid "
                        + "AND from_status IS NULL AND to_status = 'PENDING_SELLER_CONFIRM'",
                Long.class, orderId);
        return count == null ? 0 : count;
    }

    private String productStatus(String productId) {
        return jdbc.queryForObject(
                "SELECT status FROM products WHERE id = ?::uuid", String.class, productId);
    }

    private long countOf(String table) {
        Long count = jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
        return count == null ? 0 : count;
    }
}
