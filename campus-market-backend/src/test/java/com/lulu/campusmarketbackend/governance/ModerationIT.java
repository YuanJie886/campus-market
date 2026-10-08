package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
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
 * 模块 7.3～7.5 / 9 / 10 / 12：工作人员、举报与案件、治理动作、用户限制与申诉的 HTTP 行为测试。
 * 工作人员只通过测试夹具（受控 SQL）创建，没有任何默认账号。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.moderation-report.limit=500",
        "campus-market.rate-limit.appeal-submit.limit=100",
        "campus-market.rate-limit.circle-create.limit=100",
        "campus-market.rate-limit.circle-invite-create.limit=200",
        "campus-market.rate-limit.circle-invite-redeem.limit=200",
        "campus-market.rate-limit.listing-batch-publish.limit=100",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class ModerationIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_moderation").withUsername("campus_moderation").withPassword("campus_moderation_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "moderation-it-secret-0123456789abcdefg");
    }

    private static final String LAKE = "治理湖畔校区";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
        jdbc.update("INSERT INTO schools(id,name) VALUES ('mod-lake','治理湖畔学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES (?, 'mod-lake', ?) ON CONFLICT DO NOTHING", LAKE, LAKE);
    }

    /** 受控 SQL 夹具：与运维手册里配置首个工作人员的语句相同。 */
    private User staff(String role) throws Exception {
        User u = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
        return u;
    }

    private String product(User seller, String title) throws Exception {
        return api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", title, 20))).path("id").asText();
    }

    private JsonNode report(User who, String type, String id, String reason) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("targetType", type);
        b.put("targetId", id);
        b.put("reasonCode", reason);
        return api.ok(api.post(who, "/v1/moderation-reports", b));
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

    private static Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return b;
    }

    @Nested
    @DisplayName("7.3 工作人员")
    class Staff {
        @Test
        @DisplayName("1. 迁移后没有任何工作人员；非工作人员访问 /v1/moderation/* 一律 403；权限每次从数据库读取，停用立即生效；注册接口不能创建工作人员")
        void noDefaultStaff() throws Exception {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_members WHERE user_id NOT IN (SELECT id FROM users WHERE account LIKE 'sp%')", Long.class))
                    .as("没有植入任何默认管理员").isZero();
            User normal = api.register();
            assertThat(api.ok(api.get(normal, "/v1/me/staff")).path("staff").asBoolean()).isFalse();
            for (MvcResult r : List.of(api.get(normal, "/v1/moderation/cases"), api.get(normal, "/v1/moderation/appeals"),
                    api.get(normal, "/v1/moderation/cases/" + UUID.randomUUID()),
                    api.post(normal, "/v1/moderation/cases", Map.of("targetType", "USER", "targetId", normal.id())),
                    api.post(normal, "/v1/moderation/cases/" + UUID.randomUUID() + "/decision", Map.of("action", "NO_ACTION", "reasonCode", "OTHER")))) {
                assertThat(status(r)).isEqualTo(403);
                assertThat(api.body(r).path("requestId").asText()).isNotBlank();
            }
            Map<String, Object> reg = new LinkedHashMap<>();
            reg.put("account", "staffy" + UUID.randomUUID().toString().substring(0, 8));
            reg.put("password", "test-password-2026");
            reg.put("nickname", "想当管理员");
            reg.put("campus", "东校区");
            reg.put("role", "SENIOR_MODERATOR");
            assertThat(status(api.post(null, "/v1/auth/register", reg))).as("注册接口不接受角色字段").isEqualTo(400);

            User s = staff("MODERATOR");
            assertThat(api.ok(api.get(s, "/v1/me/staff")).path("role").asText()).isEqualTo("MODERATOR");
            assertThat(status(api.get(s, "/v1/moderation/cases"))).isEqualTo(200);
            jdbc.update("UPDATE staff_members SET active=false WHERE user_id=?::uuid", s.id());
            assertThat(status(api.get(s, "/v1/moderation/cases"))).as("同一个 JWT，停用后立即 403").isEqualTo(403);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM staff_members WHERE user_id=?::uuid", s.id())).isInstanceOf(DataAccessException.class);
            User lake = api.register(LAKE);
            assertThatThrownBy(() -> jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'MODERATOR')", lake.id()))
                    .as("工作人员只能属于本人所在学校").isInstanceOf(DataAccessException.class);
        }

        @Test
        @DisplayName("2. 工作人员只能处理本校：他校案件列表不可见、详情 / 领取 / 结案 404；本校工作人员看不到他校案件")
        void schoolScoped() throws Exception {
            User seller = api.register(), reporter = api.register();
            String p = product(seller, "跨校治理");
            report(reporter, "PRODUCT", p, "MISLEADING");
            String caseId = caseFor("PRODUCT", p);
            User lakeStaff = api.register(LAKE);
            jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'mod-lake', 'SENIOR_MODERATOR')", lakeStaff.id());
            JsonNode list = api.ok(api.get(lakeStaff, "/v1/moderation/cases"));
            assertThat(list.toString()).doesNotContain(caseId);
            assertThat(status(api.get(lakeStaff, "/v1/moderation/cases/" + caseId))).isEqualTo(404);
            assertThat(status(api.post(lakeStaff, "/v1/moderation/cases/" + caseId + "/claim", Map.of()))).isEqualTo(404);
            assertThat(status(decide(lakeStaff, caseId, "NO_ACTION", "OTHER", null))).isEqualTo(404);
            assertThat(status(api.post(lakeStaff, "/v1/moderation/cases", Map.of("targetType", "PRODUCT", "targetId", p)))).isEqualTo(404);
            User pilotStaff = staff("MODERATOR");
            assertThat(api.ok(api.get(pilotStaff, "/v1/moderation/cases?status=OPEN")).toString()).contains(caseId);
        }
    }

    @Nested
    @DisplayName("7.4 举报与隐私")
    class Reports {
        @Test
        @DisplayName("3. 举报接口不能枚举：私密商品 / 私密圈子 / 他人订单 / 不存在的 ID 返回同一个 404；举报自己的商品 400；重复举报幂等")
        void noEnumeration() throws Exception {
            User owner = api.register(), stranger = api.register();
            String circle = api.createCircle(owner, "私密治理圈", "PRIVATE");
            String secret = api.circleProduct(owner, "私密治理商品", circle);
            String missing = UUID.randomUUID().toString();
            Map<String, String> probes = new LinkedHashMap<>();
            probes.put("PRODUCT", secret);
            probes.put("CIRCLE", circle);
            String message = null;
            for (Map.Entry<String, String> e : probes.entrySet()) {
                MvcResult hidden = api.post(stranger, "/v1/moderation-reports", Map.of("targetType", e.getKey(), "targetId", e.getValue(), "reasonCode", "SPAM"));
                MvcResult none = api.post(stranger, "/v1/moderation-reports", Map.of("targetType", e.getKey(), "targetId", missing, "reasonCode", "SPAM"));
                assertThat(status(hidden)).isEqualTo(404);
                assertThat(status(none)).isEqualTo(404);
                assertThat(api.body(hidden).path("message").asText()).isEqualTo(api.body(none).path("message").asText());
                message = api.body(hidden).path("message").asText();
            }
            assertThat(message).isNotBlank();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_cases WHERE target_id IN (?::uuid, ?::uuid)", Long.class, secret, circle)).isZero();
            String mine = product(owner, "自己的商品");
            assertThat(status(api.post(owner, "/v1/moderation-reports", Map.of("targetType", "PRODUCT", "targetId", mine, "reasonCode", "SPAM")))).isEqualTo(400);
            JsonNode first = report(stranger, "PRODUCT", mine, "SPAM");
            JsonNode again = report(stranger, "PRODUCT", mine, "SPAM");
            assertThat(again.path("id").asText()).isEqualTo(first.path("id").asText());
            assertThat(jdbc.queryForObject("SELECT report_count FROM moderation_cases WHERE id=?::uuid", Integer.class, caseFor("PRODUCT", mine))).isEqualTo(1);
            for (String bad : List.of("groupBy", "reporterId", "schoolId")) {
                Map<String, Object> b = new LinkedHashMap<>(Map.of("targetType", "PRODUCT", "targetId", mine, "reasonCode", "SPAM"));
                b.put(bad, "x");
                assertThat(status(api.post(stranger, "/v1/moderation-reports", b))).as(bad).isEqualTo(400);
            }
        }

        @Test
        @DisplayName("4. 举报人身份保密：被举报人只看到限制与原因码；工作人员视图也没有举报人、联系方式、确认码或会话全文；消息举报只快照那一条消息；举报人只看到状态摘要")
        void reporterPrivacy(CapturedOutput output) throws Exception {
            User seller = api.register(), buyer = api.register(), reporter = api.register();
            String p = product(seller, "私信骚扰测试");
            String order = api.order(buyer, p);
            String code = jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, order);
            String conversation = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", p))).path("id").asText();
            api.ok(api.post(seller, "/v1/conversations/" + conversation + "/messages", Map.of("content", "第一条正常消息")));
            String bad = api.ok(api.post(seller, "/v1/conversations/" + conversation + "/messages", Map.of("content", "这是一条骚扰消息"))).path("id").asText();
            api.ok(api.post(seller, "/v1/conversations/" + conversation + "/messages", Map.of("content", "之后的另一条消息")));
            report(buyer, "MESSAGE", bad, "HARASSMENT");
            report(reporter, "PRODUCT", p, "MISLEADING");
            assertThat(status(api.post(reporter, "/v1/moderation-reports", Map.of("targetType", "MESSAGE", "targetId", bad, "reasonCode", "HARASSMENT"))))
                    .as("不在会话里的人不能举报这条消息").isEqualTo(404);

            User s = staff("MODERATOR");
            String messageCase = caseFor("MESSAGE", bad);
            JsonNode detail = api.ok(api.get(s, "/v1/moderation/cases/" + messageCase));
            String raw = detail.toString();
            assertThat(raw).contains("这是一条骚扰消息").doesNotContain("第一条正常消息").doesNotContain("之后的另一条消息");
            assertThat(raw).doesNotContain(buyer.id()).doesNotContain(reporter.id()).doesNotContain("13800000000").doesNotContain(code)
                    .doesNotContain("password").doesNotContain("token").doesNotContain("account");
            api.ok(decide(s, messageCase, "RESTRICT_BOOKING", "HARASSMENT", 24));

            JsonNode sellerView = api.ok(api.get(seller, "/v1/me/governance"));
            assertThat(sellerView.path("restrictions")).hasSize(1);
            assertThat(sellerView.path("restrictions").get(0).path("scope").asText()).isEqualTo("BOOKING");
            assertThat(sellerView.toString()).doesNotContain(buyer.id()).doesNotContain(s.id()).doesNotContain("HARASSMENT_REPORT");
            JsonNode mine = api.ok(api.get(buyer, "/v1/moderation-reports/mine"));
            assertThat(mine.get(0).path("status").asText()).isEqualTo("CLOSED");
            assertThat(mine.get(0).path("outcome").asText()).isEqualTo("ACTION_TAKEN");
            assertThat(mine.toString()).doesNotContain("RESTRICT").doesNotContain(s.id()).doesNotContain("durationHours");
            assertThat(api.ok(api.get(reporter, "/v1/users/" + seller.id())).toString()).doesNotContain("restrict").doesNotContain("BOOKING");
            assertThat(api.ok(api.get(reporter, "/v1/users/" + seller.id() + "/trade-summary")).toString()).doesNotContain("restrict");
            // 日志里没有消息正文、确认码或令牌
            assertThat(output.getAll()).doesNotContain("这是一条骚扰消息").doesNotContain(code).doesNotContain(buyer.token()).doesNotContain(s.token());
        }
    }

    @Nested
    @DisplayName("7.5 / 10 用户限制")
    class Restrictions {
        @Test
        @DisplayName("5. BOOKING 只禁止新订单：已有订单的接单、取消、消息照常；PUBLISHING 禁止单件 / 打包 / 批量发布，允许保存草稿与下架；CIRCLE_CREATION 只禁止新建圈子")
        void everyEntryPoint() throws Exception {
            User target = api.register(), other = api.register(), reporter = api.register();
            User s = staff("MODERATOR");
            String theirs = product(other, "别人的商品");
            String existingOrder = api.order(target, product(other, "受限前的订单"));
            String myProduct = product(target, "受限者自己的商品");
            String myCircle = api.createCircle(target, "受限者的圈子", "PRIVATE");
            String draft = api.createDraft(target, "SINGLE", SupplyApi.single("其他", "草稿", 10)).path("id").asText();
            report(reporter, "USER", target.id(), "FRAUD_SUSPECTED");
            String caseId = caseFor("USER", target.id());
            api.ok(decide(s, caseId, "RESTRICT_BOOKING", "FRAUD_RISK", 48));
            // 同一目标的第二个案件：施加另外两种限制
            for (String action : List.of("RESTRICT_PUBLISHING", "RESTRICT_CIRCLE_CREATION")) {
                String c = api.ok(api.post(s, "/v1/moderation/cases", Map.of("targetType", "USER", "targetId", target.id()))).path("id").asText();
                api.ok(decide(s, c, action, "POLICY_VIOLATION", 48));
            }

            MvcResult booking = api.post(target, "/v1/orders", orderBody(theirs));
            assertThat(status(booking)).isEqualTo(403);
            assertThat(api.body(booking).path("data").path("scope").asText()).isEqualTo("BOOKING");
            assertThat(status(api.transition(other, existingOrder, "PENDING_MEETING"))).as("已有订单照常推进").isEqualTo(200);
            String conversation = api.ok(api.post(target, "/v1/conversations", Map.of("productId", theirs))).path("id").asText();
            assertThat(status(api.post(target, "/v1/conversations/" + conversation + "/messages", Map.of("content", "受限期间仍能沟通")))).isEqualTo(200);
            assertThat(status(api.post(target, "/v1/orders/" + existingOrder + "/transitions", Map.of("to", "CANCELLED", "reasonCode", "SCHEDULE_CONFLICT"))))
                    .as("已有订单照常取消").isEqualTo(200);

            assertThat(status(api.post(target, "/v1/products", SupplyApi.single("其他", "受限发布", 10)))).isEqualTo(403);
            assertThat(status(api.post(target, "/v1/products", SupplyApi.bundle("受限打包", 30, 2)))).isEqualTo(403);
            assertThat(status(api.saveDraft(target, draft, 1, SupplyApi.single("其他", "草稿照常保存", 10), null))).isEqualTo(200);
            String batch = api.ok(api.post(target, "/v1/listing-batches", Map.of("draftIds", List.of(draft)))).path("id").asText();
            assertThat(status(api.publish(target, batch, "restricted-publish-key"))).isEqualTo(403);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title='草稿照常保存'", Long.class)).isZero();
            assertThat(status(api.post(target, "/v1/products/" + myProduct + "/status", Map.of("status", "已下架")))).as("下架不受影响").isEqualTo(200);

            assertThat(status(api.post(target, "/v1/circles", Map.of("type", "CLUB", "name", "受限新圈子")))).isEqualTo(403);
            assertThat(status(api.post(target, "/v1/circles/" + myCircle + "/invites", Map.of()))).as("已有圈子照常管理").isEqualTo(200);
            assertThat(status(api.get(target, "/v1/products?keyword=别人的商品"))).as("浏览不受影响").isEqualTo(200);
        }

        @Test
        @DisplayName("6. 期限：最长 30 天、没有永久限制；MODERATOR 最多 7 天，更长需要 SENIOR_MODERATOR；到期自动失效；限制不可删除、除撤销外不可改")
        void durations() throws Exception {
            User target = api.register(), reporter = api.register();
            User mod = staff("MODERATOR"), senior = staff("SENIOR_MODERATOR");
            report(reporter, "USER", target.id(), "SPAM");
            String caseId = caseFor("USER", target.id());
            assertThat(status(decide(mod, caseId, "RESTRICT_BOOKING", "POLICY_VIOLATION", null))).as("必须给期限").isEqualTo(400);
            assertThat(status(decide(mod, caseId, "RESTRICT_BOOKING", "POLICY_VIOLATION", 721))).isEqualTo(400);
            assertThat(status(decide(mod, caseId, "RESTRICT_BOOKING", "POLICY_VIOLATION", 169))).isEqualTo(403);
            assertThat(status(decide(senior, caseId, "RESTRICT_BOOKING", "POLICY_VIOLATION", 720))).isEqualTo(200);
            Map<String, Object> r = jdbc.queryForMap("SELECT id, extract(epoch FROM ends_at - starts_at) / 86400 AS days FROM user_restrictions WHERE user_id=?::uuid", target.id());
            assertThat(((Number) r.get("days")).doubleValue()).isEqualTo(30.0);
            assertThatThrownBy(() -> jdbc.update("UPDATE user_restrictions SET ends_at = ends_at + interval '1 day' WHERE id=?", r.get("id"))).isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM user_restrictions WHERE id=?", r.get("id"))).isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at) "
                    + "VALUES (gen_random_uuid(), ?::uuid, 'pilot', 'BOOKING', 'CASE', ?::uuid, ?::uuid, 'OTHER', now(), now() + interval '31 days')",
                    target.id(), caseId, senior.id())).as("数据库也不允许超过 30 天").isInstanceOf(DataAccessException.class);
            // 到期自动失效：一条已经过去的限制不再生效
            User expired = api.register();
            jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at) "
                    + "VALUES (gen_random_uuid(), ?::uuid, 'pilot', 'BOOKING', 'CASE', ?::uuid, ?::uuid, 'OTHER', now() - interval '3 days', now() - interval '1 day')",
                    expired.id(), caseId, senior.id());
            User seller = api.register();
            assertThat(status(api.post(expired, "/v1/orders", orderBody(product(seller, "到期后可以下单"))))).isEqualTo(200);
            assertThat(api.ok(api.get(expired, "/v1/me/governance")).path("restrictions").get(0).path("active").asBoolean()).isFalse();
        }
    }

    @Nested
    @DisplayName("9 治理动作、结案与申诉")
    class Actions {
        @Test
        @DisplayName("7. 隐藏商品：他人列表与详情都看不到（与不存在相同），卖家仍能看到，已成立订单的对方仍能读取；动作只增不改；一个案件只有一个结果")
        void hideProduct() throws Exception {
            User seller = api.register(), buyer = api.register(), viewer = api.register(), reporter = api.register();
            String p = product(seller, "违规商品" + UUID.randomUUID().toString().substring(0, 6));
            String title = jdbc.queryForObject("SELECT title FROM products WHERE id=?::uuid", String.class, p);
            String order = api.order(buyer, p);
            report(reporter, "PRODUCT", p, "PROHIBITED_ITEM");
            String caseId = caseFor("PRODUCT", p);
            User a = staff("MODERATOR"), b = staff("MODERATOR");
            assertThat(status(api.post(a, "/v1/moderation/cases/" + caseId + "/claim", Map.of()))).isEqualTo(200);
            assertThat(status(decide(b, caseId, "HIDE_PRODUCT", "PROHIBITED_ITEM", null))).as("已被他人领取").isEqualTo(409);
            JsonNode done = api.ok(decide(a, caseId, "HIDE_PRODUCT", "PROHIBITED_ITEM", null));
            assertThat(done.path("status").asText()).isEqualTo("RESOLVED");
            assertThat(status(decide(a, caseId, "NO_ACTION", "OTHER", null))).as("一个案件只有一个最终结果").isEqualTo(409);

            assertThat(status(api.get(viewer, "/v1/products/" + p))).isEqualTo(404);
            assertThat(api.ok(api.get(viewer, "/v1/products?keyword=" + title)).path("total").asLong()).isZero();
            assertThat(api.ok(api.get(seller, "/v1/products/" + p)).path("moderationHidden").asBoolean()).as("卖家看到自己的商品被隐藏").isTrue();
            assertThat(api.ok(api.get(buyer, "/v1/products/" + p)).has("moderationHidden")).as("隐藏状态不告诉其他人").isFalse();
            assertThat(status(api.get(buyer, "/v1/products/" + p))).as("已成立订单不被锁死").isEqualTo(200);
            assertThat(status(api.post(buyer, "/v1/orders/" + order + "/transitions", Map.of("to", "CANCELLED")))).isEqualTo(200);

            String actionId = jdbc.queryForObject("SELECT id::text FROM moderation_actions WHERE case_id=?::uuid", String.class, caseId);
            assertThatThrownBy(() -> jdbc.update("UPDATE moderation_actions SET note='改写' WHERE id=?::uuid", actionId)).isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM moderation_actions WHERE id=?::uuid", actionId)).isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE moderation_cases SET resolution_code='NO_ACTION' WHERE id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);

            // 卖家申诉一次；做出隐藏的工作人员不能处理自己的申诉；另一位工作人员接受后商品恢复
            JsonNode g = api.ok(api.get(seller, "/v1/me/governance"));
            assertThat(g.path("notices").get(0).path("canAppeal").asBoolean()).isTrue();
            assertThat(g.toString()).doesNotContain(reporter.id()).doesNotContain(a.id());
            String appeal = api.ok(api.post(seller, "/v1/me/appeals", Map.of("actionId", actionId, "reason", "这件商品并不违规"))).path("id").asText();
            assertThat(status(api.post(seller, "/v1/me/appeals", Map.of("actionId", actionId, "reason", "再申诉一次")))).isEqualTo(409);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, caseId)).isEqualTo("APPEALED");
            Map<String, Object> accept = Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED");
            assertThat(status(api.post(a, "/v1/moderation/appeals/" + appeal + "/decision", accept))).isEqualTo(403);
            assertThat(api.ok(api.post(b, "/v1/moderation/appeals/" + appeal + "/decision", accept)).path("status").asText()).isEqualTo("ACCEPTED");
            assertThat(status(api.get(viewer, "/v1/products/" + p))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, caseId)).isEqualTo("RESOLVED");
            assertThat(jdbc.queryForList("SELECT action_code FROM moderation_actions WHERE case_id=?::uuid ORDER BY created_at", String.class, caseId))
                    .containsExactly("HIDE_PRODUCT", "ACCEPT_APPEAL", "RESTORE_PRODUCT");
        }

        @Test
        @DisplayName("8. 申诉撤销限制：接受后限制立即结束并写审计；爽约来源的限制同时推翻那次确认，不再计数；已结束的限制不能申诉")
        void appealRestriction() throws Exception {
            User target = api.register(), reporter = api.register();
            User a = staff("MODERATOR"), b = staff("SENIOR_MODERATOR");
            report(reporter, "USER", target.id(), "HARASSMENT");
            api.ok(decide(a, caseFor("USER", target.id()), "RESTRICT_BOOKING", "HARASSMENT", 72));
            String restriction = api.ok(api.get(target, "/v1/me/governance")).path("restrictions").get(0).path("id").asText();
            String appeal = api.ok(api.post(target, "/v1/me/appeals", Map.of("restrictionId", restriction, "reason", "我没有骚扰对方"))).path("id").asText();
            JsonNode list = api.ok(api.get(b, "/v1/moderation/appeals?status=PENDING"));
            assertThat(list.toString()).contains(appeal);
            api.ok(api.post(b, "/v1/moderation/appeals/" + appeal + "/decision", Map.of("accept", true, "reasonCode", "APPEAL_ACCEPTED", "note", "证据不足")));
            JsonNode after = api.ok(api.get(target, "/v1/me/governance")).path("restrictions").get(0);
            assertThat(after.path("active").asBoolean()).isFalse();
            assertThat(after.path("revokedAt").isNull()).isFalse();
            assertThat(after.path("appeal").path("status").asText()).isEqualTo("ACCEPTED");
            User seller = api.register();
            assertThat(status(api.post(target, "/v1/orders", orderBody(product(seller, "撤销后可以下单"))))).isEqualTo(200);
            assertThat(status(api.post(target, "/v1/me/appeals", Map.of("restrictionId", restriction, "reason", "再来一次")))).isEqualTo(409);
        }

        @Test
        @DisplayName("9. 强制归档圈子需要 SENIOR_MODERATOR；所有者已归档时强制归档记为未生效，只有一次归档事件")
        void archiveCircle() throws Exception {
            User owner = api.register(), member = api.register();
            String circle = api.createCircle(owner, "违规圈子", "PRIVATE");
            api.join(owner, circle, member);
            report(member, "CIRCLE", circle, "SPAM");
            String caseId = caseFor("CIRCLE", circle);
            User mod = staff("MODERATOR"), senior = staff("SENIOR_MODERATOR");
            assertThat(status(decide(mod, caseId, "ARCHIVE_CIRCLE", "POLICY_VIOLATION", null))).isEqualTo(400);
            api.ok(api.post(owner, "/v1/circles/" + circle + "/archive", Map.of()));
            assertThat(api.ok(api.get(senior, "/v1/moderation/cases/" + caseId)).path("allowedActions").toString()).doesNotContain("ARCHIVE_CIRCLE");
            assertThat(status(decide(senior, caseId, "NO_ACTION", "DUPLICATE", null))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", Long.class, circle)).isEqualTo(1);

            User owner2 = api.register(), member2 = api.register();
            String active = api.createCircle(owner2, "需要强制归档", "PRIVATE");
            api.join(owner2, active, member2);
            report(member2, "CIRCLE", active, "SPAM");
            api.ok(decide(senior, caseFor("CIRCLE", active), "ARCHIVE_CIRCLE", "POLICY_VIOLATION", null));
            assertThat(jdbc.queryForObject("SELECT status FROM circles WHERE id=?::uuid", String.class, active)).isEqualTo("ARCHIVED");
            assertThat(jdbc.queryForObject("SELECT actor_user_id::text FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", String.class, active))
                    .isEqualTo(senior.id());
        }

        @Test
        @DisplayName("10. 爽约复核：报告人请求复核后由工作人员确认；只有确认后才计数；工作人员能看到双方的到达声明（不是定位证据）；驳回不计数")
        void noShowReview() throws Exception {
            User seller = api.register(), buyer = api.register();
            String p = product(seller, "爽约复核商品");
            String order = api.order(buyer, p);
            api.ok(api.transition(seller, order, "PENDING_MEETING"));
            api.ok(api.put(buyer, "/v1/orders/" + order + "/presence", Map.of("action", "ARRIVE")));
            com.lulu.campusmarketbackend.support.SlotClock.endedMinutesAgo(jdbc, order, 60);
            String report = api.ok(api.post(buyer, "/v1/orders/" + order + "/no-show-reports", Map.of("reasonCode", "DID_NOT_ARRIVE"))).path("id").asText();
            JsonNode escalated = report(buyer, "NO_SHOW", report, "NO_SHOW_REVIEW");
            assertThat(escalated.path("status").asText()).isEqualTo("RECEIVED");
            assertThat(status(api.post(seller, "/v1/moderation-reports", Map.of("targetType", "NO_SHOW", "targetId", report, "reasonCode", "NO_SHOW_REVIEW"))))
                    .as("只有报告人可以请求复核").isEqualTo(404);
            User s = staff("MODERATOR");
            String caseId = caseFor("NO_SHOW", report);
            JsonNode detail = api.ok(api.get(s, "/v1/moderation/cases/" + caseId));
            assertThat(detail.path("noShow").path("presence").get(0).path("party").asText()).isEqualTo("REPORTER");
            assertThat(detail.path("allowedActions").toString()).contains("CONFIRM_NO_SHOW").contains("REJECT_NO_SHOW");
            api.ok(decide(s, caseId, "CONFIRM_NO_SHOW", "CONFIRMED_NO_SHOW", null));
            assertThat(jdbc.queryForObject("SELECT status FROM order_no_show_reports WHERE id=?::uuid", String.class, report)).isEqualTo("CONFIRMED");
            assertThat(api.ok(api.get(seller, "/v1/me/governance")).path("noShowWarning").path("confirmedCount").asInt()).isEqualTo(1);
            assertThat(status(api.post(seller, "/v1/no-show-reports/" + report + "/acknowledge", Map.of()))).isEqualTo(409);
        }
    }
}
