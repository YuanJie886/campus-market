package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 所有 Map JSON 写接口的未知字段白名单测试（0.8C）。
 *
 * <p>核心断言：未知字段必须在<b>任何副作用之前</b>被拒——不落库、不改状态、不写事件。
 * 这样身份与状态字段（userId / buyerId / sellerId / senderId / status / createdAt /
 * codeAttempts …）天然无法覆盖服务端从认证推导出的身份，不必逐个维护黑名单。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UnknownFieldRejectionIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String CAMPUS = "东校区";
    private static final String PASSWORD = "test-password-2026";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_fields")
            .withUsername("campus_fields").withPassword("campus_fields_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "unknown-field-it-secret-0123456789abc");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;

    // ==================================================================

    @Test
    @DisplayName("1. 注册携带 role/admin → 400，用户不创建")
    void registerRejectsUnknownFields() throws Exception {
        String account = unique("reg");
        Map<String, Object> body = registerBody(account);
        body.put("role", "admin");

        MvcResult result = mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();

        assertBadRequest(result, "role");
        assertThat(countUsers(account)).as("用户不得被创建").isZero();
    }

    @Test
    @DisplayName("2. 登录携带 userId → 400，不创建 session")
    void loginRejectsUnknownFields() throws Exception {
        String account = unique("login");
        register(account);
        long sessionsBefore = countAll("sessions");

        MvcResult result = mockMvc.perform(post("/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("account", account, "password", PASSWORD, "userId", UUID.randomUUID().toString()))))
                .andReturn();

        assertBadRequest(result, "userId");
        assertThat(countAll("sessions")).as("不得创建会话").isEqualTo(sessionsBefore);
    }

    @Test
    @DisplayName("3. 商品创建携带 sellerId/status → 400，商品不创建")
    void productCreateRejectsUnknownFields() throws Exception {
        Actor seller = registerActor("pcreate");
        long before = countAll("products");

        Map<String, Object> body = productBody();
        body.put("sellerId", UUID.randomUUID().toString());
        body.put("status", "已售出");

        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(countAll("products")).as("商品不得被创建").isEqualTo(before);
    }

    @Test
    @DisplayName("4. 商品更新与状态流转携带 sellerId/status → 400，商品不变")
    void productUpdateRejectsUnknownFields() throws Exception {
        Actor seller = registerActor("pupdate");
        String productId = publishProduct(seller);
        String statusBefore = productStatus(productId);
        String titleBefore = productTitle(productId);

        // PATCH 携带 sellerId
        MvcResult patched = mockMvc.perform(authorized(patch("/v1/products/" + productId), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("title", "改名", "sellerId", UUID.randomUUID().toString())))).andReturn();
        assertBadRequest(patched, "sellerId");

        // 状态流转携带额外字段（改造前该路径跳过白名单）
        MvcResult statusResult = mockMvc.perform(authorized(post("/v1/products/" + productId + "/status"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("status", "已下架", "soldAt", "2020-01-01T00:00:00Z")))).andReturn();
        assertBadRequest(statusResult, "soldAt");

        assertThat(productStatus(productId)).as("商品状态不得改变").isEqualTo(statusBefore);
        assertThat(productTitle(productId)).as("商品标题不得改变").isEqualTo(titleBefore);
    }

    @Test
    @DisplayName("5. 订单 transition 携带 buyerId/codeAttempts → 400，状态与计数不变")
    void transitionRejectsUnknownFields() throws Exception {
        Ordered ordered = buyerConfirmedOrder("tr");
        String statusBefore = orderStatus(ordered.orderId());
        int attemptsBefore = codeAttempts(ordered.orderId());
        long eventsBefore = countEvents(ordered.orderId());

        MvcResult result = mockMvc.perform(
                authorized(post("/v1/orders/" + ordered.orderId() + "/transitions"), ordered.seller())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "to", "COMPLETED", "confirmationCode", "000000",
                                "buyerId", UUID.randomUUID().toString(), "codeAttempts", 0))))
                .andReturn();

        assertBadRequest(result, "buyerId");
        assertThat(orderStatus(ordered.orderId())).isEqualTo(statusBefore);
        assertThat(codeAttempts(ordered.orderId())).as("不得消耗确认码次数").isEqualTo(attemptsBefore);
        assertThat(countEvents(ordered.orderId())).isEqualTo(eventsBefore);
    }

    @Test
    @DisplayName("6. 会话创建携带 buyerId/sellerId → 400，不创建会话")
    void conversationRejectsUnknownFields() throws Exception {
        Actor seller = registerActor("conv-s");
        Actor buyer = registerActor("conv-b");
        String productId = publishProduct(seller);
        long before = countAll("conversations");

        MvcResult result = mockMvc.perform(authorized(post("/v1/conversations"), buyer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "productId", productId,
                        "buyerId", UUID.randomUUID().toString(),
                        "sellerId", UUID.randomUUID().toString())))).andReturn();

        assertBadRequest(result, "buyerId");
        assertThat(countAll("conversations")).as("不得创建会话").isEqualTo(before);
    }

    @Test
    @DisplayName("7. 消息发送携带 senderId → 400，不创建消息")
    void messageRejectsUnknownFields() throws Exception {
        Actor seller = registerActor("msg-s");
        Actor buyer = registerActor("msg-b");
        String productId = publishProduct(seller);
        String conversationId = createConversation(buyer, productId);
        long before = countAll("messages");

        MvcResult result = mockMvc.perform(
                authorized(post("/v1/conversations/" + conversationId + "/messages"), buyer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("content", "你好", "senderId", UUID.randomUUID().toString()))))
                .andReturn();

        assertBadRequest(result, "senderId");
        assertThat(countAll("messages")).as("不得创建消息").isEqualTo(before);
    }

    @Test
    @DisplayName("8. 留言携带 userId/createdAt → 400，不创建留言")
    void commentRejectsUnknownFields() throws Exception {
        Actor seller = registerActor("cmt-s");
        Actor buyer = registerActor("cmt-b");
        String productId = publishProduct(seller);
        long before = countAll("comments");

        MvcResult result = mockMvc.perform(
                authorized(post("/v1/products/" + productId + "/comments"), buyer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "content", "还在吗",
                                "userId", UUID.randomUUID().toString(),
                                "createdAt", 0))))
                .andReturn();

        assertBadRequest(result, "createdAt");
        assertThat(countAll("comments")).as("不得创建留言").isEqualTo(before);
    }

    @Test
    @DisplayName("9. 评价携带 reviewerId/status → 400，不创建评价")
    void reviewRejectsUnknownFields() throws Exception {
        Ordered ordered = buyerConfirmedOrder("rv");
        long before = countAll("reviews");

        MvcResult result = mockMvc.perform(
                authorized(post("/v1/orders/" + ordered.orderId() + "/reviews"), ordered.buyer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "rating", 5, "comment", "很好",
                                "reviewerId", UUID.randomUUID().toString(),
                                "status", "COMPLETED"))))
                .andReturn();

        assertBadRequest(result, "reviewerId");
        assertThat(countAll("reviews")).as("不得创建评价").isEqualTo(before);
    }

    @Test
    @DisplayName("10. Profile 携带 role/id → 400，资料不变")
    void profileRejectsUnknownFields() throws Exception {
        Actor actor = registerActor("profile");
        String nicknameBefore = nicknameOf(actor.id());

        MvcResult result = mockMvc.perform(authorized(patch("/v1/auth/me"), actor)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "nickname", "新名字", "role", "admin", "id", UUID.randomUUID().toString()))))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(nicknameOf(actor.id())).as("资料不得改变").isEqualTo(nicknameBefore);
    }

    @Test
    @DisplayName("11. 错误信息按字段名排序且不回显字段值")
    void errorMessageIsStableAndDoesNotEchoValues() throws Exception {
        Actor actor = registerActor("stable");
        String secretValue = "super-secret-value-should-not-appear";

        MvcResult result = mockMvc.perform(authorized(post("/v1/orders/" + UUID.randomUUID() + "/transitions"), actor)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "to", "CANCELLED", "zebra", secretValue, "alpha", secretValue))))
                .andReturn();

        String message = objectMapper.readTree(result.getResponse().getContentAsString())
                .path("message").asText();
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(message).as("字段名应按字典序稳定输出").contains("alpha、zebra");
        assertThat(message).as("绝不回显字段值").doesNotContain(secretValue);
    }

    @Test
    @DisplayName("12. 合法请求继续成功，未因白名单退化")
    void legitimateRequestsStillSucceed() throws Exception {
        Actor seller = registerActor("ok-s");
        Actor buyer = registerActor("ok-b");
        String productId = publishProduct(seller);

        assertThat(mockMvc.perform(authorized(patch("/v1/auth/me"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("nickname", "合法改名"))))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        String conversationId = createConversation(buyer, productId);
        assertThat(mockMvc.perform(authorized(post("/v1/conversations/" + conversationId + "/messages"), buyer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("content", "在吗"))))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        assertThat(mockMvc.perform(authorized(post("/v1/products/" + productId + "/comments"), buyer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("content", "求出"))))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        assertThat(mockMvc.perform(authorized(post("/v1/products/" + productId + "/status"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("status", "已下架"))))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    private record Actor(String id, String token) {}
    private record Ordered(Actor seller, Actor buyer, String orderId) {}

    private void assertBadRequest(MvcResult result, String expectedFieldInMessage) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        JsonNode envelope = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(envelope.path("code").asInt()).isEqualTo(400);
        assertThat(envelope.path("message").asText()).contains(expectedFieldInMessage);
        assertThat(envelope.path("requestId").asText()).as("400 也带 requestId").isNotBlank();
    }

    private static String unique(String prefix) {
        return prefix.replace("-", "") + UUID.randomUUID().toString().replace("-", "");
    }

    private Map<String, Object> registerBody(String account) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", PASSWORD);
        body.put("nickname", "字段白名单");
        body.put("campus", CAMPUS);
        body.put("contact", "13800000000");
        return body;
    }

    private Map<String, Object> productBody() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "白名单测试商品");
        body.put("description", "由 UnknownFieldRejectionIT 创建");
        body.put("price", 30.00);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "全新");
        body.put("campus", CAMPUS);
        body.put("images", List.of("https://example.invalid/a.png"));
        body.put("contact", "13800000001");
        return body;
    }

    private void register(String account) throws Exception {
        assertThat(mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(registerBody(account))))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    private Actor registerActor(String prefix) throws Exception {
        String account = unique(prefix);
        MvcResult result = mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(registerBody(account)))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Actor(data.path("user").path("id").asText(), data.path("accessToken").asText());
    }

    private String publishProduct(Actor seller) throws Exception {
        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(productBody()))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText();
    }

    private String createConversation(Actor buyer, String productId) throws Exception {
        MvcResult result = mockMvc.perform(authorized(post("/v1/conversations"), buyer)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("productId", productId)))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText();
    }

    private Ordered buyerConfirmedOrder(String prefix) throws Exception {
        Actor seller = registerActor(prefix + "s");
        Actor buyer = registerActor(prefix + "b");
        String productId = publishProduct(seller);

        MvcResult points = mockMvc.perform(authorized(get("/v1/meeting-points"), buyer)).andReturn();
        String meetingPointId = null;
        for (JsonNode p : objectMapper.readTree(points.getResponse().getContentAsString()).path("data")) {
            if (CAMPUS.equals(p.path("campus").asText())) { meetingPointId = p.path("id").asText(); break; }
        }

        Map<String, Object> orderBody = new LinkedHashMap<>();
        orderBody.put("productId", productId);
        orderBody.put("meetingPointId", meetingPointId);
        orderBody.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).toString());
        orderBody.put("contact", "13800000002");
        MvcResult created = mockMvc.perform(authorized(post("/v1/orders"), buyer)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(orderBody))).andReturn();
        assertThat(created.getResponse().getStatus()).isEqualTo(200);
        String orderId = objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText();

        transition(seller, orderId, Map.of("to", "PENDING_MEETING"));
        // 模块 3：有验货清单的订单，买家须先当面验货并提交，才能确认
        com.lulu.campusmarketbackend.support.InspectionFixtures.submitAllMatch(mockMvc, objectMapper, buyer.token(), orderId);
        transition(buyer, orderId, Map.of("to", "BUYER_CONFIRMED"));
        return new Ordered(seller, buyer, orderId);
    }

    private void transition(Actor actor, String orderId, Map<String, Object> body) throws Exception {
        assertThat(mockMvc.perform(authorized(post("/v1/orders/" + orderId + "/transitions"), actor)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder b, Actor a) {
        return b.header("Authorization", "Bearer " + a.token());
    }

    private long countAll(String table) {
        Long c = jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
        return c == null ? 0 : c;
    }

    private long countUsers(String account) {
        Long c = jdbc.queryForObject("SELECT count(*) FROM users WHERE account = ?", Long.class, account);
        return c == null ? 0 : c;
    }

    private long countEvents(String orderId) {
        Long c = jdbc.queryForObject("SELECT count(*) FROM order_events WHERE order_id = ?::uuid",
                Long.class, orderId);
        return c == null ? 0 : c;
    }

    private String orderStatus(String orderId) {
        return jdbc.queryForObject("SELECT status FROM orders WHERE id = ?::uuid", String.class, orderId);
    }

    private int codeAttempts(String orderId) {
        Integer v = jdbc.queryForObject("SELECT code_attempts FROM orders WHERE id = ?::uuid",
                Integer.class, orderId);
        return v == null ? -1 : v;
    }

    private String productStatus(String productId) {
        return jdbc.queryForObject("SELECT status FROM products WHERE id = ?::uuid", String.class, productId);
    }

    private String productTitle(String productId) {
        return jdbc.queryForObject("SELECT title FROM products WHERE id = ?::uuid", String.class, productId);
    }

    private String nicknameOf(String userId) {
        return jdbc.queryForObject("SELECT nickname FROM users WHERE id = ?::uuid", String.class, userId);
    }
}
