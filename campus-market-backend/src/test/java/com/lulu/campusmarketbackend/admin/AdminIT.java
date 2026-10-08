package com.lulu.campusmarketbackend.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;

@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminIT {
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
    @BeforeEach void setUp() {
        api = new SupplyApi(mvc, json);
        jdbc.update("INSERT INTO schools(id,name) VALUES ('admin-other','其他学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('后台隔离校区','admin-other','后台隔离校区') ON CONFLICT DO NOTHING");
    }
    private User staff(String role) throws Exception {
        User user = api.register();
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'pilot',?)", UUID.fromString(user.id()), role);
        return user;
    }
    private Map<String, Object> grant(String role, boolean active) {
        return Map.of("role", role, "active", active, "note", "测试授权变更");
    }
    @Test void anonymousAndRegularUsersCannotReadAdminData() throws Exception {
        assertThat(status(api.get(null, "/v1/admin/me"))).isEqualTo(401);
        User user = api.register();
        for (String resource : new String[]{"me", "users", "products", "orders", "cases", "appeals", "audit", "roles"})
            assertThat(status(api.get(user, "/v1/admin/" + resource))).isEqualTo(403);
    }
    @Test void authorizationIsAuditedAndRevocationWorksWithSameToken() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), target = api.register();
        assertThat(status(api.patch(admin, "/v1/admin/users/" + target.id() + "/staff", grant("AUDITOR", true)))).isEqualTo(200);
        assertThat(status(api.get(target, "/v1/admin/audit"))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_staff_audit WHERE target_user_id=?", Integer.class, UUID.fromString(target.id()))).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM admin_staff_audit WHERE target_user_id=?", UUID.fromString(target.id()))).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThat(status(api.patch(admin, "/v1/admin/users/" + target.id() + "/staff", grant("AUDITOR", false)))).isEqualTo(200);
        assertThat(status(api.get(target, "/v1/admin/me"))).isEqualTo(403);
    }
    @Test void auditorsCannotUseEitherNewOrLegacyMutationRoutes() throws Exception {
        User auditor = staff("AUDITOR"), target = api.register();
        assertThat(status(api.patch(auditor, "/v1/admin/users/" + target.id() + "/staff", grant("SCHOOL_ADMIN", true)))).isEqualTo(403);
        assertThat(status(api.post(auditor, "/v1/moderation/cases", Map.of("targetType", "USER", "targetId", target.id())))).isEqualTo(403);
        assertThat(status(api.post(auditor, "/v1/admin/cases/" + UUID.randomUUID() + "/decision", Map.of()))).isEqualTo(403);
        assertThat(status(api.get(auditor, "/v1/admin/users"))).isEqualTo(200);
    }
    @Test void cannotChangeOwnRoleOrGrantAcrossSchools() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), other = api.register("后台隔离校区");
        assertThat(status(api.patch(admin, "/v1/admin/users/" + admin.id() + "/staff", grant("AUDITOR", true)))).isEqualTo(403);
        assertThat(status(api.patch(admin, "/v1/admin/users/" + other.id() + "/staff", grant("SCHOOL_ADMIN", true)))).isEqualTo(404);
        assertThat(status(api.get(admin, "/v1/admin/users/" + other.id()))).isEqualTo(404);
        var page = api.ok(api.get(admin, "/v1/admin/users?perPage=100"));
        assertThat(page.path("items").toString()).doesNotContain(other.id(), "password_hash", "contact", "dormBuildingId");
    }
    @Test void paginationSortingAndLiteralSearchUseDatabaseQueries() throws Exception {
        User admin = staff("SCHOOL_ADMIN");
        var first = api.ok(api.get(admin, "/v1/admin/users?perPage=1&sort=createdAt&order=ASC"));
        assertThat(first.path("items").size()).isEqualTo(1);
        assertThat(status(api.get(admin, "/v1/admin/users?sort=password_hash"))).isEqualTo(400);
        assertThat(status(api.get(admin, "/v1/admin/users?perPage=101"))).isEqualTo(400);
        assertThat(api.ok(api.get(admin, "/v1/admin/users?q=%25")).path("items").size()).isZero();
        assertThat(status(api.get(admin, "/v1/admin/products"))).isEqualTo(200);
        assertThat(status(api.get(admin, "/v1/admin/orders"))).isEqualTo(200);
        assertThat(api.ok(api.get(admin, "/v1/admin/roles")).path("items").size()).isEqualTo(4);
    }
    @Test void invalidGrantHasNoSideEffects() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), target = api.register();
        assertThat(status(api.patch(admin, "/v1/admin/users/" + target.id() + "/staff", Map.of("role", "OWNER", "active", true, "note", "测试")))).isEqualTo(400);
        assertThat(status(api.patch(admin, "/v1/admin/users/" + target.id() + "/staff", Map.of("role", "AUDITOR", "active", true, "note", "测试", "schoolId", "pilot")))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_members WHERE user_id=?", Integer.class, UUID.fromString(target.id()))).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_staff_audit WHERE target_user_id=?", Integer.class, UUID.fromString(target.id()))).isZero();
    }
    @Test void schoolAdminRetainsSeniorModerationAndAuditorNotCountedAsEligible() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), target = api.register();
        var opened = api.ok(api.post(admin, "/v1/moderation/cases", Map.of("targetType", "USER", "targetId", target.id())));
        UUID caseId = UUID.fromString(opened.path("id").asText());
        int before = jdbc.queryForObject("SELECT eligible_staff_for_case(?)", Integer.class, caseId);
        staff("AUDITOR");
        assertThat(jdbc.queryForObject("SELECT eligible_staff_for_case(?)", Integer.class, caseId)).isEqualTo(before);
    }

    private record Trade(User buyer, User seller, String productId, String orderId) {}
    private String product(User seller) throws Exception {
        return api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "目录管理测试台灯", 88))).path("id").asText();
    }
    private Map<String, Object> editProduct(User admin, String id, String version) {
        return Map.of("title", "已核实的台灯", "description", "管理员核对后的商品描述", "price", 79.50, "note", "核对信息后修正", "version", version);
    }
    @Test void productEditsAreAuditedAndStaleWritesDoNotOverwriteChanges() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), seller = api.register(); String id = product(seller);
        var old = api.ok(api.get(admin, "/v1/admin/products/" + id));
        assertThat(old.path("sellerAccount").asText()).isNotBlank();
        assertThat(old.path("images").size()).isEqualTo(1);
        assertThat(old.toString()).doesNotContain("contact", "password_hash");
        var edited = api.ok(api.patch(admin, "/v1/admin/products/" + id, editProduct(admin, id, old.path("version").asText())));
        assertThat(edited.path("title").asText()).isEqualTo("已核实的台灯");
        assertThat(edited.path("price").asDouble()).isEqualTo(79.5);
        assertThat(edited.path("history").get(0).path("action").asText()).isEqualTo("EDIT_PRODUCT");
        assertThat(status(api.patch(admin, "/v1/admin/products/" + id, editProduct(admin, id, old.path("version").asText())))).isEqualTo(409);
        assertThat(jdbc.queryForObject("SELECT old_values->>'title' FROM admin_product_audit WHERE product_id=?", String.class, UUID.fromString(id))).isEqualTo("目录管理测试台灯");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_product_audit WHERE product_id=?", Integer.class, UUID.fromString(id))).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM admin_product_audit WHERE product_id=?", UUID.fromString(id))).isInstanceOf(org.springframework.dao.DataAccessException.class);
        Map<String, Object> forged = new java.util.HashMap<>(editProduct(admin, id, edited.path("version").asText()));
        forged.put("sellerId", admin.id());
        assertThat(status(api.patch(admin, "/v1/admin/products/" + id, forged))).isEqualTo(400);
        forged.remove("sellerId"); forged.put("price", -1);
        assertThat(status(api.patch(admin, "/v1/admin/products/" + id, forged))).isEqualTo(400);
    }
    @Test void productHidingAndRestoreUseGovernanceHistoryAndAffectBuyerVisibility() throws Exception {
        User admin = staff("SENIOR_MODERATOR"), seller = api.register(), buyer = api.register(); String id = product(seller);
        var old = api.ok(api.get(admin, "/v1/admin/products/" + id));
        var hidden = api.ok(api.post(admin, "/v1/admin/products/" + id + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "商品需重新核实", "version", old.path("version").asText())));
        assertThat(hidden.path("moderationHidden").asBoolean()).isTrue();
        assertThat(hidden.path("status").asText()).isEqualTo("在售");
        assertThat(status(api.get(buyer, "/v1/products/" + id))).isEqualTo(404);
        assertThat(hidden.path("history").get(0).path("action").asText()).isEqualTo("HIDE_PRODUCT");
        var restored = api.ok(api.post(admin, "/v1/admin/products/" + id + "/visibility", Map.of("action", "RESTORE_PRODUCT", "note", "核实后恢复展示", "version", hidden.path("version").asText())));
        assertThat(restored.path("moderationHidden").asBoolean()).isFalse();
        assertThat(restored.path("history").size()).isEqualTo(2);
        assertThat(status(api.get(buyer, "/v1/products/" + id))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_cases WHERE target_id=? AND status='RESOLVED'", Integer.class, UUID.fromString(id))).isEqualTo(2);
    }
    @Test void productManagementRequiresAuthorizedRoleSameSchoolAndOtherSeller() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), auditor = staff("AUDITOR"), moderator = staff("MODERATOR"), seller = api.register(); String id = product(seller);
        var old = api.ok(api.get(admin, "/v1/admin/products/" + id));
        for (User denied : new User[]{auditor, moderator, seller}) {
            assertThat(status(api.patch(denied, "/v1/admin/products/" + id, editProduct(admin, id, old.path("version").asText())))).isEqualTo(403);
            assertThat(status(api.post(denied, "/v1/admin/products/" + id + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "越权测试", "version", old.path("version").asText())))).isEqualTo(403);
        }
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'pilot','SCHOOL_ADMIN')", UUID.fromString(seller.id()));
        assertThat(status(api.patch(seller, "/v1/admin/products/" + id, editProduct(admin, id, old.path("version").asText())))).isEqualTo(403);
        assertThat(status(api.post(seller, "/v1/admin/products/" + id + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "本人商品", "version", old.path("version").asText())))).isEqualTo(403);
        jdbc.update("UPDATE users SET campus='后台隔离校区' WHERE id=?", UUID.fromString(admin.id()));
        jdbc.update("UPDATE staff_members SET school_id='admin-other' WHERE user_id=?", UUID.fromString(admin.id()));
        assertThat(status(api.patch(admin, "/v1/admin/products/" + id, editProduct(admin, id, old.path("version").asText())))).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_cases WHERE target_id=?", Integer.class, UUID.fromString(id))).isZero();
    }
    @Test void activeTradeAndUnresolvedCaseCannotBeOverwrittenByCatalogManagement() throws Exception {
        User admin = staff("SCHOOL_ADMIN"); Trade trade = trade();
        var product = api.ok(api.get(admin, "/v1/admin/products/" + trade.productId()));
        assertThat(status(api.patch(admin, "/v1/admin/products/" + trade.productId(), editProduct(admin, trade.productId(), product.path("version").asText())))).isEqualTo(409);
        var hidden = api.ok(api.post(admin, "/v1/admin/products/" + trade.productId() + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "核实预约商品", "version", product.path("version").asText())));
        assertThat(hidden.path("status").asText()).isEqualTo("预约中");
        assertThat(api.ok(api.get(admin, "/v1/admin/orders/" + trade.orderId())).path("price").asInt()).isEqualTo(88);
        String other = product(api.register());
        jdbc.update("INSERT INTO moderation_cases(id,school_id,target_type,target_id) VALUES (?,'pilot','PRODUCT',?)", UUID.randomUUID(), UUID.fromString(other));
        var otherRecord = api.ok(api.get(admin, "/v1/admin/products/" + other));
        assertThat(status(api.post(admin, "/v1/admin/products/" + other + "/visibility", Map.of("action", "HIDE_PRODUCT", "note", "不能覆盖案件", "version", otherRecord.path("version").asText())))).isEqualTo(409);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE target_id=?", Integer.class, UUID.fromString(other))).isZero();
    }
    @Test void catalogFiltersSearchSellerAndVisibilityWithoutLeakingOtherSchools() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), seller = api.register(); String id = product(seller);
        jdbc.update("UPDATE users SET nickname='目录卖家晓雨' WHERE id=?", UUID.fromString(seller.id()));
        assertThat(api.ok(api.get(admin, "/v1/admin/products?q=目录卖家晓雨&category=生活用品&status=在售&moderationHidden=false&campus=东校区")).path("items").findValuesAsText("id")).contains(id);
        assertThat(api.ok(api.get(admin, "/v1/admin/products?q=" + id + "&moderationHidden=true")).path("total").asInt()).isZero();
        assertThat(status(api.get(admin, "/v1/admin/products?moderationHidden=invalid"))).isEqualTo(400);
    }
    private Trade trade() throws Exception {
        User buyer = api.register(), seller = api.register();
        jdbc.update("UPDATE users SET nickname='买家明月' WHERE id=?", UUID.fromString(buyer.id()));
        jdbc.update("UPDATE users SET nickname='卖家清风' WHERE id=?", UUID.fromString(seller.id()));
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "订单详情测试台灯", 88))).path("id").asText();
        return new Trade(buyer, seller, product, api.order(buyer, product));
    }

    @Test void ordersIncludeParticipantsProductMeetingAndHistoryWithoutCredentials() throws Exception {
        User admin = staff("SCHOOL_ADMIN"); Trade trade = trade();
        var summary = api.ok(api.get(admin, "/v1/admin/orders?q=" + trade.orderId())).path("items").get(0);
        assertThat(summary.path("productTitle").asText()).isEqualTo("订单详情测试台灯");
        assertThat(summary.path("buyerNickname").asText()).isEqualTo("买家明月");
        assertThat(summary.path("sellerNickname").asText()).isEqualTo("卖家清风");
        assertThat(summary.path("buyerAccount").asText()).isNotBlank();
        assertThat(summary.path("sellerAccount").asText()).isNotBlank();
        assertThat(summary.path("productImage").asText()).isEqualTo("https://example.invalid/a.png");
        assertThat(summary.path("price").asInt()).isEqualTo(88);
        assertThat(summary.path("meetingPointName").asText()).isNotBlank();
        assertThat(summary.path("meetingAt").asLong()).isPositive();
        api.ok(api.post(trade.buyer(), "/v1/orders/" + trade.orderId() + "/transitions",
                Map.of("to", "CANCELLED", "reasonCode", "OTHER", "note", "临时调整面交安排")));
        var detail = api.ok(api.get(admin, "/v1/admin/orders/" + trade.orderId()));
        assertThat(detail.path("productDescription").asText()).isEqualTo("毕业季供给测试");
        assertThat(detail.path("productImages").size()).isEqualTo(1);
        assertThat(detail.path("categorySnapshot").asText()).isEqualTo("生活用品");
        assertThat(detail.path("events").size()).isEqualTo(2);
        assertThat(detail.path("events").get(1).path("toStatus").asText()).isEqualTo("CANCELLED");
        assertThat(detail.path("cancellation").path("note").asText()).isEqualTo("临时调整面交安排");
        assertThat(detail.path("reviews").isArray()).isTrue();
        assertThat(detail.path("bundleItems").isArray()).isTrue();
        for (var record : new com.fasterxml.jackson.databind.JsonNode[]{summary, detail})
            assertThat(record.toString()).doesNotContain("confirmationCode", "confirmation_code", "password", "contact", "idempotency", "request_hash", "dormBuilding");
    }

    @Test void orderSearchSupportsProductAndPartiesAndAmountUsesOrderSnapshot() throws Exception {
        User auditor = staff("AUDITOR"); Trade trade = trade();
        jdbc.update("UPDATE products SET price=999 WHERE id=?", UUID.fromString(trade.productId()));
        for (String keyword : new String[]{"订单详情测试台灯", "买家明月", "卖家清风"}) {
            var items = api.ok(api.get(auditor, "/v1/admin/orders?q=" + keyword + "&sort=price&order=ASC")).path("items");
            assertThat(items.findValuesAsText("id")).contains(trade.orderId());
        }
        String account = jdbc.queryForObject("SELECT account FROM users WHERE id=?", String.class, UUID.fromString(trade.buyer().id()));
        assertThat(api.ok(api.get(auditor, "/v1/admin/orders?q=" + account)).path("items").findValuesAsText("id")).contains(trade.orderId());
        var detail = api.ok(api.get(auditor, "/v1/admin/orders/" + trade.orderId()));
        assertThat(detail.path("price").asInt()).isEqualTo(88);
        assertThat(detail.path("productCurrentPrice").asInt()).isEqualTo(999);
        assertThat(api.ok(api.get(auditor, "/v1/admin/orders?q=%25")).path("items").size()).isZero();
    }

    @Test void orderSchoolScopeUsesFrozenTradeSchoolEvenIfProductMoves() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), outsider = api.register("后台隔离校区"); Trade trade = trade();
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'admin-other','SCHOOL_ADMIN')", UUID.fromString(outsider.id()));
        jdbc.update("UPDATE users SET campus='后台隔离校区' WHERE id=?", UUID.fromString(trade.seller().id()));
        jdbc.update("UPDATE products SET campus='后台隔离校区' WHERE id=?", UUID.fromString(trade.productId()));
        assertThat(status(api.get(admin, "/v1/admin/orders/" + trade.orderId()))).isEqualTo(200);
        assertThat(status(api.get(outsider, "/v1/admin/orders/" + trade.orderId()))).isEqualTo(404);
        assertThat(api.ok(api.get(outsider, "/v1/admin/orders?q=" + trade.orderId())).path("items").size()).isZero();
        assertThat(status(api.get(trade.buyer(), "/v1/admin/orders/" + trade.orderId()))).isEqualTo(403);
    }
}
