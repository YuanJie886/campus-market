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
}
