package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 7 十一：真实 PostgreSQL 上的 10 组竞态。每组跑多轮，断言的是任何交错下都成立的确定结果；
 * 全部依靠行锁与数据库约束（订单 FOR UPDATE、报告 FOR UPDATE、案件 FOR UPDATE、用户 FOR SHARE / FOR NO KEY UPDATE、
 * 取消记录主键、每份报告至多一条自动限制的唯一索引），不依赖任何单机内存锁。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.no-show-report.limit=1000",
        "campus-market.rate-limit.moderation-report.limit=1000",
        "campus-market.rate-limit.appeal-submit.limit=1000",
        "campus-market.rate-limit.circle-create.limit=1000",
        "campus-market.rate-limit.confirmation-code.limit=1000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GovernanceConcurrencyIT {

    private static final int ROUNDS = 4;

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_governance_race").withUsername("campus_gov_race").withPassword("campus_gov_race_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "governance-race-it-secret-0123456789ab");
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

    private Deal accepted(String category) throws Exception {
        User seller = api.register(), buyer = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single(category, "竞态 " + UUID.randomUUID(), 20))).path("id").asText();
        String order = api.order(buyer, product);
        api.ok(api.transition(seller, order, "PENDING_MEETING"));
        return new Deal(seller, buyer, product, order);
    }

    private void meetingPast(String orderId) {
        com.lulu.campusmarketbackend.support.SlotClock.endedMinutesAgo(jdbc, orderId, 60);
    }

    private User staff(String role) throws Exception {
        User u = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
        return u;
    }

    private MvcResult cancel(User who, String orderId, String reason) throws Exception {
        return api.post(who, "/v1/orders/" + orderId + "/transitions", Map.of("to", "CANCELLED", "reasonCode", reason));
    }

    private MvcResult decide(User staff, String caseId, String action, String reason, Integer hours) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("action", action);
        b.put("reasonCode", reason);
        if (hours != null) b.put("durationHours", hours);
        return api.post(staff, "/v1/moderation/cases/" + caseId + "/decision", b);
    }

    private String report(User who, String type, String target, String reason) throws Exception {
        api.ok(api.post(who, "/v1/moderation-reports", Map.of("targetType", type, "targetId", target, "reasonCode", reason)));
        return jdbc.queryForObject("SELECT id::text FROM moderation_cases WHERE target_type=? AND target_id=?::uuid ORDER BY created_at DESC LIMIT 1",
                String.class, type, target);
    }

    private static Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return b;
    }

    @Test
    @DisplayName("1. 双方同时取消：两个请求都成功（幂等），只有一条取消记录，商品只释放一次")
    void bothCancel() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            Deal d = accepted("其他");
            List<MvcResult> r = race(() -> cancel(d.buyer(), d.orderId(), "CHANGED_MIND"), () -> cancel(d.seller(), d.orderId(), "ITEM_UNAVAILABLE"));
            assertThat(r).allMatch(x -> status(x) == 200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_cancellations WHERE order_id=?::uuid", Long.class, d.orderId())).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_events WHERE order_id=?::uuid AND to_status='CANCELLED'", Long.class, d.orderId())).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, d.productId())).isEqualTo("在售");
        }
    }

    @Test
    @DisplayName("2. 取消与完成交易并发：恰好一个成功；取消记录存在当且仅当订单已取消；商品状态与订单一致")
    void cancelVersusComplete() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            Deal d = accepted("其他");
            api.ok(api.transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"));
            String code = jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, d.orderId());
            List<MvcResult> r = race(() -> cancel(d.buyer(), d.orderId(), "CHANGED_MIND"),
                    () -> api.post(d.seller(), "/v1/orders/" + d.orderId() + "/transitions", Map.of("to", "COMPLETED", "confirmationCode", code)));
            assertThat(r.stream().filter(x -> status(x) == 200).count()).isEqualTo(1);
            String status = jdbc.queryForObject("SELECT status FROM orders WHERE id=?::uuid", String.class, d.orderId());
            long records = jdbc.queryForObject("SELECT count(*) FROM order_cancellations WHERE order_id=?::uuid", Long.class, d.orderId());
            String product = jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, d.productId());
            assertThat(status).isIn("CANCELLED", "COMPLETED");
            assertThat(records).isEqualTo("CANCELLED".equals(status) ? 1 : 0);
            assertThat(product).isEqualTo("CANCELLED".equals(status) ? "在售" : "已售出");
        }
    }

    @Test
    @DisplayName("3. 改约与提交爽约报告并发：旧档期上不会留下有效报告（要么报告被改约作废，要么报告因新档期未到而被拒）")
    void rescheduleVersusReport() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            Deal d = accepted("其他");
            meetingPast(d.orderId());
            OffsetDateTime start = OffsetDateTime.now(ZoneOffset.UTC).plusDays(2).truncatedTo(ChronoUnit.HOURS);
            JsonNode flow = api.ok(api.post(d.seller(), "/v1/orders/" + d.orderId() + "/meeting-proposals",
                    Map.of("meetingPointId", "东校区-library", "startsAtIso", start.toString(), "endsAtIso", start.plusHours(1).toString())));
            String proposal = null;
            for (JsonNode p : flow.path("proposals")) if ("PENDING".equals(p.path("status").asText())) proposal = p.path("id").asText();
            String pid = proposal;
            List<MvcResult> r = race(() -> api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/meeting-proposals/" + pid + "/accept", Map.of()),
                    () -> api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE")));
            assertThat(status(r.get(0))).isEqualTo(200);
            assertThat(status(r.get(1))).isIn(200, 409);
            int revision = jdbc.queryForObject("SELECT meeting_revision FROM orders WHERE id=?::uuid", Integer.class, d.orderId());
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_no_show_reports WHERE order_id=?::uuid AND meeting_revision < ? "
                    + "AND status IN ('PENDING','ACKNOWLEDGED','DISPUTED','CONFIRMED')", Long.class, d.orderId(), revision)).isZero();
        }
    }

    @Test
    @DisplayName("4. 两人同时报告对方：各自一条 PENDING 报告，没有任何处罚")
    void mutualReports() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            Deal d = accepted("其他");
            meetingPast(d.orderId());
            List<MvcResult> r = race(() -> api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE")),
                    () -> api.post(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE")));
            assertThat(r).allMatch(x -> status(x) == 200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_no_show_reports WHERE order_id=?::uuid AND status='PENDING'", Long.class, d.orderId())).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id IN (?::uuid, ?::uuid)", Long.class, d.buyer().id(), d.seller().id())).isZero();
        }
    }

    @Test
    @DisplayName("5. 工作人员确认与对方承认并发：恰好一个生效；报告只有一个最终状态；自动限制至多一条；案件只结一次")
    void staffConfirmVersusAcknowledge() throws Exception {
        User s = staff("MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            Deal d = accepted("其他");
            meetingPast(d.orderId());
            String reportId = api.ok(api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE"))).path("id").asText();
            String caseId = report(d.buyer(), "NO_SHOW", reportId, "NO_SHOW_REVIEW");
            List<MvcResult> r = race(() -> decide(s, caseId, "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null),
                    () -> api.post(d.seller(), "/v1/no-show-reports/" + reportId + "/acknowledge", Map.of()));
            assertThat(r.stream().filter(x -> status(x) == 200).count()).isEqualTo(1);
            String status = jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?::uuid", String.class, reportId);
            assertThat(status).isIn("CONFIRMED", "ACKNOWLEDGED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE no_show_report_id=?::uuid", Long.class, reportId)).isLessThanOrEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, caseId)).isEqualTo("RESOLVED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE case_id=?::uuid", Long.class, caseId))
                    .isEqualTo("CONFIRMED".equals(status) ? 1 : 0);
        }
    }

    @Test
    @DisplayName("6. 工作人员限制与用户下单并发：要么订单在限制之前成立，要么下单被拒；不会有限制生效之后才成立的订单")
    void restrictVersusBooking() throws Exception {
        User s = staff("MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User target = api.register(), seller = api.register(), reporter = api.register();
            String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "限制竞态 " + n, 20))).path("id").asText();
            String caseId = report(reporter, "USER", target.id(), "FRAUD_SUSPECTED");
            List<MvcResult> r = race(() -> decide(s, caseId, "RESTRICT_BOOKING", "FRAUD_RISK", 24),
                    () -> api.post(target, "/v1/orders", orderBody(product)));
            assertThat(status(r.get(0))).isEqualTo(200);
            assertThat(status(r.get(1))).isIn(200, 403);
            OffsetDateTime starts = jdbc.queryForObject("SELECT starts_at FROM user_restrictions WHERE user_id=?::uuid", OffsetDateTime.class, target.id());
            List<OffsetDateTime> orders = jdbc.queryForList("SELECT created_at FROM orders WHERE buyer_id=?::uuid", OffsetDateTime.class, target.id());
            assertThat(orders.size()).isEqualTo(status(r.get(1)) == 200 ? 1 : 0);
            for (OffsetDateTime at : orders) assertThat(at).isBefore(starts);
        }
    }

    @Test
    @DisplayName("7. 限制到期与下单并发：成功的订单都在限制结束之后；到期前的请求都被拒")
    void expiryVersusBooking() throws Exception {
        User s = staff("MODERATOR");
        User target = api.register(), reporter = api.register();
        String caseId = report(reporter, "USER", target.id(), "SPAM");
        jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at) "
                + "VALUES (gen_random_uuid(), ?::uuid, 'pilot', 'BOOKING', 'CASE', ?::uuid, ?::uuid, 'OTHER', now() - interval '1 hour', clock_timestamp() + interval '600 milliseconds')",
                target.id(), caseId, s.id());
        OffsetDateTime ends = jdbc.queryForObject("SELECT ends_at FROM user_restrictions WHERE user_id=?::uuid", OffsetDateTime.class, target.id());
        List<Integer> statuses = new ArrayList<>();
        for (int n = 0; n < 12; n++) {
            User seller = api.register();
            String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "到期竞态 " + n, 20))).path("id").asText();
            statuses.add(status(api.post(target, "/v1/orders", orderBody(product))));
            Thread.sleep(80);
        }
        assertThat(statuses).allMatch(x -> x == 200 || x == 403);
        for (OffsetDateTime at : jdbc.queryForList("SELECT created_at FROM orders WHERE buyer_id=?::uuid", OffsetDateTime.class, target.id())) {
            assertThat(at).as("到期之前不会成立新订单").isAfterOrEqualTo(ends);
        }
    }

    @Test
    @DisplayName("8. 工作人员强制归档与所有者归档并发：两个请求都成功，圈子只归档一次、只有一条归档事件")
    void staffVersusOwnerArchive() throws Exception {
        User senior = staff("SENIOR_MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User owner = api.register(), member = api.register();
            String circle = api.createCircle(owner, "竞态归档 " + n, "PRIVATE");
            api.join(owner, circle, member);
            String caseId = report(member, "CIRCLE", circle, "SPAM");
            List<MvcResult> r = race(() -> decide(senior, caseId, "ARCHIVE_CIRCLE", "POLICY_VIOLATION", null),
                    () -> api.post(owner, "/v1/circles/" + circle + "/archive", Map.of()));
            assertThat(status(r.get(1))).isEqualTo(200);
            assertThat(status(r.get(0))).isIn(200, 409);
            assertThat(jdbc.queryForObject("SELECT status FROM circles WHERE id=?::uuid", String.class, circle)).isEqualTo("ARCHIVED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", Long.class, circle)).isEqualTo(1);
            long effective = jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE case_id=?::uuid AND effective", Long.class, caseId);
            String actor = jdbc.queryForObject("SELECT actor_user_id::text FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", String.class, circle);
            assertThat(effective).isEqualTo(actor.equals(senior.id()) ? 1 : 0);
        }
    }

    @Test
    @DisplayName("9. 两名工作人员同时处理一个案件：恰好一个结果、一条动作、一条限制；另一人 409")
    void twoStaffOneCase() throws Exception {
        User a = staff("MODERATOR"), b = staff("MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User target = api.register(), reporter = api.register();
            String caseId = report(reporter, "USER", target.id(), "HARASSMENT");
            List<MvcResult> r = race(() -> decide(a, caseId, "RESTRICT_PUBLISHING", "HARASSMENT", 24),
                    () -> decide(b, caseId, "NO_ACTION", "INSUFFICIENT_EVIDENCE", null));
            assertThat(r.stream().filter(x -> status(x) == 200).count()).isEqualTo(1);
            assertThat(r.stream().filter(x -> status(x) != 200).allMatch(x -> status(x) == 409)).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE case_id=?::uuid", Long.class, caseId)).isEqualTo(1);
            String resolution = jdbc.queryForObject("SELECT resolution_code FROM moderation_cases WHERE id=?::uuid", String.class, caseId);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE case_id=?::uuid", Long.class, caseId))
                    .isEqualTo("RESTRICT_PUBLISHING".equals(resolution) ? 1 : 0);
        }
    }

    @Test
    @DisplayName("10. 申诉通过与限制到期并发：结论总是 ACCEPTED；撤销只会发生在到期之前，到期之后不会写入撤销")
    void appealVersusExpiry() throws Exception {
        User a = staff("MODERATOR"), b = staff("SENIOR_MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User target = api.register(), reporter = api.register();
            String caseId = report(reporter, "USER", target.id(), "SPAM");
            api.ok(decide(a, caseId, "RESTRICT_BOOKING", "POLICY_VIOLATION", 1));
            String restriction = jdbc.queryForObject("SELECT id::text FROM user_restrictions WHERE user_id=?::uuid", String.class, target.id());
            String appeal = api.ok(api.post(target, "/v1/me/appeals", Map.of("restrictionId", restriction, "reason", "申诉竞态"))).path("id").asText();
            // 让限制在 0～400 毫秒后到期，与申诉决定交错
            final double delay = (n % 3) * 0.2;
            new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(jdbc.getDataSource()))
                    .executeWithoutResult(t -> {
                        jdbc.execute("ALTER TABLE user_restrictions DISABLE TRIGGER user_restrictions_guard");
                        jdbc.update("UPDATE user_restrictions SET ends_at = clock_timestamp() + make_interval(secs => ?) WHERE id=?::uuid", delay, restriction);
                        jdbc.execute("ALTER TABLE user_restrictions ENABLE TRIGGER user_restrictions_guard");
                    });
            Thread.sleep(100);
            MvcResult decided = api.post(b, "/v1/moderation/appeals/" + appeal + "/decision", Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED"));
            assertThat(status(decided)).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_appeals WHERE id=?::uuid", String.class, appeal)).isEqualTo("ACCEPTED");
            Map<String, Object> row = jdbc.queryForMap("SELECT revoked_at, ends_at FROM user_restrictions WHERE id=?::uuid", restriction);
            if (row.get("revoked_at") != null) {
                assertThat(((java.sql.Timestamp) row.get("revoked_at")).toInstant()).isBefore(((java.sql.Timestamp) row.get("ends_at")).toInstant());
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE appeal_id=?::uuid", Long.class, appeal)).isEqualTo(1);
        }
    }

    // ------------------------------------------------------------------ 7.1B 重算与并发

    private Deal acceptedFor(User buyer) throws Exception {
        User seller = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "重算竞态 " + UUID.randomUUID(), 20))).path("id").asText();
        String order = api.order(buyer, product);
        api.ok(api.transition(seller, order, "PENDING_MEETING"));
        return new Deal(seller, buyer, product, order);
    }

    private String noShow(Deal d) throws Exception {
        meetingPast(d.orderId());
        return api.ok(api.post(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE"))).path("id").asText();
    }

    private String ack(Deal d) throws Exception {
        String r = noShow(d);
        api.ok(api.post(d.buyer(), "/v1/no-show-reports/" + r + "/acknowledge", Map.of()));
        return r;
    }

    private String caseOf(String report) {
        return jdbc.queryForObject("SELECT id::text FROM moderation_cases WHERE target_type='NO_SHOW' AND target_id=?::uuid ORDER BY created_at DESC LIMIT 1",
                String.class, report);
    }

    private long hoursOf(String restriction) {
        Map<String, Object> r = jdbc.queryForMap("SELECT starts_at, ends_at FROM user_restrictions WHERE id=?::uuid", restriction);
        return java.time.Duration.between(((java.sql.Timestamp) r.get("starts_at")).toInstant(), ((java.sql.Timestamp) r.get("ends_at")).toInstant()).toHours();
    }

    @Test
    @DisplayName("11. 7.1B 申诉推翻一次确认、另一次新确认、旧限制到期三者并发：不重复处罚——新确认的限制最终都是 24 小时（与串行顺序无关），"
            + "每份报告至多一条限制、每条限制对同一原因至多一条纠正；已到期的限制不被纠正")
    void appealConfirmExpiry() throws Exception {
        User confirmer = staff("MODERATOR"), reviewer = staff("MODERATOR"), third = staff("MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User buyer = api.register();
            Deal d1 = acceptedFor(buyer), d2 = acceptedFor(buyer), d3 = acceptedFor(buyer);
            // N1：工作人员确认（可申诉的动作）；N2：对方承认 → R2 24 小时（依据 N1、N2）；N3：异议中，等待确认
            String n1 = noShow(d1);
            api.ok(api.post(buyer, "/v1/no-show-reports/" + n1 + "/dispute", Map.of("note", "有异议")));
            api.ok(decide(confirmer, caseOf(n1), "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null));
            String n2 = ack(d2);
            String r2 = jdbc.queryForObject("SELECT id::text FROM user_restrictions WHERE no_show_report_id=?::uuid", String.class, n2);
            String n3 = noShow(d3);
            api.ok(api.post(buyer, "/v1/no-show-reports/" + n3 + "/dispute", Map.of("note", "有异议")));
            String action = jdbc.queryForObject("SELECT id::text FROM moderation_actions WHERE action_code='CONFIRM_NO_SHOW' AND target_id=?::uuid", String.class, n1);
            String appeal = api.ok(api.post(buyer, "/v1/me/appeals", Map.of("actionId", action, "reason", "重算竞态"))).path("id").asText();
            // R2 在 0～400 毫秒后自然到期，与重算交错
            final double delay = (n % 3) * 0.2;
            new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(jdbc.getDataSource()))
                    .executeWithoutResult(t -> {
                        jdbc.execute("SET LOCAL session_replication_role = replica");
                        jdbc.update("UPDATE user_restrictions SET ends_at = clock_timestamp() + make_interval(secs => ?) WHERE id=?::uuid", delay, r2);
                    });
            Map<String, Object> r2Before = jdbc.queryForMap("SELECT ends_at FROM user_restrictions WHERE id=?::uuid", r2);

            List<MvcResult> r = race(
                    () -> api.post(reviewer, "/v1/moderation/appeals/" + appeal + "/decision", Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED")),
                    () -> decide(third, caseOf(n3), "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null));
            assertThat(r).allMatch(x -> status(x) == 200);
            assertThat(jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?::uuid", String.class, n1)).isEqualTo("REJECTED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE no_show_report_id=?::uuid", Long.class, n3)).isEqualTo(1);
            String r3 = jdbc.queryForObject("SELECT id::text FROM user_restrictions WHERE no_show_report_id=?::uuid", String.class, n3);
            assertThat(hoursOf(r3)).as("无论谁先：剩余 N2、N3 两次 → 24 小时").isEqualTo(24);
            assertThat(jdbc.queryForObject("SELECT COALESCE(max(c), 0) FROM (SELECT count(*) AS c FROM user_restriction_corrections GROUP BY restriction_id, cause_report_id) x",
                    Long.class)).as("同一限制、同一原因至多一条纠正").isLessThanOrEqualTo(1L);
            Map<String, Object> r2After = jdbc.queryForMap("SELECT revoked_at, revoke_reason, ends_at FROM user_restrictions WHERE id=?::uuid", r2);
            if (r2After.get("revoked_at") != null) {
                assertThat(r2After.get("revoke_reason")).isEqualTo("RULE_RECOMPUTED");
                assertThat(((java.sql.Timestamp) r2After.get("revoked_at")).toInstant()).isBefore(((java.sql.Timestamp) r2Before.get("ends_at")).toInstant());
            } else {
                assertThat(r2After.get("ends_at")).as("已到期：只保留审计，不改动").isEqualTo(r2Before.get("ends_at"));
                assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_corrections WHERE restriction_id=?::uuid", Long.class, r2)).isZero();
            }
        }
    }

    @Test
    @DisplayName("12. 7.1B 同一用户的两条自动限制同时被两位工作人员通过申诉：不死锁，两条都撤销、两次确认都被推翻，纠正记录不重复")
    void twoAppealsSameUser() throws Exception {
        User b = staff("MODERATOR"), c = staff("MODERATOR");
        for (int n = 0; n < ROUNDS; n++) {
            User buyer = api.register();
            Deal d1 = acceptedFor(buyer), d2 = acceptedFor(buyer), d3 = acceptedFor(buyer);
            ack(d1);
            String n2 = ack(d2), n3 = ack(d3);
            String r2 = jdbc.queryForObject("SELECT id::text FROM user_restrictions WHERE no_show_report_id=?::uuid", String.class, n2);
            String r3 = jdbc.queryForObject("SELECT id::text FROM user_restrictions WHERE no_show_report_id=?::uuid", String.class, n3);
            String a2 = api.ok(api.post(buyer, "/v1/me/appeals", Map.of("restrictionId", r2, "reason", "并发申诉"))).path("id").asText();
            String a3 = api.ok(api.post(buyer, "/v1/me/appeals", Map.of("restrictionId", r3, "reason", "并发申诉"))).path("id").asText();
            List<MvcResult> r = race(
                    () -> api.post(b, "/v1/moderation/appeals/" + a2 + "/decision", Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED")),
                    () -> api.post(c, "/v1/moderation/appeals/" + a3 + "/decision", Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED")));
            assertThat(r).allMatch(x -> status(x) == 200);
            for (String restriction : List.of(r2, r3)) {
                assertThat(jdbc.queryForObject("SELECT revoke_reason FROM user_restrictions WHERE id=?::uuid", String.class, restriction)).isEqualTo("APPEAL_ACCEPTED");
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM order_no_show_reports WHERE id IN (?::uuid, ?::uuid) AND status='REJECTED'", Long.class, n2, n3)).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_corrections WHERE restriction_id IN (?::uuid, ?::uuid)", Long.class, r2, r3)).isLessThanOrEqualTo(1);
        }
    }

    @SafeVarargs
    private static List<MvcResult> race(Callable<MvcResult>... calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.length);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<MvcResult>> futures = new ArrayList<>();
            for (Callable<MvcResult> call : calls) futures.add(pool.submit(() -> { start.await(); return call.call(); }));
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }
}
