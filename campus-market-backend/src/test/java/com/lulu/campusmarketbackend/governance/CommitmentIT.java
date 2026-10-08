package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
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
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 7.1 / 7.2 / 8：取消记录与爽约报告的 HTTP 行为测试（真实 PostgreSQL 16）。
 * 单方报告只是 PENDING、不产生任何处罚；只有对方承认或工作人员确认才计数；自动限制按公开规则、有期限。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.no-show-report.limit=200",
        "campus-market.rate-limit.moderation-report.limit=200",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CommitmentIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_commitment").withUsername("campus_commitment").withPassword("campus_commitment_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "commitment-it-secret-0123456789abcdef");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    record Deal(User seller, User buyer, String productId, String orderId) {}

    private Deal ordered() throws Exception {
        User seller = api.register(), buyer = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "承诺测试 " + UUID.randomUUID(), 20))).path("id").asText();
        return new Deal(seller, buyer, product, api.order(buyer, product));
    }

    private Deal accepted() throws Exception {
        Deal d = ordered();
        assertThat(status(api.transition(d.seller(), d.orderId(), "PENDING_MEETING"))).isEqualTo(200);
        return d;
    }

    /** 把已冻结的明确档期（订单行 + 快照）整体挪到过去：结束于 minutesAfterEnd 分钟前（测试专用时间旅行）。 */
    private void meetingEndedMinutesAgo(String orderId, int minutesAfterEnd) {
        com.lulu.campusmarketbackend.support.SlotClock.endedMinutesAgo(jdbc, orderId, minutesAfterEnd);
    }

    private MvcResult cancel(User who, String orderId, Map<String, Object> extra) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("to", "CANCELLED");
        b.putAll(extra);
        return api.post(who, "/v1/orders/" + orderId + "/transitions", b);
    }

    private MvcResult reportNoShow(User who, String orderId, String reason) throws Exception {
        return api.post(who, "/v1/orders/" + orderId + "/no-show-reports", Map.of("reasonCode", reason));
    }

    private void staff(User u, String role) {
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
    }

    @Nested
    @DisplayName("7.1 取消记录")
    class Cancellations {

        @Test
        @DisplayName("1. 卖家确认前：买家可以不填原因无责取消，照常记录取消事实（阶段由服务端判定）；客户端不能提交执行人 / 阶段 / 时间")
        void beforeSellerConfirm() throws Exception {
            Deal d = ordered();
            for (String forged : List.of("actorUserId", "phase", "createdAt", "schoolId")) {
                assertThat(status(cancel(d.buyer(), d.orderId(), Map.of(forged, "x")))).as(forged).isEqualTo(400);
            }
            assertThat(status(cancel(d.buyer(), d.orderId(), Map.of()))).isEqualTo(200);
            Map<String, Object> row = jdbc.queryForMap("SELECT * FROM order_cancellations WHERE order_id=?::uuid", d.orderId());
            assertThat(row.get("phase")).isEqualTo("BEFORE_SELLER_CONFIRM");
            assertThat(row.get("reason_code")).isNull();
            assertThat(row.get("actor_user_id").toString()).isEqualTo(d.buyer().id());
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, d.buyer().id()))
                    .as("无责取消不产生任何处罚").isZero();
            assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, d.productId())).isEqualTo("在售");
        }

        @Test
        @DisplayName("2. 卖家确认后：双方都能取消，但必须选择结构化原因；「其他」必须写说明；说明最多 200 字且不接受 HTML；原因码白名单")
        void afterSellerConfirm() throws Exception {
            Deal d = accepted();
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of()))).as("缺原因").isEqualTo(400);
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "BAD_CODE")))).isEqualTo(400);
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "OTHER")))).as("其他需说明").isEqualTo(400);
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "OTHER", "note", "<b>x</b>")))).isEqualTo(400);
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "OTHER", "note", "x".repeat(201))))).isEqualTo(400);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_cancellations WHERE order_id=?::uuid", Long.class, d.orderId()))
                    .as("被拒绝的请求不留下任何记录").isZero();
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "ITEM_UNAVAILABLE", "note", "东西坏了")))).isEqualTo(200);
            Map<String, Object> row = jdbc.queryForMap("SELECT * FROM order_cancellations WHERE order_id=?::uuid", d.orderId());
            assertThat(row).containsEntry("phase", "AFTER_SELLER_CONFIRM").containsEntry("reason_code", "ITEM_UNAVAILABLE").containsEntry("note", "东西坏了");
            JsonNode flow = api.flow(d.buyer(), d.orderId());
            assertThat(flow.path("cancellation").path("phase").asText()).isEqualTo("AFTER_SELLER_CONFIRM");
            assertThat(flow.path("cancellation").path("byMe").asBoolean()).isFalse();
        }

        @Test
        @DisplayName("3. 阶段：改约握手后为 AFTER_MEETING_AGREED；有人声明到达后为 AFTER_ARRIVAL_REPORTED；验货不一致为 INSPECTION_MISMATCH")
        void phases() throws Exception {
            Deal agreed = accepted();
            jdbc.update("UPDATE orders SET meeting_revision = 1 WHERE id=?::uuid", agreed.orderId());
            assertThat(status(cancel(agreed.buyer(), agreed.orderId(), Map.of("reasonCode", "SCHEDULE_CONFLICT")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT phase FROM order_cancellations WHERE order_id=?::uuid", String.class, agreed.orderId()))
                    .isEqualTo("AFTER_MEETING_AGREED");

            Deal arrived = accepted();
            assertThat(status(api.put(arrived.seller(), "/v1/orders/" + arrived.orderId() + "/presence", Map.of("action", "ARRIVE")))).isEqualTo(200);
            assertThat(status(cancel(arrived.buyer(), arrived.orderId(), Map.of("reasonCode", "COUNTERPART_UNRESPONSIVE")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT phase FROM order_cancellations WHERE order_id=?::uuid", String.class, arrived.orderId()))
                    .isEqualTo("AFTER_ARRIVAL_REPORTED");

            User seller = api.register(), buyer = api.register();
            String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "验货不一致", 20))).path("id").asText();
            String order = api.order(buyer, product);
            api.ok(api.transition(seller, order, "PENDING_MEETING"));
            api.ok(api.submitAll(buyer, order, "MISMATCH"));
            assertThat(status(cancel(seller, order, Map.of("reasonCode", "CONDITION_MISMATCH")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT phase FROM order_cancellations WHERE order_id=?::uuid", String.class, order)).isEqualTo("INSPECTION_MISMATCH");
        }

        @Test
        @DisplayName("4. 幂等：重复取消（包括另一方随后再取消）返回同一结果，不重复记录；旧的已取消订单不伪造取消原因；记录不可改写")
        void idempotentAndImmutable() throws Exception {
            Deal d = accepted();
            assertThat(status(cancel(d.buyer(), d.orderId(), Map.of("reasonCode", "CHANGED_MIND")))).isEqualTo(200);
            assertThat(status(cancel(d.buyer(), d.orderId(), Map.of("reasonCode", "CHANGED_MIND")))).isEqualTo(200);
            assertThat(status(cancel(d.seller(), d.orderId(), Map.of("reasonCode", "OTHER", "note", "我也取消")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_cancellations WHERE order_id=?::uuid", Long.class, d.orderId())).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT actor_user_id::text FROM order_cancellations WHERE order_id=?::uuid", String.class, d.orderId()))
                    .isEqualTo(d.buyer().id());
            assertThatThrownBy(() -> jdbc.update("UPDATE order_cancellations SET reason_code='OTHER' WHERE order_id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM order_cancellations WHERE order_id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            // 取消记录只能跟随取消状态变化：还没取消的订单写不进去
            Deal live = accepted();
            assertThatThrownBy(() -> jdbc.update("INSERT INTO order_cancellations(order_id, school_id, actor_user_id, phase, reason_code) "
                    + "VALUES (?::uuid, 'pilot', ?::uuid, 'AFTER_SELLER_CONFIRM', 'CHANGED_MIND')", live.orderId(), live.buyer().id()))
                    .isInstanceOf(DataAccessException.class);
        }

        @Test
        @DisplayName("5. 确认档期后的取消只出现在本人履历，不进入公共履历；取消不影响对方或本人的公开数字")
        void ownHistoryOnly() throws Exception {
            Deal d = accepted();
            api.ok(cancel(d.buyer(), d.orderId(), Map.of("reasonCode", "SCHEDULE_CONFLICT")));
            JsonNode own = api.ok(api.get(d.buyer(), "/v1/me/trade-history"));
            assertThat(own.path("cancellationsAfterAgreement")).hasSize(1);
            assertThat(own.path("cancellationsAfterAgreement").get(0).path("reasonCode").asText()).isEqualTo("SCHEDULE_CONFLICT");
            assertThat(api.ok(api.get(d.seller(), "/v1/me/trade-history")).path("cancellationsAfterAgreement")).isEmpty();
            JsonNode summary = api.ok(api.get(d.seller(), "/v1/users/" + d.buyer().id() + "/trade-summary"));
            assertThat(summary.toString()).doesNotContain("cancel").doesNotContain("SCHEDULE_CONFLICT").doesNotContain("noShow").doesNotContain("restrict");
        }
    }

    @Nested
    @DisplayName("7.2 爽约报告")
    class NoShows {

        @Test
        @DisplayName("6. 提交条件：必须有双方确认的档期；档期结束 15 分钟后、7 天内；只能报告对方（服务端推导）；见面或面交前取消不能报告；同一档期只能报告一次")
        void eligibility() throws Exception {
            Deal pending = ordered();
            meetingEndedMinutesAgo(pending.orderId(), 30);
            MvcResult notAgreed = reportNoShow(pending.buyer(), pending.orderId(), "DID_NOT_ARRIVE");
            assertThat(status(notAgreed)).isEqualTo(409);
            assertThat(api.body(notAgreed).path("data").path("code").asText()).isEqualTo("NO_AGREED_MEETING");

            Deal d = accepted();
            meetingEndedMinutesAgo(d.orderId(), 10);
            assertThat(api.body(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE")).path("data").path("code").asText()).isEqualTo("TOO_EARLY");
            meetingEndedMinutesAgo(d.orderId(), 8 * 24 * 60);
            assertThat(api.body(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE")).path("data").path("code").asText()).isEqualTo("WINDOW_CLOSED");
            meetingEndedMinutesAgo(d.orderId(), 20);
            assertThat(status(api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE", "reportedUserId", d.buyer().id()))))
                    .as("客户端不能指定被报告人").isEqualTo(400);
            JsonNode report = api.ok(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE"));
            assertThat(report.path("status").asText()).isEqualTo("PENDING");
            assertThat(report.path("byMe").asBoolean()).isTrue();
            assertThat(jdbc.queryForObject("SELECT reported_user_id::text FROM order_no_show_reports WHERE id=?::uuid", String.class, report.path("id").asText()))
                    .isEqualTo(d.seller().id());
            assertThat(api.body(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE")).path("data").path("code").asText()).isEqualTo("ALREADY_REPORTED");
            assertThat(status(reportNoShow(api.register(), d.orderId(), "DID_NOT_ARRIVE"))).as("非订单双方").isEqualTo(404);

            // 面交之前就取消的订单（这里用 V10 之前的旧取消记录模拟：状态事件的时间早于档期）不能报告爽约
            Deal cancelledEarly = accepted();
            meetingEndedMinutesAgo(cancelledEarly.orderId(), 30);
            jdbc.update("UPDATE orders SET status='CANCELLED' WHERE id=?::uuid", cancelledEarly.orderId());
            jdbc.update("INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, created_at) "
                    + "VALUES (gen_random_uuid(), ?::uuid, ?::uuid, 'PENDING_MEETING', 'CANCELLED', now() - interval '3 hours')",
                    cancelledEarly.orderId(), cancelledEarly.buyer().id());
            assertThat(api.body(reportNoShow(cancelledEarly.seller(), cancelledEarly.orderId(), "DID_NOT_ARRIVE")).path("data").path("code").asText())
                    .isEqualTo("CANCELLED_BEFORE_MEETING");
            // 档期过后才取消（对方没来，自己取消释放商品）：仍然可以报告
            Deal cancelledAfter = accepted();
            meetingEndedMinutesAgo(cancelledAfter.orderId(), 30);
            api.ok(cancel(cancelledAfter.seller(), cancelledAfter.orderId(), Map.of("reasonCode", "COUNTERPART_UNRESPONSIVE")));
            assertThat(api.ok(reportNoShow(cancelledAfter.seller(), cancelledAfter.orderId(), "DID_NOT_ARRIVE")).path("status").asText()).isEqualTo("PENDING");

            User seller = api.register(), buyer = api.register();
            String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "见面了", 20))).path("id").asText();
            String met = api.order(buyer, product);
            api.ok(api.transition(seller, met, "PENDING_MEETING"));
            api.ok(api.submitAll(buyer, met, "MATCH"));
            api.ok(api.transition(buyer, met, "BUYER_CONFIRMED"));
            meetingEndedMinutesAgo(met, 30);
            assertThat(api.body(reportNoShow(seller, met, "DID_NOT_ARRIVE")).path("data").path("code").asText()).isEqualTo("MET");
        }

        @Test
        @DisplayName("7. 单方报告不处罚：PENDING 不计数、不产生限制、不公开；报告对双方可见，presence 只是事件")
        void pendingIsHarmless() throws Exception {
            Deal d = accepted();
            meetingEndedMinutesAgo(d.orderId(), 30);
            String id = api.ok(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE")).path("id").asText();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, d.seller().id())).isZero();
            JsonNode sellerView = api.ok(api.get(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports"));
            assertThat(sellerView.path("reports").get(0).path("aboutMe").asBoolean()).isTrue();
            assertThat(sellerView.path("reports").get(0).path("canRespond").asBoolean()).isTrue();
            JsonNode governance = api.ok(api.get(d.seller(), "/v1/me/governance"));
            assertThat(governance.path("noShowWarning").isNull()).as("PENDING 不计数").isTrue();
            assertThat(governance.path("restrictions")).isEmpty();
            User stranger = api.register();
            assertThat(status(api.get(stranger, "/v1/orders/" + d.orderId() + "/no-show-reports"))).isEqualTo(404);
            assertThat(api.ok(api.get(stranger, "/v1/users/" + d.seller().id() + "/trade-summary")).toString()).doesNotContain(id).doesNotContain("noShow");
        }

        @Test
        @DisplayName("8. 承认才计数：第 1 次只提醒；30 天内第 2 次限制预约 24 小时、第 3 次 72 小时；限制有期限、有来源；不影响浏览与已有订单")
        void acknowledgeRule() throws Exception {
            User flaky = api.register();
            long[] expectHours = {0, 24, 72};
            String existingOrder = null;
            for (int i = 0; i < 3; i++) {
                User buyer = api.register();
                String product = api.ok(api.post(flaky, "/v1/products", SupplyApi.single("其他", "爽约 " + i, 20))).path("id").asText();
                String order = api.order(buyer, product);
                api.ok(api.transition(flaky, order, "PENDING_MEETING"));
                meetingEndedMinutesAgo(order, 30);
                String report = api.ok(reportNoShow(buyer, order, "DID_NOT_ARRIVE")).path("id").asText();
                assertThat(status(api.post(buyer, "/v1/no-show-reports/" + report + "/acknowledge", Map.of()))).as("报告人不能替对方承认").isEqualTo(404);
                JsonNode acked = api.ok(api.post(flaky, "/v1/no-show-reports/" + report + "/acknowledge", Map.of("note", "确实没去")));
                assertThat(acked.path("status").asText()).isEqualTo("ACKNOWLEDGED");
                List<Map<String, Object>> rows = jdbc.queryForList("SELECT scope, source, no_show_report_id::text AS report, "
                        + "extract(epoch FROM ends_at - starts_at) / 3600 AS hours FROM user_restrictions WHERE user_id=?::uuid ORDER BY created_at", flaky.id());
                if (expectHours[i] == 0) {
                    assertThat(rows).as("第 1 次只提醒").isEmpty();
                    JsonNode g = api.ok(api.get(flaky, "/v1/me/governance"));
                    assertThat(g.path("noShowWarning").path("confirmedCount").asInt()).isEqualTo(1);
                    existingOrder = null;
                } else {
                    Map<String, Object> last = rows.get(rows.size() - 1);
                    // 7.1B：自动限制的来源统一为 SYSTEM_RULE（V11 起）
                    assertThat(last).containsEntry("scope", "BOOKING").containsEntry("source", "SYSTEM_RULE").containsEntry("report", report);
                    assertThat(((Number) last.get("hours")).doubleValue()).isEqualTo((double) expectHours[i]);
                }
            }
            // 受限期间：不能预约新订单，但可以浏览、完成已有订单
            User other = api.register();
            String theirs = api.ok(api.post(other, "/v1/products", SupplyApi.single("其他", "别人的商品", 20))).path("id").asText();
            MvcResult blocked = api.post(flaky, "/v1/orders", orderBody(theirs));
            assertThat(status(blocked)).isEqualTo(403);
            assertThat(api.body(blocked).path("data").path("scope").asText()).isEqualTo("BOOKING");
            assertThat(api.body(blocked).path("requestId").asText()).isNotBlank();
            assertThat(status(api.get(flaky, "/v1/products/" + theirs))).isEqualTo(200);
            assertThat(existingOrder).isNull();
        }

        @Test
        @DisplayName("9. 异议进入复核：DISPUTED 不计数；只有工作人员确认才计数；驳回不计数；改约让旧档期上的报告失效，不能再被确认")
        void disputeAndReschedule() throws Exception {
            Deal d = accepted();
            meetingEndedMinutesAgo(d.orderId(), 30);
            String report = api.ok(reportNoShow(d.buyer(), d.orderId(), "DID_NOT_ARRIVE")).path("id").asText();
            assertThat(status(api.post(d.seller(), "/v1/no-show-reports/" + report + "/dispute", Map.of()))).as("异议需要说明").isEqualTo(400);
            assertThat(api.ok(api.post(d.seller(), "/v1/no-show-reports/" + report + "/dispute", Map.of("note", "我到了，对方没来"))).path("status").asText())
                    .isEqualTo("DISPUTED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_cases WHERE no_show_report_id=?::uuid AND status='OPEN'", Long.class, report)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, d.seller().id())).isZero();

            // 改约：旧档期上的报告失效
            Deal r = accepted();
            meetingEndedMinutesAgo(r.orderId(), 30);
            String old = api.ok(reportNoShow(r.seller(), r.orderId(), "DID_NOT_ARRIVE")).path("id").asText();
            Map<String, Object> proposal = new LinkedHashMap<>();
            proposal.put("meetingPointId", "东校区-library");
            java.time.OffsetDateTime start = java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(2).truncatedTo(java.time.temporal.ChronoUnit.HOURS);
            proposal.put("startsAtIso", start.toString());
            proposal.put("endsAtIso", start.plusHours(1).toString());
            JsonNode flow = api.ok(api.post(r.buyer(), "/v1/orders/" + r.orderId() + "/meeting-proposals", proposal));
            String proposalId = null;
            for (JsonNode p : flow.path("proposals")) if ("PENDING".equals(p.path("status").asText())) proposalId = p.path("id").asText();
            api.ok(api.post(r.seller(), "/v1/orders/" + r.orderId() + "/meeting-proposals/" + proposalId + "/accept", Map.of()));
            assertThat(jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?::uuid", String.class, old)).isEqualTo("EXPIRED");
            assertThat(status(api.post(r.buyer(), "/v1/no-show-reports/" + old + "/acknowledge", Map.of()))).isEqualTo(409);
        }
    }

    private static Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return b;
    }
}
