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
 * 模块 7.1：治理规则收口的 HTTP 行为测试（每个 @DisplayName 的编号对应报告里的追踪矩阵）。
 * 平台改为「只展示商品 + 联系请求」后，A 明确档期、B 爽约自动限制与 C7 自动限制申诉所依赖的下单 / 预约 / 爽约接口已移除，
 * 这些用例已退役（见 docs/phase-0-test-retirement.md）。
 * <ul>
 *   <li>C 利益回避：本人 / 本人内容 / 本人举报 / 本人处理、无人可回避时保持待处理、停用立即失权；</li>
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

    // ================================================================== A 明确档期

    // ================================================================== B 自动限制重算

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
        @DisplayName("C1～C4. 以本人为目标、本人的商品 / 评论 / 私信、本人提交的举报：本人查看 / 领取 / 结案一律 403 CONFLICT_OF_INTEREST，且不出现在本人队列；另一位工作人员可以处理")
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
            // REWRITTEN（快捷消息）：私信默认只能发预设快捷消息；工作人员 a 是这件商品的卖家
            String msg = api.ok(api.post(a, "/v1/conversations/" + conversation + "/messages", Map.of("templateCode", "SELLER_AVAILABLE"))).path("id").asText();
            fileReport(other, "MESSAGE", msg, "HARASSMENT");
            assertRecused(a, caseFor("MESSAGE", msg));

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
            api.ok(decide(a, caseFor("USER", target.id()), "RESTRICT_CONTACT", "HARASSMENT", 24));
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
        @DisplayName("C8. 停用后下一请求立即失权；C9. 本校 / 他校 / 本人 / 他人申诉矩阵")
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
            String selfAppeal;
            {
                // 工作人员 b 自己被限制并提出申诉
                fileReport(api.register(), "USER", b.id(), "SPAM");
                api.ok(decide(a, caseFor("USER", b.id()), "RESTRICT_CIRCLE_CREATION", "POLICY_VIOLATION", 24));
                selfAppeal = appealRestriction(b, jdbc.queryForObject("SELECT id FROM user_restrictions WHERE user_id=?::uuid", UUID.class, b.id()));
            }
            // 期望：本校他人 → 可决定；他校 → 404；本人做出的处理 → 403；本人的申诉 → 403
            assertThat(status(decideAppeal(lakeStaff, manualAppeal, true))).as("他校").isEqualTo(404);
            assertThat(status(api.get(lakeStaff, "/v1/moderation/cases/" + c))).as("他校案件").isEqualTo(404);
            assertThat(status(decideAppeal(a, manualAppeal, true))).as("本人做出的处理").isEqualTo(403);
            assertThat(status(decideAppeal(b, selfAppeal, true))).as("本人的申诉").isEqualTo(403);
            assertThat(status(decideAppeal(b, manualAppeal, false))).as("本校他人").isEqualTo(200);
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
                + "只限制作者不会被当成已处理内容；发送者申诉后由另一位工作人员解除（REWRITTEN：私信改为快捷消息，隔离时 templateCode 同样不返回）")
        void messages() throws Exception {
            // 三条快捷消息的文案互不包含，用来区分「被举报的那一条」与其他消息
            final String first = "你好，这件还在吗？", reported = "价格不议，谢谢理解。", third = "价格还有商量的空间吗？";
            User seller = api.register(), buyer = api.register(), a = staff("MODERATOR"), b = staff("MODERATOR");
            String p = product(seller);
            String conv = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", p))).path("id").asText();
            api.ok(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("templateCode", "BUYER_STILL_AVAILABLE")));
            String bad = api.ok(api.post(seller, "/v1/conversations/" + conv + "/messages", Map.of("templateCode", "SELLER_PRICE_FIRM"))).path("id").asText();
            api.ok(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("templateCode", "BUYER_ASK_PRICE")));
            fileReport(buyer, "MESSAGE", bad, "HARASSMENT");
            String c = caseFor("MESSAGE", bad);

            JsonNode detail = api.ok(api.get(a, "/v1/moderation/cases/" + c));
            assertThat(detail.toString()).contains(reported).doesNotContain(first).doesNotContain(third);
            // 只限制作者：私信照常显示（限制不是内容处置）
            api.ok(decide(a, c, "RESTRICT_CONTACT", "HARASSMENT", 24));
            assertThat(api.ok(api.get(buyer, "/v1/conversations/" + conv + "/messages")).toString()).contains(reported);

            // 第一个案件已结（只限制了作者）；工作人员 b 就同一条私信另立案件做内容处置
            String second = api.ok(api.post(b, "/v1/moderation/cases", Map.of("targetType", "MESSAGE", "targetId", bad))).path("id").asText();
            assertThat(second).isNotEqualTo(c);
            api.ok(decide(b, second, "QUARANTINE_MESSAGE", "HARASSMENT", null));
            for (User u : List.of(seller, buyer)) {
                JsonNode list = api.ok(api.get(u, "/v1/conversations/" + conv + "/messages"));
                assertThat(list).hasSize(3);
                assertThat(list.toString()).doesNotContain(reported).doesNotContain("SELLER_PRICE_FIRM").contains(first).contains(third);
                assertThat(list.get(1).path("quarantined").asBoolean()).isTrue();
                assertThat(list.get(1).path("templateCode").isNull()).as("被隔离的快捷消息也不返回 code").isTrue();
                assertThat(list.get(0).path("templateCode").asText()).isEqualTo("BUYER_STILL_AVAILABLE");
            }
            assertThat(status(api.post(buyer, "/v1/conversations/" + conv + "/messages", Map.of("templateCode", "ANY_THANKS")))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT content FROM messages WHERE id=?::uuid", String.class, bad)).isEqualTo(reported);
            assertThatThrownBy(() -> jdbc.update("UPDATE messages SET template_code='ANY_THANKS' WHERE id=?::uuid", bad))
                    .as("template_code 与正文一样不可修改（V21）").isInstanceOf(DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("DELETE FROM messages WHERE id=?::uuid", bad)).isInstanceOf(DataAccessException.class);

            UUID q = jdbc.queryForObject("SELECT id FROM moderation_actions WHERE action_code='QUARANTINE_MESSAGE' AND target_id=?::uuid", UUID.class, bad);
            String appeal = appealAction(seller, q);
            assertThat(status(decideAppeal(b, appeal, true))).as("原处理人回避").isEqualTo(403);
            api.ok(decideAppeal(a, appeal, true));
            JsonNode released = api.ok(api.get(buyer, "/v1/conversations/" + conv + "/messages"));
            assertThat(released.toString()).contains(reported);
            assertThat(released.get(1).path("templateCode").asText()).as("解除后 code 恢复").isEqualTo("SELLER_PRICE_FIRM");
        }
    }
}
