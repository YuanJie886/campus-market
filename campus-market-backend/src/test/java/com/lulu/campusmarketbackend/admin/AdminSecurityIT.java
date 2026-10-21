package com.lulu.campusmarketbackend.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 阶段 2：运营后台安全。两人复核、最后一名学校管理员、高级审核员不被自动扩权、商品管理的利益回避、
 * 个人信息读取留痕、按工作人员限流、审计表禁止 TRUNCATE。每个用例只用本用例新建的账号，与执行顺序无关。
 */
@Testcontainers
@SpringBootTest(properties = {
        "campus-market.rate-limit.admin-write.limit=8",
        "campus-market.rate-limit.admin-read.limit=40",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminSecurityIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private User staff(String role) throws Exception {
        User user = api.register();
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'pilot',?)", UUID.fromString(user.id()), role);
        return user;
    }
    private static Map<String, Object> grant(String role, boolean active) {
        return Map.of("role", role, "active", active, "note", "阶段 2 测试");
    }
    private String roleOf(User user) {
        List<String> roles = jdbc.queryForList("SELECT role || ':' || active FROM staff_members WHERE user_id=?", String.class, UUID.fromString(user.id()));
        return roles.isEmpty() ? null : roles.get(0);
    }
    private MvcResult decide(User who, String requestId, String decision) throws Exception {
        return api.post(who, "/v1/admin/role-requests/" + requestId + "/" + decision, Map.of("note", "核对过身份与职责"));
    }
    private String product(User seller) throws Exception {
        return api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "后台安全测试台灯", 30))).path("id").asText();
    }
    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    @Test void grantingSchoolAdminNeedsASecondSchoolAdminAndBothAreAudited() throws Exception {
        User a = staff("SCHOOL_ADMIN"), b = staff("SCHOOL_ADMIN"), moderator = staff("MODERATOR"), target = api.register();
        JsonNode pending = api.ok(api.patch(a, "/v1/admin/users/" + target.id() + "/staff", grant("SCHOOL_ADMIN", true))).path("pendingRoleRequest");
        String rid = pending.path("id").asText();
        assertThat(pending.path("status").asText()).isEqualTo("PENDING");
        assertThat(roleOf(target)).as("发起之后还没有生效").isNull();
        assertThat(status(api.get(target, "/v1/admin/me"))).isEqualTo(403);
        assertThat(status(api.patch(a, "/v1/admin/users/" + target.id() + "/staff", grant("SCHOOL_ADMIN", true))))
                .as("同一目标同时只有一条待确认请求").isEqualTo(409);
        assertThat(status(decide(a, rid, "approve"))).as("发起人不能自己确认").isEqualTo(403);
        assertThat(status(decide(moderator, rid, "approve"))).as("审核员没有授权能力").isEqualTo(403);
        assertThat(status(decide(target, rid, "approve"))).isEqualTo(403);

        JsonNode approved = api.ok(decide(b, rid, "approve"));
        assertThat(approved.path("status").asText()).isEqualTo("APPROVED");
        assertThat(approved.path("decidedBy").asText()).isEqualTo(b.id());
        assertThat(roleOf(target)).isEqualTo("SCHOOL_ADMIN:true");
        assertThat(status(api.get(target, "/v1/admin/me"))).isEqualTo(200);
        Map<String, Object> audit = jdbc.queryForMap("SELECT staff_user_id, confirmed_by, role_request_id, new_role FROM admin_staff_audit WHERE target_user_id=?",
                UUID.fromString(target.id()));
        assertThat(audit.get("staff_user_id").toString()).as("审计记录发起人").isEqualTo(a.id());
        assertThat(audit.get("confirmed_by").toString()).as("与确认人").isEqualTo(b.id());
        assertThat(audit.get("role_request_id").toString()).isEqualTo(rid);
        assertThat(status(decide(b, rid, "approve"))).as("已处理的请求是终态").isEqualTo(409);
        assertThatThrownBy(() -> jdbc.update("UPDATE admin_role_requests SET status='PENDING', decided_at=NULL WHERE id=?::uuid", rid))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO admin_staff_audit(id,school_id,staff_user_id,target_user_id,new_role,new_active,note,request_id,confirmed_by,role_request_id) "
                + "VALUES (gen_random_uuid(),'pilot',?::uuid,?::uuid,'SCHOOL_ADMIN',true,'x','r',?::uuid,?::uuid)", a.id(), target.id(), a.id(), rid))
                .as("确认人不能是发起人（数据库约束）").isInstanceOf(DataAccessException.class);
    }

    @Test void demotionIsAlsoTwoPersonAndRequestsCanBeRejectedCancelledOrExpire() throws Exception {
        User a = staff("SCHOOL_ADMIN"), b = staff("SCHOOL_ADMIN"), c = staff("SCHOOL_ADMIN");
        String demote = api.ok(api.patch(a, "/v1/admin/users/" + b.id() + "/staff", grant("MODERATOR", true))).path("pendingRoleRequest").path("id").asText();
        assertThat(roleOf(b)).as("降级同样等待确认").isEqualTo("SCHOOL_ADMIN:true");
        assertThat(status(decide(b, demote, "reject"))).as("被降级的本人不能处理").isEqualTo(403);
        JsonNode rejected = api.ok(decide(c, demote, "reject"));
        assertThat(rejected.path("status").asText()).isEqualTo("REJECTED");
        assertThat(roleOf(b)).isEqualTo("SCHOOL_ADMIN:true");

        String deactivate = api.ok(api.patch(a, "/v1/admin/users/" + c.id() + "/staff", grant("SCHOOL_ADMIN", false))).path("pendingRoleRequest").path("id").asText();
        assertThat(status(decide(b, deactivate, "cancel"))).as("只有发起人可以撤回").isEqualTo(403);
        assertThat(api.ok(api.post(a, "/v1/admin/role-requests/" + deactivate + "/cancel", Map.of())).path("status").asText()).isEqualTo("CANCELLED");
        assertThat(roleOf(c)).isEqualTo("SCHOOL_ADMIN:true");

        UUID stale = UUID.randomUUID();
        jdbc.update("INSERT INTO admin_role_requests(id,school_id,target_user_id,requested_by,old_role,old_active,new_role,new_active,note,request_id,expires_at,created_at) "
                + "VALUES (?,'pilot',?::uuid,?::uuid,'SCHOOL_ADMIN',true,'AUDITOR',true,'过期请求','r',now() - interval '1 hour',now() - interval '73 hours')", stale, c.id(), a.id());
        assertThat(api.ok(api.get(b, "/v1/admin/role-requests/" + stale)).path("status").asText()).as("过期的请求显示为 EXPIRED").isEqualTo("EXPIRED");
        assertThat(status(decide(b, stale.toString(), "approve"))).isEqualTo(409);
        assertThat(roleOf(c)).isEqualTo("SCHOOL_ADMIN:true");
        assertThat(api.ok(api.get(b, "/v1/admin/role-requests?status=PENDING&perPage=100")).path("items").toString()).doesNotContain(stale.toString());
        // 其他角色之间的变更仍由一人完成，并照常审计
        User target = api.register();
        assertThat(api.ok(api.patch(a, "/v1/admin/users/" + target.id() + "/staff", grant("AUDITOR", true))).has("pendingRoleRequest")).isFalse();
        assertThat(roleOf(target)).isEqualTo("AUDITOR:true");
    }

    @Test void aSchoolAlwaysKeepsAnActiveSchoolAdmin() throws Exception {
        jdbc.update("INSERT INTO schools(id,name) VALUES ('solo-admin','单管理员学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('单管理员校区','solo-admin','单管理员校区') ON CONFLICT DO NOTHING");
        User only = api.register("单管理员校区"), second = api.register("单管理员校区");
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'solo-admin','SCHOOL_ADMIN')", UUID.fromString(only.id()));
        for (String sql : List.of("UPDATE staff_members SET active=false WHERE user_id=?::uuid", "UPDATE staff_members SET role='AUDITOR' WHERE user_id=?::uuid")) {
            assertThatThrownBy(() -> jdbc.update(sql, only.id())).as(sql).isInstanceOf(DataAccessException.class)
                    .hasMessageContaining("at least one active school admin");
        }
        // 删除本来就被既有守卫拒绝（只能停用）
        assertThatThrownBy(() -> jdbc.update("DELETE FROM staff_members WHERE user_id=?::uuid", only.id())).isInstanceOf(DataAccessException.class);
        assertThat(roleOf(only)).isEqualTo("SCHOOL_ADMIN:true");
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'solo-admin','SCHOOL_ADMIN')", UUID.fromString(second.id()));
        jdbc.update("UPDATE staff_members SET active=false WHERE user_id=?::uuid", only.id());
        assertThatThrownBy(() -> jdbc.update("UPDATE staff_members SET active=false WHERE user_id=?::uuid", second.id()))
                .as("第二位成为唯一的在岗学校管理员后同样受保护").isInstanceOf(DataAccessException.class);
    }

    @Test void seniorModeratorsAreNotWidenedByTheAdminConsole() throws Exception {
        User senior = staff("SENIOR_MODERATOR"), seller = api.register();
        String id = product(seller);
        JsonNode me = api.ok(api.get(senior, "/v1/admin/me"));
        assertThat(me.path("permissions").toString()).contains("cases:write", "appeals:write", "products:read")
                .doesNotContain("users:read", "orders:read", "audit:read", "products:write", "users:write");
        for (String resource : List.of("users", "orders", "audit", "role-requests", "read-audit")) {
            assertThat(status(api.get(senior, "/v1/admin/" + resource))).as(resource).isEqualTo(403);
        }
        assertThat(status(api.get(senior, "/v1/admin/products"))).isEqualTo(200);
        assertThat(status(api.get(senior, "/v1/admin/cases"))).isEqualTo(200);
        String version = api.ok(api.get(senior, "/v1/admin/products/" + id)).path("version").asText();
        assertThat(status(api.patch(senior, "/v1/admin/products/" + id, Map.of("title", "改", "description", "高级审核员不能直接编辑商品", "price", 1, "note", "x", "version", version))))
                .isEqualTo(403);
        assertThat(status(api.post(senior, "/v1/admin/products/" + id + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "x", "version", version))))
                .isEqualTo(403);
    }

    @Test void productManagementRecusesStaffWithAContactRequestOrAReport() throws Exception {
        User involved = staff("SCHOOL_ADMIN"), reporter = staff("SCHOOL_ADMIN"), neutral = staff("SCHOOL_ADMIN"), seller = api.register();
        String id = product(seller);
        api.requestContact(involved, id);
        api.ok(api.post(reporter, "/v1/moderation-reports", Map.of("targetType", "PRODUCT", "targetId", id, "reasonCode", "MISLEADING")));
        String caseId = jdbc.queryForObject("SELECT id::text FROM moderation_cases WHERE target_id=?::uuid", String.class, id);
        String version = api.ok(api.get(neutral, "/v1/admin/products/" + id)).path("version").asText();
        Map<String, Object> edit = Map.of("title", "核对后的台灯", "description", "核对后的商品描述内容", "price", 28, "note", "核对", "version", version);
        for (User user : List.of(involved, reporter)) {
            MvcResult r = api.patch(user, "/v1/admin/products/" + id, edit);
            assertThat(status(r)).isEqualTo(403);
            assertThat(api.body(r).path("data").path("code").asText()).isEqualTo("CONFLICT_OF_INTEREST");
        }
        assertThat(api.body(api.patch(involved, "/v1/admin/products/" + id, edit)).path("data").path("reason").asText()).isEqualTo("CONTACT_PARTY");
        assertThat(api.body(api.patch(reporter, "/v1/admin/products/" + id, edit)).path("data").path("reason").asText()).isEqualTo("OWN_REPORT");
        MvcResult caseView = api.get(involved, "/v1/moderation/cases/" + caseId);
        assertThat(status(caseView)).as("案件同样回避申请过联系方式的工作人员").isEqualTo(403);
        assertThat(api.body(caseView).path("data").path("reason").asText()).isEqualTo("CONTACT_PARTY");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_product_audit WHERE product_id=?::uuid", Integer.class, id)).isZero();
        assertThat(status(api.get(neutral, "/v1/moderation/cases/" + caseId))).isEqualTo(200);
    }

    @Test void readingPersonalDataIsAuditedWithoutStoringTheSearchText() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), auditor = staff("AUDITOR"), moderator = staff("MODERATOR"), target = api.register();
        String account = jdbc.queryForObject("SELECT account FROM users WHERE id=?::uuid", String.class, target.id());
        JsonNode page = api.ok(api.get(admin, "/v1/admin/users?q=" + account.toUpperCase()));
        assertThat(page.path("items").findValuesAsText("id")).contains(target.id());
        api.ok(api.get(admin, "/v1/admin/users/" + target.id()));
        api.ok(api.get(admin, "/v1/admin/products"));
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT resource, record_id, result_count, query_digest FROM admin_read_audit WHERE staff_user_id=?::uuid ORDER BY id",
                admin.id());
        assertThat(rows).hasSize(2).as("商品目录不是个人信息，不记录");
        assertThat(rows.get(0).get("resource")).isEqualTo("users");
        assertThat(rows.get(0).get("result_count")).isEqualTo(1);
        assertThat(rows.get(0).get("query_digest")).as("搜索词只存小写后的 SHA-256").isEqualTo(sha256(account.toLowerCase()));
        assertThat(rows.get(1).get("record_id").toString()).isEqualTo(target.id());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_read_audit WHERE query_digest LIKE ?", Integer.class, "%" + account + "%")).isZero();

        JsonNode log = api.ok(api.get(auditor, "/v1/admin/read-audit?perPage=100"));
        assertThat(log.toString()).contains(admin.id()).doesNotContain(account);
        assertThat(status(api.get(moderator, "/v1/admin/read-audit"))).isEqualTo(403);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_read_audit WHERE staff_user_id=?::uuid AND resource='read-audit'", Integer.class, auditor.id()))
                .as("查看审计本身也留痕").isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM admin_read_audit WHERE staff_user_id=?::uuid", admin.id())).isInstanceOf(DataAccessException.class);
    }

    @Test void adminReadsAndWritesAreRateLimitedPerStaffMember() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), other = staff("SCHOOL_ADMIN");
        for (int i = 0; i < 40; i++) assertThat(status(api.get(admin, "/v1/admin/products?perPage=1"))).isEqualTo(200);
        MvcResult limited = api.get(admin, "/v1/admin/users");
        assertThat(status(limited)).isEqualTo(429);
        assertThat(limited.getResponse().getHeader("Retry-After")).isNotNull();
        assertThat(status(api.get(other, "/v1/admin/users"))).as("按工作人员分别计数").isEqualTo(200);
        User writer = staff("SCHOOL_ADMIN");
        for (int i = 0; i < 8; i++) {
            User target = api.register();
            assertThat(status(api.patch(writer, "/v1/admin/users/" + target.id() + "/staff", grant("AUDITOR", true)))).isEqualTo(200);
        }
        User last = api.register();
        assertThat(status(api.patch(writer, "/v1/admin/users/" + last.id() + "/staff", grant("AUDITOR", true)))).isEqualTo(429);
        assertThat(roleOf(last)).isNull();
    }

    @Test void auditAndHistoryTablesCannotBeTruncated() {
        for (String table : List.of("admin_staff_audit", "admin_product_audit", "admin_read_audit", "admin_role_requests", "moderation_actions",
                "moderation_cases", "user_restrictions", "legacy_trade_closures", "contact_requests", "orders")) {
            assertThatThrownBy(() -> jdbc.execute("TRUNCATE " + table + " CASCADE")).as(table).isInstanceOf(DataAccessException.class)
                    .hasMessageContaining("cannot be truncated");
        }
    }
}
