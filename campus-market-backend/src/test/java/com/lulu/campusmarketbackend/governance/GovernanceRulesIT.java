package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SlotClock;
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

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 7.1：治理规则收口的 HTTP 行为测试（每个 @DisplayName 的编号对应报告里的追踪矩阵）。
 * <ul>
 *   <li>A 明确档期：新预约完整、接受后冻结、只认快照、旧订单不猜、直接请求不能绕过、改约版本、到达自报不是证据；</li>
 *   <li>B 自动限制：来源 / 规则版本 / 依据、30 天按确认时间、推翻后的重算（缩短 / 撤销 / 到期不动 / 人工不受影响 / 不加重）；</li>
 *   <li>C 利益回避：本人 / 本人内容 / 本人订单 / 本人举报 / 本人处理、无人可回避时保持待处理、自动限制可申诉、停用立即失权；</li>
 *   <li>D 邀请幂等边界；E 评论隐藏与单条私信隔离。</li>
 * </ul>
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.moderation-report.limit=500",
        "campus-market.rate-limit.appeal-submit.limit=100",
        "campus-market.rate-limit.no-show-report.limit=100",
        "campus-market.rate-limit.circle-create.limit=100",
        "campus-market.rate-limit.circle-invite-create.limit=200",
        "campus-market.rate-limit.circle-invite-redeem.limit=200",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GovernanceRulesIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_governance_rules").withUsername("campus_rules").withPassword("campus_rules_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "governance-rules-it-secret-0123456789ab");
    }

    private static final String LAKE = "规则湖畔校区";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
        jdbc.update("INSERT INTO schools(id,name) VALUES ('rules-lake','规则湖畔学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES (?, 'rules-lake', ?) ON CONFLICT DO NOTHING", LAKE, LAKE);
    }

    // ------------------------------------------------------------------ 夹具

    private User staff(String role) throws Exception {
        User u = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
        return u;
    }

    private void makeStaff(User u, String role) {
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
    }

    private String product(User seller) throws Exception {
        return api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "7.1 " + UUID.randomUUID(), 20))).path("id").asText();
    }

    private static String inHours(int hours) {
        return OffsetDateTime.now(ZoneOffset.UTC).plusHours(hours).truncatedTo(ChronoUnit.MINUTES).toString();
    }

    private MvcResult book(User buyer, String productId, String starts, Object ends) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", starts);
        if (ends != null) b.put("meetingEndsAtIso", ends);
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return api.post(buyer, "/v1/orders", b);
    }

    record Deal(User seller, User buyer, String orderId) {}

    /** 下单 → 卖家接单（写入 revision 0 快照）。 */
    private Deal accepted(User buyer) throws Exception {
        User seller = api.register();
        String order = api.order(buyer, product(seller));
        api.ok(api.transition(seller, order, "PENDING_MEETING"));
        return new Deal(seller, buyer, order);
    }

    private JsonNode reportNoShow(User reporter, String orderId) throws Exception {
        return api.ok(api.post(reporter, "/v1/orders/" + orderId + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE")));
    }

    /** 先为 buyer 建好 n 张已接单的订单：一旦产生预约限制，buyer 就不能再下新单。 */
    private java.util.ArrayDeque<Deal> deals(User buyer, int n) throws Exception {
        java.util.ArrayDeque<Deal> q = new java.util.ArrayDeque<>();
        for (int i = 0; i < n; i++) q.add(accepted(buyer));
        return q;
    }

    /** 订单被卖家报告爽约、buyer 自行承认：一次已确认（无工作人员）。 */
    private UUID acknowledged(Deal d) throws Exception {
        SlotClock.endedMinutesAgo(jdbc, d.orderId(), 30);
        String report = reportNoShow(d.seller(), d.orderId()).path("id").asText();
        api.ok(api.post(d.buyer(), "/v1/no-show-reports/" + report + "/acknowledge", Map.of()));
        return UUID.fromString(report);
    }

    private UUID acknowledged(User buyer) throws Exception {
        return acknowledged(accepted(buyer));
    }

    /** 订单被报告爽约、buyer 提出异议、由 staff 确认：一次工作人员确认（有 CONFIRM_NO_SHOW 动作，可申诉）。 */
    private UUID staffConfirmed(Deal d, User staff) throws Exception {
        SlotClock.endedMinutesAgo(jdbc, d.orderId(), 30);
        String report = reportNoShow(d.seller(), d.orderId()).path("id").asText();
        api.ok(api.post(d.buyer(), "/v1/no-show-reports/" + report + "/dispute", Map.of("note", "我到了")));
        api.ok(decide(staff, caseFor("NO_SHOW", report), "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null));
        return UUID.fromString(report);
    }

    private String caseFor(String type, String target) {
        return jdbc.queryForObject("SELECT id::text FROM moderation_cases WHERE target_type=? AND target_id=?::uuid ORDER BY created_at DESC LIMIT 1",
                String.class, type, target);
    }

    private MvcResult decide(User staff, String caseId, String action, String reason, Integer hours) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("action", action);
        b.put("reasonCode", reason);
        if (hours != null) b.put("durationHours", hours);
        return api.post(staff, "/v1/moderation/cases/" + caseId + "/decision", b);
    }

    private JsonNode fileReport(User who, String type, String id, String reason) throws Exception {
        return api.ok(api.post(who, "/v1/moderation-reports", Map.of("targetType", type, "targetId", id, "reasonCode", reason)));
    }

    private String appealRestriction(User who, UUID restriction) throws Exception {
        return api.ok(api.post(who, "/v1/me/appeals", Map.of("restrictionId", restriction.toString(), "reason", "请复核"))).path("id").asText();
    }

    private String appealAction(User who, UUID action) throws Exception {
        return api.ok(api.post(who, "/v1/me/appeals", Map.of("actionId", action.toString(), "reason", "请复核"))).path("id").asText();
    }

    private MvcResult decideAppeal(User staff, String appeal, boolean accept) throws Exception {
        return api.post(staff, "/v1/moderation/appeals/" + appeal + "/decision",
                Map.of("accept", accept, "reasonCode", accept ? "APPEAL_ACCEPTED" : "APPEAL_REJECTED"));
    }

    private UUID restrictionFrom(UUID report) {
        return jdbc.queryForObject("SELECT id FROM user_restrictions WHERE no_show_report_id=?", UUID.class, report);
    }

    private UUID confirmAction(UUID report) {
        return jdbc.queryForObject("SELECT id FROM moderation_actions WHERE action_code='CONFIRM_NO_SHOW' AND target_id=?", UUID.class, report);
    }

    private Duration length(UUID restriction) {
        Map<String, Object> r = jdbc.queryForMap("SELECT starts_at, ends_at FROM user_restrictions WHERE id=?", restriction);
        return Duration.between(((java.sql.Timestamp) r.get("starts_at")).toInstant(), ((java.sql.Timestamp) r.get("ends_at")).toInstant());
    }

    private int bookingStatus(User buyer) throws Exception {
        return status(book(buyer, product(api.register()), inHours(26), null));
    }

    // ================================================================== A 明确档期

    @Nested
    @DisplayName("7.1A 明确档期")
    class Slots {

        @Test
        @DisplayName("A1. 新预约保存明确的开始与结束时间：显式提交原样保存；不提交时默认 60 分钟并明确写入、返回给双方；卖家接单后生成相同的快照")
        void completeSlot() throws Exception {
            User seller = api.register(), buyer = api.register();
            String starts = inHours(30);
            String ends = OffsetDateTime.parse(starts).plusMinutes(45).toString();
            JsonNode order = api.ok(book(buyer, product(seller), starts, ends));
            assertThat(OffsetDateTime.parse(order.path("meetingEndsAtIso").asText()).toInstant()).isEqualTo(OffsetDateTime.parse(ends).toInstant());
            assertThat(order.path("slotAgreed").asBoolean()).as("卖家接单前还不是双方确认的档期").isFalse();
            JsonNode sellerView = api.ok(api.get(seller, "/v1/orders?role=seller")).get(0);
            assertThat(sellerView.path("meetingEndsAtIso").asText()).as("卖家接单时同样看到明确的结束时间").isEqualTo(order.path("meetingEndsAtIso").asText());

            api.ok(api.transition(seller, order.path("id").asText(), "PENDING_MEETING"));
            Map<String, Object> slot = jdbc.queryForMap("SELECT * FROM order_slot_agreements WHERE order_id=?::uuid", order.path("id").asText());
            assertThat(slot).containsEntry("meeting_revision", 0).containsEntry("source", "SELLER_ACCEPTED_BOOKING");
            assertThat(((java.sql.Timestamp) slot.get("ends_at")).toInstant()).isEqualTo(OffsetDateTime.parse(ends).toInstant());
            assertThat(api.flow(buyer, order.path("id").asText()).path("agreement").path("explicitSlot").asBoolean()).isTrue();

            JsonNode defaulted = api.ok(book(buyer, product(api.register()), starts, null));
            assertThat(Duration.between(OffsetDateTime.parse(defaulted.path("meetingAtIso").asText()),
                    OffsetDateTime.parse(defaulted.path("meetingEndsAtIso").asText()))).as("默认一小时，下单时就写入").isEqualTo(Duration.ofMinutes(60));
        }

        @Test
        @DisplayName("A2. 服务端验证时长与未来时间：结束不晚于开始、短于 15 分钟、长于 120 分钟、格式无效、开始在过去 → 400，且不生成订单")
        void serverValidation() throws Exception {
            User seller = api.register(), buyer = api.register();
            String p = product(seller);
            String starts = inHours(30);
            OffsetDateTime s = OffsetDateTime.parse(starts);
            for (Object bad : List.of(s.toString(), s.minusMinutes(5).toString(), s.plusMinutes(10).toString(), s.plusMinutes(121).toString(), "明天下午", 12)) {
                assertThat(status(book(buyer, p, starts, bad))).as(String.valueOf(bad)).isEqualTo(400);
            }
            assertThat(status(book(buyer, p, OffsetDateTime.now(ZoneOffset.UTC).minusHours(1).toString(), null))).as("开始时间在过去").isEqualTo(400);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id=?::uuid", Long.class, p)).isZero();
            assertThat(status(book(buyer, p, starts, s.plusMinutes(15).toString()))).isEqualTo(200);
        }

        @Test
        @DisplayName("A3. 接受后冻结：不经改约握手，订单上的时间 / 地点不能改；快照只增不改、不可删除；数据库不接受没有结束时间的新预约")
        void frozen() throws Exception {
            Deal d = accepted(api.register());
            assertThatThrownBy(() -> jdbc.update("UPDATE orders SET meeting_at = meeting_at + interval '1 hour', meeting_ends_at = meeting_ends_at + interval '1 hour' WHERE id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE orders SET meeting_point_id='东校区-canteen' WHERE id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE order_slot_agreements SET ends_at = ends_at - interval '10 minutes' WHERE order_id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM order_slot_agreements WHERE order_id=?::uuid", d.orderId()))
                    .isInstanceOf(DataAccessException.class);
            User seller = api.register(), buyer = api.register();
            String p = product(seller);
            assertThatThrownBy(() -> jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, "
                    + "confirmation_code, idempotency_key, request_hash, expires_at) VALUES (gen_random_uuid(), ?::uuid, ?::uuid, ?::uuid, 1, 'PENDING_SELLER_CONFIRM', "
                    + "'东校区-library', now() + interval '1 day', 'c', '123456', 'k', 'h', now() + interval '2 days')", p, buyer.id(), seller.id()))
                    .as("绕过接口写入没有结束时间的新预约").isInstanceOf(DataAccessException.class);
        }

        @Test
        @DisplayName("A4. 爽约资格只用接受时的快照：可报告时间 = 快照结束 + 15 分钟；返回所依据的快照；结束后 14 分钟 TOO_EARLY，16 分钟可以报告")
        void usesSnapshot() throws Exception {
            Deal d = accepted(api.register());
            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 14);
            JsonNode e = api.ok(api.get(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports")).path("eligibility");
            assertThat(e.path("code").asText()).isEqualTo("TOO_EARLY");
            long snapEnd = ((java.sql.Timestamp) jdbc.queryForObject("SELECT ends_at FROM order_slot_agreements WHERE order_id=?::uuid", Object.class, d.orderId())).getTime();
            assertThat(e.path("slot").path("endsAt").asLong()).isEqualTo(snapEnd);
            assertThat(e.path("reportableAt").asLong()).isEqualTo(snapEnd + Duration.ofMinutes(15).toMillis());
            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 16);
            assertThat(api.ok(api.get(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports")).path("eligibility").path("canReport").asBoolean()).isTrue();
        }

        @Test
        @DisplayName("A5. 旧订单不猜：没有结束时间的原始预约 → NO_EXPLICIT_SLOT、不能报告（409），订单上不被补写结束时间，接口里 meetingEndsAtIso 为 null")
        void legacyNotGuessed() throws Exception {
            Deal d = accepted(api.register());
            SlotClock.legacyWithoutEnd(jdbc, d.orderId(), 600);
            JsonNode e = api.ok(api.get(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports")).path("eligibility");
            assertThat(e.path("code").asText()).isEqualTo("NO_EXPLICIT_SLOT");
            assertThat(e.path("canReport").asBoolean()).isFalse();
            assertThat(e.path("slot").isNull()).isTrue();
            MvcResult r = api.post(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE"));
            assertThat(status(r)).isEqualTo(409);
            assertThat(api.body(r).path("data").path("code").asText()).isEqualTo("NO_EXPLICIT_SLOT");
            assertThat(jdbc.queryForObject("SELECT meeting_ends_at FROM orders WHERE id=?::uuid", Object.class, d.orderId())).isNull();
            JsonNode view = api.ok(api.get(d.buyer(), "/v1/orders?role=buyer")).get(0);
            assertThat(view.path("meetingEndsAtIso").isNull()).isTrue();
            assertThat(view.path("slotAgreed").asBoolean()).isFalse();
            assertThat(api.flow(d.buyer(), d.orderId()).path("agreement").path("explicitSlot").asBoolean()).isFalse();
        }

        @Test
        @DisplayName("A6. 直接请求无法绕过：旧预约上已有的待回应报告，被报告人「承认」→ 409 且不产生限制；工作人员没有 CONFIRM_NO_SHOW 可选、硬发 → 400；直接写库确认也被拒绝")
        void cannotBypass() throws Exception {
            User buyer = api.register();
            User staff = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 3);
            Deal d = q.poll();
            // 先产生两次真实确认：如果旧报告被承认，第三次会触发 72 小时限制
            acknowledged(q.poll());
            acknowledged(q.poll());
            long restrictionsBefore = jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, buyer.id());
            assertThat(restrictionsBefore).isEqualTo(1L);

            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 30);
            String report = reportNoShow(d.seller(), d.orderId()).path("id").asText();
            SlotClock.legacyWithoutEnd(jdbc, d.orderId(), 600);    // 模拟 V10 时期的旧预约上已有的报告
            MvcResult ack = api.post(buyer, "/v1/no-show-reports/" + report + "/acknowledge", Map.of());
            assertThat(status(ack)).isEqualTo(409);
            assertThat(api.body(ack).path("data").path("code").asText()).isEqualTo("NO_EXPLICIT_SLOT");
            assertThat(jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?::uuid", String.class, report)).isEqualTo("PENDING");

            fileReport(d.seller(), "NO_SHOW", report, "NO_SHOW_REVIEW");
            String c = caseFor("NO_SHOW", report);
            JsonNode detail = api.ok(api.get(staff, "/v1/moderation/cases/" + c));
            assertThat(detail.path("allowedActions").toString()).doesNotContain("CONFIRM_NO_SHOW").contains("REJECT_NO_SHOW");
            assertThat(detail.path("noShow").path("meeting").path("explicit").asBoolean()).isFalse();
            assertThat(detail.path("noShow").path("meeting").path("endsAt").isNull()).isTrue();
            assertThat(status(decide(staff, c, "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null))).isEqualTo(400);
            assertThatThrownBy(() -> jdbc.update("UPDATE order_no_show_reports SET status='CONFIRMED', decided_at=now(), decided_by=?::uuid, confirmed_at=now() WHERE id=?::uuid",
                    staff.id(), report)).isInstanceOf(DataAccessException.class);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, buyer.id())).isEqualTo(restrictionsBefore);
            api.ok(decide(staff, c, "REJECT_NO_SHOW", "INSUFFICIENT_EVIDENCE", null));
        }

        @Test
        @DisplayName("A7. 改约 revision 正确：旧预约通过改约握手确认一个完整新档期 → revision 1 快照（PROPOSAL_ACCEPTED），资格改用新快照；旧档期上的待回应报告失效")
        void reschedule() throws Exception {
            Deal d = accepted(api.register());
            SlotClock.legacyWithoutEnd(jdbc, d.orderId(), 30);
            OffsetDateTime s = OffsetDateTime.now(ZoneOffset.UTC).plusHours(3).truncatedTo(ChronoUnit.HOURS);
            api.ok(api.post(d.buyer(), "/v1/orders/" + d.orderId() + "/meeting-proposals",
                    Map.of("meetingPointId", "东校区-library", "startsAtIso", s.toString(), "endsAtIso", s.plusMinutes(30).toString())));
            String proposal = api.flow(d.seller(), d.orderId()).path("proposals").get(0).path("id").asText();
            api.ok(api.post(d.seller(), "/v1/orders/" + d.orderId() + "/meeting-proposals/" + proposal + "/accept", Map.of()));
            Map<String, Object> slot = jdbc.queryForMap("SELECT * FROM order_slot_agreements WHERE order_id=?::uuid", d.orderId());
            assertThat(slot).containsEntry("meeting_revision", 1).containsEntry("source", "PROPOSAL_ACCEPTED");
            assertThat(((java.sql.Timestamp) slot.get("ends_at")).toInstant()).isEqualTo(s.plusMinutes(30).toInstant());
            JsonNode e = api.ok(api.get(d.seller(), "/v1/orders/" + d.orderId() + "/no-show-reports")).path("eligibility");
            assertThat(e.path("code").asText()).isEqualTo("TOO_EARLY");
            assertThat(e.path("slot").path("revision").asInt()).isEqualTo(1);
            assertThat(api.flow(d.buyer(), d.orderId()).path("agreement").path("explicitSlot").asBoolean()).isTrue();
        }

        @Test
        @DisplayName("A8. 到达自报不是处罚证据：报告人自报「已到达」、对方未回应 → 报告只是 PENDING，没有任何限制；复核页把到达标注为本人声明")
        void arrivalIsNotEvidence() throws Exception {
            User buyer = api.register();
            java.util.ArrayDeque<Deal> q = deals(buyer, 2);
            acknowledged(q.poll());                         // 已有 1 次确认；如果到达被当成证据，第 2 次就会限制
            Deal d = q.poll();
            api.ok(api.put(d.seller(), "/v1/orders/" + d.orderId() + "/presence", Map.of("action", "ARRIVE")));
            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 30);
            JsonNode r = reportNoShow(d.seller(), d.orderId());
            assertThat(r.path("status").asText()).isEqualTo("PENDING");
            assertThat(status(book(buyer, product(api.register()), inHours(30), null))).as("没有限制，照常下单").isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE user_id=?::uuid", Long.class, buyer.id())).isZero();
        }
    }

    // ================================================================== B 自动限制重算

    @Nested
    @DisplayName("7.1B 自动限制")
    class Recompute {

        @Test
        @DisplayName("B1. 自动限制保存 sourceType=SYSTEM_RULE、来源报告、规则版本、决定时间与依据的确认记录；本人在「我的限制」里看到这些（不含他人身份）")
        void provenance() throws Exception {
            User buyer = api.register();
            java.util.ArrayDeque<Deal> q = deals(buyer, 2);
            UUID first = acknowledged(q.poll());
            UUID second = acknowledged(q.poll());
            Map<String, Object> r = jdbc.queryForMap("SELECT * FROM user_restrictions WHERE no_show_report_id=?", second);
            assertThat(r).containsEntry("source", "SYSTEM_RULE").containsEntry("rule_version", "NO_SHOW_V1").containsEntry("scope", "BOOKING");
            assertThat(r.get("decided_at")).isEqualTo(r.get("starts_at"));
            assertThat(length((UUID) r.get("id"))).isEqualTo(Duration.ofHours(24));
            assertThat(jdbc.queryForList("SELECT no_show_report_id FROM user_restriction_basis WHERE restriction_id=? ORDER BY confirmed_at", UUID.class, r.get("id")))
                    .containsExactly(first, second);
            JsonNode mine = api.ok(api.get(buyer, "/v1/me/governance")).path("restrictions").get(0);
            assertThat(mine.path("source").asText()).isEqualTo("SYSTEM_RULE");
            assertThat(mine.path("ruleVersion").asText()).isEqualTo("NO_SHOW_V1");
            assertThat(mine.path("basis")).hasSize(2);
            assertThat(mine.toString()).doesNotContain(first.toString()).doesNotContain("reporter");
        }

        @Test
        @DisplayName("B2. 30 天窗口按确认时间计：35 天前确认的不计、10 天前确认的计入；见面发生得早但刚确认的也计入（写明口径：确认时间）")
        void windowByConfirmation() throws Exception {
            User buyer = api.register(), staff = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 3);
            UUID old = acknowledged(q.poll());
            SlotClock.confirmedDaysAgo(jdbc, old, 35);
            UUID recent = acknowledged(q.poll());
            SlotClock.confirmedDaysAgo(jdbc, recent, 10);
            // 第三次：报告后提出异议，档期本身发生在 35 天前（发生时间早于窗口），工作人员今天才确认（确认时间在窗口内）
            Deal d = q.poll();
            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 30);
            String report = reportNoShow(d.seller(), d.orderId()).path("id").asText();
            api.ok(api.post(buyer, "/v1/no-show-reports/" + report + "/dispute", Map.of("note", "有异议")));
            SlotClock.endedMinutesAgo(jdbc, d.orderId(), 35 * 24 * 60);
            api.ok(decide(staff, caseFor("NO_SHOW", report), "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null));
            UUID r = restrictionFrom(UUID.fromString(report));
            assertThat(length(r)).as("按确认时间：窗口内 2 次（10 天前 + 今天）→ 24 小时；35 天前确认的不计").isEqualTo(Duration.ofHours(24));
            assertThat(jdbc.queryForList("SELECT no_show_report_id FROM user_restriction_basis WHERE restriction_id=?", UUID.class, r))
                    .containsExactlyInAnyOrder(recent, UUID.fromString(report)).doesNotContain(old);
        }

        @Test
        @DisplayName("B3. 第二次被撤销后，第三次产生的 72 小时限制缩短为 24 小时：追加 SHORTENED 纠正，原动作与依据保留；第二次的限制撤销")
        void thirdShortened() throws Exception {
            User buyer = api.register(), staff = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 3);
            acknowledged(q.poll());
            UUID second = acknowledged(q.poll());
            UUID third = acknowledged(q.poll());
            UUID r2 = restrictionFrom(second), r3 = restrictionFrom(third);
            assertThat(length(r3)).isEqualTo(Duration.ofHours(72));
            api.ok(decideAppeal(staff, appealRestriction(buyer, r2), true));

            assertThat(jdbc.queryForObject("SELECT revoke_reason FROM user_restrictions WHERE id=?", String.class, r2)).isEqualTo("APPEAL_ACCEPTED");
            assertThat(jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?", String.class, second)).isEqualTo("REJECTED");
            assertThat(length(r3)).as("剩 2 次 → 24 小时").isEqualTo(Duration.ofHours(24));
            Map<String, Object> c = jdbc.queryForMap("SELECT * FROM user_restriction_corrections WHERE restriction_id=?", r3);
            assertThat(c).containsEntry("outcome", "SHORTENED").containsEntry("remaining_count", 2).containsEntry("cause_report_id", second)
                    .containsEntry("rule_version", "NO_SHOW_V1");
            assertThat(jdbc.queryForObject("SELECT last_correction_id FROM user_restrictions WHERE id=?", UUID.class, r3)).isEqualTo(c.get("id"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_basis WHERE restriction_id=?", Long.class, r3)).as("依据不删除").isEqualTo(3L);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE appeal_id IS NOT NULL", Long.class)).isPositive();
            JsonNode mine = api.ok(api.get(buyer, "/v1/me/governance")).path("restrictions");
            JsonNode view3 = null;
            for (JsonNode x : mine) if (x.path("id").asText().equals(r3.toString())) view3 = x;
            assertThat(view3.path("corrections").get(0).path("outcome").asText()).isEqualTo("SHORTENED");
            assertThat(view3.path("active").asBoolean()).isTrue();
            assertThat(bookingStatus(buyer)).as("仍在缩短后的 24 小时内").isEqualTo(403);
        }

        @Test
        @DisplayName("B4. 剩余计数只有 1 次时解除自动限制：申诉推翻一次工作人员确认 → 以它为依据的 24 小时限制 REVOKED（RULE_RECOMPUTED），可以重新下单")
        void revokedWhenOneLeft() throws Exception {
            User buyer = api.register(), confirmer = staff("MODERATOR"), reviewer = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 2);
            UUID first = staffConfirmed(q.poll(), confirmer);
            UUID second = acknowledged(q.poll());
            UUID r2 = restrictionFrom(second);
            assertThat(bookingStatus(buyer)).isEqualTo(403);
            String appeal = appealAction(buyer, confirmAction(first));
            assertThat(status(decideAppeal(confirmer, appeal, true))).as("原确认人不能决定").isEqualTo(403);
            api.ok(decideAppeal(reviewer, appeal, true));
            Map<String, Object> row = jdbc.queryForMap("SELECT revoked_at, revoke_reason, last_correction_id FROM user_restrictions WHERE id=?", r2);
            assertThat(row.get("revoke_reason")).isEqualTo("RULE_RECOMPUTED");
            assertThat(jdbc.queryForObject("SELECT outcome FROM user_restriction_corrections WHERE id=?", String.class, row.get("last_correction_id"))).isEqualTo("REVOKED");
            assertThat(jdbc.queryForObject("SELECT remaining_count FROM user_restriction_corrections WHERE id=?", Integer.class, row.get("last_correction_id"))).isEqualTo(1);
            assertThat(bookingStatus(buyer)).isEqualTo(200);
        }

        @Test
        @DisplayName("B5. 已到期的自动限制只保留审计：推翻其依据后行不变、不追加纠正")
        void expiredUntouched() throws Exception {
            User buyer = api.register(), confirmer = staff("MODERATOR"), reviewer = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 2);
            UUID first = staffConfirmed(q.poll(), confirmer);
            UUID r2 = restrictionFrom(acknowledged(q.poll()));
            jdbc.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) c -> {
                c.setAutoCommit(false);
                try (var s = c.createStatement()) {
                    s.execute("SET LOCAL session_replication_role = replica");
                    s.executeUpdate("UPDATE user_restrictions SET starts_at = now() - interval '3 days', ends_at = now() - interval '2 days', decided_at = now() - interval '3 days' WHERE id = '" + r2 + "'");
                    c.commit();
                } finally {
                    c.setAutoCommit(true);
                }
                return null;
            });
            Map<String, Object> before = jdbc.queryForMap("SELECT * FROM user_restrictions WHERE id=?", r2);
            api.ok(decideAppeal(reviewer, appealAction(buyer, confirmAction(first)), true));
            assertThat(jdbc.queryForMap("SELECT * FROM user_restrictions WHERE id=?", r2)).isEqualTo(before);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_corrections WHERE restriction_id=?", Long.class, r2)).isZero();
        }

        @Test
        @DisplayName("B6. 人工限制不受重算影响；B7. 多条限制并存时统一 Guard 按仍然有效的那条判断（自动的被撤销后，人工的仍然拦截，提示人工的到期时间）")
        void manualAndGuard() throws Exception {
            User buyer = api.register(), confirmer = staff("MODERATOR"), reviewer = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 2);
            UUID first = staffConfirmed(q.poll(), confirmer);
            UUID r2 = restrictionFrom(acknowledged(q.poll()));
            fileReport(api.register(), "USER", buyer.id(), "HARASSMENT");
            api.ok(decide(reviewer, caseFor("USER", buyer.id()), "RESTRICT_BOOKING", "HARASSMENT", 48));
            UUID manual = jdbc.queryForObject("SELECT id FROM user_restrictions WHERE user_id=?::uuid AND source='CASE'", UUID.class, buyer.id());
            Map<String, Object> manualBefore = jdbc.queryForMap("SELECT * FROM user_restrictions WHERE id=?", manual);

            api.ok(decideAppeal(reviewer, appealAction(buyer, confirmAction(first)), true));
            assertThat(jdbc.queryForObject("SELECT revoke_reason FROM user_restrictions WHERE id=?", String.class, r2)).isEqualTo("RULE_RECOMPUTED");
            assertThat(jdbc.queryForMap("SELECT * FROM user_restrictions WHERE id=?", manual)).as("人工限制原样").isEqualTo(manualBefore);
            MvcResult blocked = book(buyer, product(api.register()), inHours(30), null);
            assertThat(status(blocked)).isEqualTo(403);
            long manualEnds = ((java.sql.Timestamp) manualBefore.get("ends_at")).getTime();
            assertThat(api.body(blocked).path("data").path("endsAt").asLong()).isEqualTo(manualEnds);
        }

        @Test
        @DisplayName("B8. 只减轻不加重：推翻一次后剩余仍 ≥ 3 次 → 72 小时不变、不追加纠正")
        void neverHeavier() throws Exception {
            User buyer = api.register(), staff = staff("MODERATOR");
            java.util.ArrayDeque<Deal> q = deals(buyer, 4);
            acknowledged(q.poll());
            UUID second = acknowledged(q.poll());
            acknowledged(q.poll());
            UUID fourth = acknowledged(q.poll());
            UUID r4 = restrictionFrom(fourth);
            Map<String, Object> before = jdbc.queryForMap("SELECT ends_at FROM user_restrictions WHERE id=?", r4);
            api.ok(decideAppeal(staff, appealRestriction(buyer, restrictionFrom(second)), true));
            assertThat(jdbc.queryForMap("SELECT ends_at FROM user_restrictions WHERE id=?", r4)).isEqualTo(before);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_corrections WHERE restriction_id=?", Long.class, r4)).isZero();
            assertThatThrownBy(() -> jdbc.update("UPDATE user_restrictions SET ends_at = ends_at + interval '1 hour' WHERE id=?", r4))
                    .as("数据库也拒绝任何延长").isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE user_restrictions SET ends_at = ends_at - interval '1 hour' WHERE id=?", r4))
                    .as("没有纠正记录的缩短也被拒绝").isInstanceOf(DataAccessException.class);
        }
    }

    // ================================================================== C 利益回避

    @Nested
    @DisplayName("7.1C 利益回避")
    class Recusal {

        private void assertRecused(User staff, String caseId) throws Exception {
            for (MvcResult r : List.of(api.get(staff, "/v1/moderation/cases/" + caseId),
                    api.post(staff, "/v1/moderation/cases/" + caseId + "/claim", Map.of()),
                    decide(staff, caseId, "NO_ACTION", "INSUFFICIENT_EVIDENCE", null))) {
                assertThat(status(r)).isEqualTo(403);
                assertThat(api.body(r).path("data").path("code").asText()).isEqualTo("CONFLICT_OF_INTEREST");
            }
            assertThat(api.ok(api.get(staff, "/v1/moderation/cases?size=100")).path("items").toString()).as("不出现在本人队列").doesNotContain(caseId);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, caseId)).isEqualTo("OPEN");
        }

        @Test
        @DisplayName("C1～C4. 以本人为目标、本人的商品 / 评论 / 私信、本人参与的订单、本人提交的举报：本人查看 / 领取 / 结案一律 403 CONFLICT_OF_INTEREST，且不出现在本人队列；另一位工作人员可以处理")
        void ownThings() throws Exception {
            User a = staff("SENIOR_MODERATOR"), b = staff("MODERATOR"), other = api.register();
            fileReport(other, "USER", a.id(), "HARASSMENT");
            assertRecused(a, caseFor("USER", a.id()));

            String myProduct = product(a);
            fileReport(other, "PRODUCT", myProduct, "MISLEADING");
            assertRecused(a, caseFor("PRODUCT", myProduct));

            String comment = api.ok(api.post(a, "/v1/products/" + product(other) + "/comments", Map.of("content", "工作人员的留言"))).path("id").asText();
            fileReport(other, "COMMENT", comment, "SPAM");
            assertRecused(a, caseFor("COMMENT", comment));

            String conversation = api.ok(api.post(other, "/v1/conversations", Map.of("productId", myProduct))).path("id").asText();
            String msg = api.ok(api.post(a, "/v1/conversations/" + conversation + "/messages", Map.of("content", "工作人员的私信"))).path("id").asText();
            fileReport(other, "MESSAGE", msg, "HARASSMENT");
            assertRecused(a, caseFor("MESSAGE", msg));

            String order = api.order(a, product(other));
            fileReport(other, "ORDER", order, "FRAUD_SUSPECTED");
            assertRecused(a, caseFor("ORDER", order));

            User stranger = api.register();
            fileReport(a, "USER", stranger.id(), "SPAM");
            assertRecused(a, caseFor("USER", stranger.id()));

            assertThat(status(decide(b, caseFor("USER", a.id()), "NO_ACTION", "INSUFFICIENT_EVIDENCE", null))).as("另一位工作人员可以处理").isEqualTo(200);
            assertThat(status(api.post(a, "/v1/moderation/cases", Map.of("targetType", "PRODUCT", "targetId", myProduct)))).as("也不能为自己的内容立案").isEqualTo(403);
        }

        @Test
        @DisplayName("C5. 自己做出的处理的申诉：原处理人 403、不在其申诉队列；另一位工作人员可以决定")
        void ownActionAppeal() throws Exception {
            User a = staff("MODERATOR"), b = staff("MODERATOR"), target = api.register();
            fileReport(api.register(), "USER", target.id(), "HARASSMENT");
            api.ok(decide(a, caseFor("USER", target.id()), "RESTRICT_BOOKING", "HARASSMENT", 24));
            UUID restriction = jdbc.queryForObject("SELECT id FROM user_restrictions WHERE user_id=?::uuid", UUID.class, target.id());
            String appeal = appealRestriction(target, restriction);
            MvcResult own = decideAppeal(a, appeal, true);
            assertThat(status(own)).isEqualTo(403);
            assertThat(api.body(own).path("data").path("reason").asText()).isEqualTo("OWN_ACTION");
            assertThat(api.ok(api.get(a, "/v1/moderation/appeals?size=100")).path("items").toString()).doesNotContain(appeal);
            assertThat(api.ok(api.get(b, "/v1/moderation/appeals?size=100")).path("items").toString()).contains(appeal);
            api.ok(decideAppeal(b, appeal, false));
        }

        @Test
        @DisplayName("C6. 没有其他合适的工作人员：案件保持待处理（不自动驳回、本人不能绕过），举报人看到「等待可回避的工作人员」；新增一位后状态恢复")
        void noEligibleStaff() throws Exception {
            // 独立学校：只有一位工作人员，且案件以他为目标
            jdbc.update("INSERT INTO schools(id,name) VALUES ('rules-solo','单人学校') ON CONFLICT DO NOTHING");
            jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('单人校区','rules-solo','单人校区') ON CONFLICT DO NOTHING");
            User only = api.register("单人校区"), reporter = api.register("单人校区");
            jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'rules-solo', 'SENIOR_MODERATOR')", only.id());
            JsonNode mine = fileReport(reporter, "USER", only.id(), "HARASSMENT");
            assertThat(mine.path("status").asText()).isEqualTo("RECEIVED");
            assertThat(mine.path("awaitingEligibleStaff").asBoolean()).isTrue();
            String c = caseFor("USER", only.id());
            assertThat(status(decide(only, c, "NO_ACTION", "INSUFFICIENT_EVIDENCE", null))).isEqualTo(403);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, c)).isEqualTo("OPEN");
            assertThat(api.ok(api.get(reporter, "/v1/moderation-reports/mine")).get(0).path("awaitingEligibleStaff").asBoolean()).isTrue();

            User second = api.register("单人校区");
            jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'rules-solo', 'MODERATOR')", second.id());
            assertThat(api.ok(api.get(reporter, "/v1/moderation-reports/mine")).get(0).path("awaitingEligibleStaff").asBoolean()).isFalse();
            api.ok(decide(second, c, "NO_ACTION", "INSUFFICIENT_EVIDENCE", null));
        }

        @Test
        @DisplayName("C7. 自动 SYSTEM_RULE 限制（没有工作人员）可以申诉，由本校无利益冲突的工作人员决定；报告人本人是工作人员时不能决定")
        void systemRuleAppeal() throws Exception {
            User buyer = api.register(), reviewer = staff("MODERATOR");
            acknowledged(buyer);
            // 第二次：报告人恰好是工作人员
            User staffSeller = staff("MODERATOR");
            String order = api.order(buyer, product(staffSeller));
            api.ok(api.transition(staffSeller, order, "PENDING_MEETING"));
            SlotClock.endedMinutesAgo(jdbc, order, 30);
            String report = reportNoShow(staffSeller, order).path("id").asText();
            api.ok(api.post(buyer, "/v1/no-show-reports/" + report + "/acknowledge", Map.of()));
            UUID r = restrictionFrom(UUID.fromString(report));
            assertThat(jdbc.queryForObject("SELECT created_by FROM user_restrictions WHERE id=?", Object.class, r)).as("自动限制没有工作人员").isNull();
            JsonNode g = api.ok(api.get(buyer, "/v1/me/governance")).path("restrictions").get(0);
            assertThat(g.path("canAppeal").asBoolean()).isTrue();
            String appeal = appealRestriction(buyer, r);
            assertThat(status(decideAppeal(staffSeller, appeal, true))).as("报告人 / 订单一方回避").isEqualTo(403);
            JsonNode queue = api.ok(api.get(reviewer, "/v1/moderation/appeals?size=100")).path("items");
            JsonNode item = null;
            for (JsonNode x : queue) if (x.path("id").asText().equals(appeal)) item = x;
            assertThat(item.path("decidable").asBoolean()).isTrue();
            assertThat(item.path("subject").path("sourceType").asText()).isEqualTo("SYSTEM_RULE");
            api.ok(decideAppeal(reviewer, appeal, true));
            assertThat(jdbc.queryForObject("SELECT revoke_reason FROM user_restrictions WHERE id=?", String.class, r)).isEqualTo("APPEAL_ACCEPTED");
        }

        @Test
        @DisplayName("C8. 停用后下一请求立即失权；C9. 本校 / 他校 / 本人 / 他人 / 自动限制申诉矩阵")
        void matrix() throws Exception {
            User a = staff("MODERATOR"), b = staff("MODERATOR");
            User lakeStaff = api.register(LAKE);
            jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'rules-lake', 'SENIOR_MODERATOR')", lakeStaff.id());
            User target = api.register();
            fileReport(api.register(), "USER", target.id(), "SPAM");
            String c = caseFor("USER", target.id());
            api.ok(decide(a, c, "RESTRICT_PUBLISHING", "POLICY_VIOLATION", 24));
            UUID manual = jdbc.queryForObject("SELECT id FROM user_restrictions WHERE user_id=?::uuid", UUID.class, target.id());
            String manualAppeal = appealRestriction(target, manual);
            User auto = api.register();
            java.util.ArrayDeque<Deal> q = deals(auto, 2);
            acknowledged(q.poll());
            String autoAppeal = appealRestriction(auto, restrictionFrom(acknowledged(q.poll())));
            String selfAppeal;
            {
                // 工作人员 b 自己被限制并提出申诉
                fileReport(api.register(), "USER", b.id(), "SPAM");
                api.ok(decide(a, caseFor("USER", b.id()), "RESTRICT_CIRCLE_CREATION", "POLICY_VIOLATION", 24));
                selfAppeal = appealRestriction(b, jdbc.queryForObject("SELECT id FROM user_restrictions WHERE user_id=?::uuid", UUID.class, b.id()));
            }
            // 期望：本校他人 → 可决定；他校 → 404；本人做出的处理 → 403；本人的申诉 → 403；自动限制 → 本校无冲突者可决定
            assertThat(status(decideAppeal(lakeStaff, manualAppeal, true))).as("他校").isEqualTo(404);
            assertThat(status(api.get(lakeStaff, "/v1/moderation/cases/" + c))).as("他校案件").isEqualTo(404);
            assertThat(status(decideAppeal(a, manualAppeal, true))).as("本人做出的处理").isEqualTo(403);
            assertThat(status(decideAppeal(b, selfAppeal, true))).as("本人的申诉").isEqualTo(403);
            assertThat(status(decideAppeal(b, manualAppeal, false))).as("本校他人").isEqualTo(200);
            assertThat(status(decideAppeal(a, autoAppeal, false))).as("自动限制 / 本校无冲突").isEqualTo(200);
            // 停用：下一请求立即失权
            jdbc.update("UPDATE staff_members SET active=false, updated_at=clock_timestamp() WHERE user_id=?::uuid", a.id());
            assertThat(status(api.get(a, "/v1/moderation/cases"))).isEqualTo(403);
            assertThat(status(decideAppeal(a, selfAppeal, false))).isEqualTo(403);
            assertThat(api.ok(api.get(a, "/v1/me/staff")).path("staff").asBoolean()).isFalse();
        }
    }

    // ================================================================== D 邀请幂等边界

    @Nested
    @DisplayName("7.1D 邀请幂等边界")
    class Invites {

        private MvcResult redeem(User who, String token) throws Exception {
            return api.post(who, "/v1/circle-invites/redeem", Map.of("token", token));
        }

        @Test
        @DisplayName("D1～D5. 已在籍用户：同圈有效邀请 → 200 且不消耗；随机码 / 过期 / 撤销 / 他校邀请码 → 同一个 404（即使用户已在某个圈子里）")
        void boundaries() throws Exception {
            User owner = api.register(), member = api.register();
            String circle = api.createCircle(owner, "边界圈" + UUID.randomUUID().toString().substring(0, 8), "PRIVATE");
            api.join(owner, circle, member);

            String valid = api.inviteToken(owner, circle);
            assertThat(status(redeem(member, valid))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_invites WHERE circle_id=?::uuid AND status='PENDING'", Long.class, circle))
                    .as("有效邀请未被消耗").isEqualTo(1L);

            MvcResult random = redeem(member, "random-" + UUID.randomUUID());
            assertThat(status(random)).isEqualTo(404);
            String notFound = api.body(random).path("message").asText();

            String expired = api.inviteToken(owner, circle);
            jdbc.update("UPDATE circle_invites SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE circle_id=?::uuid AND status='PENDING' AND created_at > now() - interval '1 minute'", circle);
            MvcResult e = redeem(member, expired);
            assertThat(status(e)).as("过期").isEqualTo(404);
            assertThat(api.body(e).path("message").asText()).isEqualTo(notFound);

            String revoked = api.inviteToken(owner, circle);
            String revokedId = jdbc.queryForObject("SELECT id::text FROM circle_invites WHERE circle_id=?::uuid AND status='PENDING' ORDER BY created_at DESC LIMIT 1", String.class, circle);
            api.ok(api.post(owner, "/v1/circle-invites/" + revokedId + "/revoke", Map.of()));
            assertThat(status(redeem(member, revoked))).as("撤销").isEqualTo(404);

            User lakeOwner = api.register(LAKE);
            String lakeCircle = api.createCircle(lakeOwner, "他校圈" + UUID.randomUUID().toString().substring(0, 8), "PRIVATE");
            assertThat(status(redeem(member, api.inviteToken(lakeOwner, lakeCircle)))).as("他校").isEqualTo(404);
        }

        @Test
        @DisplayName("D6～D7. 原兑换者重放已兑换的码 → 200（不重复加入）；他人拿同一码 → 404；原兑换者退出后再用 → 404；另一个圈子的有效码照常加入那个圈子")
        void replay() throws Exception {
            User owner = api.register(), member = api.register(), other = api.register();
            String circle = api.createCircle(owner, "重放圈" + UUID.randomUUID().toString().substring(0, 8), "PRIVATE");
            String token = api.inviteToken(owner, circle);
            assertThat(status(redeem(member, token))).isEqualTo(200);
            assertThat(status(redeem(member, token))).as("原兑换者重放").isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND user_id=?::uuid", Long.class, circle, member.id())).isEqualTo(1L);
            assertThat(status(redeem(other, token))).as("他人").isEqualTo(404);
            api.ok(api.delete(member, "/v1/circles/" + circle + "/members/" + member.id()));
            assertThat(status(redeem(member, token))).as("退出后不能用旧码重新加入").isEqualTo(404);

            String second = api.createCircle(owner, "另一个圈" + UUID.randomUUID().toString().substring(0, 8), "PRIVATE");
            api.join(owner, circle, other);
            assertThat(status(redeem(other, api.inviteToken(owner, second)))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND user_id=?::uuid AND status='ACTIVE'", Long.class, second, other.id())).isEqualTo(1L);
        }
    }

    // ================================================================== E 内容处置

    @Nested
    @DisplayName("7.1E 内容处置")
    class Content {

        @Test
        @DisplayName("E1～E4. 评论隐藏 / 恢复：只有本校工作人员；普通接口对任何人不返回正文，作者看到明确提示；原文保留、不能删除或改写；动作追加审计；作者申诉由另一位工作人员恢复")
        void comments() throws Exception {
            User author = api.register(), viewer = api.register(), seller = api.register();
            User a = staff("MODERATOR"), b = staff("MODERATOR");
            User lakeStaff = api.register(LAKE);
            jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'rules-lake', 'MODERATOR')", lakeStaff.id());
            String p = product(seller);
            String comment = api.ok(api.post(author, "/v1/products/" + p + "/comments", Map.of("content", "需要隐藏的留言原文"))).path("id").asText();
            fileReport(viewer, "COMMENT", comment, "HARASSMENT");
            String c = caseFor("COMMENT", comment);
            assertThat(status(decide(viewer, c, "HIDE_COMMENT", "HARASSMENT", null))).as("普通用户").isEqualTo(403);
            assertThat(status(decide(lakeStaff, c, "HIDE_COMMENT", "HARASSMENT", null))).as("他校工作人员").isEqualTo(404);
            assertThat(api.ok(api.get(a, "/v1/moderation/cases/" + c)).path("allowedActions").toString()).contains("HIDE_COMMENT");
            api.ok(decide(a, c, "HIDE_COMMENT", "HARASSMENT", null));

            for (User u : List.of(viewer, seller, author)) {
                JsonNode list = api.ok(api.get(u, "/v1/products/" + p + "/comments"));
                assertThat(list.toString()).doesNotContain("需要隐藏的留言原文");
                assertThat(list.get(0).path("moderationHidden").asBoolean()).isTrue();
                assertThat(list.get(0).path("hiddenForAuthor").asBoolean()).isEqualTo(u == author);
            }
            assertThat(jdbc.queryForObject("SELECT content FROM comments WHERE id=?::uuid", String.class, comment)).as("原文保留").isEqualTo("需要隐藏的留言原文");
            assertThatThrownBy(() -> jdbc.update("DELETE FROM comments WHERE id=?::uuid", comment)).isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE comments SET content='改写' WHERE id=?::uuid", comment)).isInstanceOf(DataAccessException.class);
            UUID hide = jdbc.queryForObject("SELECT id FROM moderation_actions WHERE action_code='HIDE_COMMENT' AND target_id=?::uuid", UUID.class, comment);
            assertThat(jdbc.queryForObject("SELECT subject_user_id::text FROM moderation_actions WHERE id=?", String.class, hide)).isEqualTo(author.id());

            JsonNode notice = null;
            for (JsonNode n : api.ok(api.get(author, "/v1/me/governance")).path("notices")) if (n.path("actionId").asText().equals(hide.toString())) notice = n;
            assertThat(notice.path("actionCode").asText()).isEqualTo("HIDE_COMMENT");
            assertThat(notice.path("canAppeal").asBoolean()).isTrue();
            assertThat(status(api.post(viewer, "/v1/me/appeals", Map.of("actionId", hide.toString(), "reason", "不是我的")))).as("他人不能申诉").isEqualTo(404);
            String appeal = appealAction(author, hide);
            assertThat(status(decideAppeal(a, appeal, true))).as("原处理人回避").isEqualTo(403);
            api.ok(decideAppeal(b, appeal, true));
            assertThat(api.ok(api.get(viewer, "/v1/products/" + p + "/comments")).get(0).path("content").asText()).isEqualTo("需要隐藏的留言原文");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE action_code='RESTORE_COMMENT' AND target_id=?::uuid AND appeal_id IS NOT NULL", Long.class, comment)).isEqualTo(1L);
        }

        @Test
        @DisplayName("E5～E7. 单条私信隔离：只隔离被举报的那一条，双方看到占位、看不到正文；会话与其他消息照常，可以继续沟通；工作人员只在案件举报快照里看到这一条；"
                + "只限制作者不会被当成已处理内容；发送者申诉后由另一位工作人员解除")
        void messages() throws Exception {
            User seller = api.register(), buyer = api.register(), a = staff("MODERATOR"), b = staff("MODERATOR");
            String p = product(seller);
            String conv = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", p))).path("id").asText();
            api.ok(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("content", "正常的第一条")));
            String bad = api.ok(api.post(seller, "/v1/conversations/" + conv + "/messages", Map.of("content", "被举报的那一条"))).path("id").asText();
            api.ok(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("content", "正常的第三条")));
            fileReport(buyer, "MESSAGE", bad, "HARASSMENT");
            String c = caseFor("MESSAGE", bad);

            JsonNode detail = api.ok(api.get(a, "/v1/moderation/cases/" + c));
            assertThat(detail.toString()).contains("被举报的那一条").doesNotContain("正常的第一条").doesNotContain("正常的第三条");
            // 只限制作者：私信照常显示（限制不是内容处置）
            api.ok(decide(a, c, "RESTRICT_BOOKING", "HARASSMENT", 24));
            assertThat(api.ok(api.get(buyer, "/v1/conversations/" + conv + "/messages")).toString()).contains("被举报的那一条");

            // 第一个案件已结（只限制了作者）；工作人员 b 就同一条私信另立案件做内容处置
            String second = api.ok(api.post(b, "/v1/moderation/cases", Map.of("targetType", "MESSAGE", "targetId", bad))).path("id").asText();
            assertThat(second).isNotEqualTo(c);
            api.ok(decide(b, second, "QUARANTINE_MESSAGE", "HARASSMENT", null));
            for (User u : List.of(seller, buyer)) {
                JsonNode list = api.ok(api.get(u, "/v1/conversations/" + conv + "/messages"));
                assertThat(list).hasSize(3);
                assertThat(list.toString()).doesNotContain("被举报的那一条").contains("正常的第一条").contains("正常的第三条");
                assertThat(list.get(1).path("quarantined").asBoolean()).isTrue();
            }
            assertThat(status(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("content", "继续沟通")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT content FROM messages WHERE id=?::uuid", String.class, bad)).isEqualTo("被举报的那一条");
            assertThatThrownBy(() -> jdbc.update("DELETE FROM messages WHERE id=?::uuid", bad)).isInstanceOf(DataAccessException.class);

            UUID q = jdbc.queryForObject("SELECT id FROM moderation_actions WHERE action_code='QUARANTINE_MESSAGE' AND target_id=?::uuid", UUID.class, bad);
            String appeal = appealAction(seller, q);
            assertThat(status(decideAppeal(b, appeal, true))).as("原处理人回避").isEqualTo(403);
            api.ok(decideAppeal(a, appeal, true));
            assertThat(api.ok(api.get(buyer, "/v1/conversations/" + conv + "/messages")).toString()).contains("被举报的那一条");
        }
    }
}
