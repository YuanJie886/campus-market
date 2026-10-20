package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 7：V10 的数据库层保证（绕过接口直接写库也成立）：爽约报告状态机与参与者约束、案件结果不可改、
 * 举报与动作只增不改、申诉只能决定一次、被治理隐藏的商品在权威可见性函数里只对卖家可见。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GovernanceSchemaIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_governance_schema").withUsername("campus_gov_schema").withPassword("campus_gov_schema_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "governance-schema-it-secret-0123456789");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    @Test
    @DisplayName("2. 案件：同一目标只有一个未结案件；结果写入后不能更换、不能改回待处理；不能删除。举报与动作只增不改；申诉只能决定一次、内容不可改、每条限制只能申诉一次")
    void casesActionsAppeals() throws Exception {
        User staff = api.register(), target = api.register(), reporter = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'MODERATOR')", staff.id());
        String caseId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO moderation_cases(id, school_id, target_type, target_id) VALUES (?::uuid, 'pilot', 'USER', ?::uuid)", caseId, target.id());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO moderation_cases(id, school_id, target_type, target_id) VALUES (gen_random_uuid(), 'pilot', 'USER', ?::uuid)", target.id()))
                .isInstanceOf(DataAccessException.class);
        jdbc.update("INSERT INTO moderation_reports(id, school_id, case_id, reporter_user_id, target_type, target_id, reason_code) "
                + "VALUES (gen_random_uuid(), 'pilot', ?::uuid, ?::uuid, 'USER', ?::uuid, 'SPAM')", caseId, reporter.id(), target.id());
        assertThatThrownBy(() -> jdbc.update("UPDATE moderation_reports SET note='改写' WHERE case_id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM moderation_reports WHERE case_id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);

        jdbc.update("UPDATE moderation_cases SET status='RESOLVED', resolution_code='RESTRICT_CONTACT', resolved_at=now() WHERE id=?::uuid", caseId);
        assertThatThrownBy(() -> jdbc.update("UPDATE moderation_cases SET resolution_code='NO_ACTION' WHERE id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE moderation_cases SET status='OPEN' WHERE id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM moderation_cases WHERE id=?::uuid", caseId)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO moderation_actions(id, school_id, case_id, staff_user_id, action_code, reason_code, target_type, target_id) "
                + "VALUES (gen_random_uuid(), 'pilot', ?::uuid, ?::uuid, 'RESTRICT_CONTACT', 'OTHER', 'USER', ?::uuid)", caseId, staff.id(), target.id()))
                .as("限制动作必须关联一条限制与期限").isInstanceOf(DataAccessException.class);

        String restriction = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at) "
                + "VALUES (?::uuid, ?::uuid, 'pilot', 'CONTACT', 'CASE', ?::uuid, ?::uuid, 'OTHER', now(), now() + interval '1 day')", restriction, target.id(), caseId, staff.id());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, reason_code, starts_at, ends_at) "
                + "VALUES (gen_random_uuid(), ?::uuid, 'pilot', 'CONTACT', 'CASE', 'OTHER', now(), now() + interval '1 day')", target.id()))
                .as("限制必须有来源案件与工作人员").isInstanceOf(DataAccessException.class);
        String appeal = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO moderation_appeals(id, school_id, user_id, restriction_id, case_id, reason) VALUES (?::uuid, 'pilot', ?::uuid, ?::uuid, ?::uuid, '申诉')",
                appeal, target.id(), restriction, caseId);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO moderation_appeals(id, school_id, user_id, restriction_id, reason) VALUES (gen_random_uuid(), 'pilot', ?::uuid, ?::uuid, '再申诉')",
                target.id(), restriction)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE moderation_appeals SET reason='改写' WHERE id=?::uuid", appeal)).isInstanceOf(DataAccessException.class);
        jdbc.update("UPDATE moderation_appeals SET status='REJECTED', decided_by=?::uuid, decided_at=now() WHERE id=?::uuid", staff.id(), appeal);
        assertThatThrownBy(() -> jdbc.update("UPDATE moderation_appeals SET status='ACCEPTED' WHERE id=?::uuid", appeal)).isInstanceOf(DataAccessException.class);
        jdbc.update("UPDATE user_restrictions SET revoked_at=now(), revoked_by=?::uuid, revoke_reason='STAFF_CORRECTION' WHERE id=?::uuid", staff.id(), restriction);
        assertThatThrownBy(() -> jdbc.update("UPDATE user_restrictions SET revoke_reason='APPEAL_ACCEPTED' WHERE id=?::uuid", restriction))
                .as("撤销只能写一次").isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("3. 被治理隐藏的商品：权威可见性函数对卖家为真、对同校其他人为假；已同意的联系请求不构成读取例外")
    void hiddenProductVisibility() throws Exception {
        User seller = api.register(), buyer = api.register(), viewer = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "隐藏函数", 10))).path("id").asText();
        api.approvedContact(seller, buyer, product);
        jdbc.update("UPDATE products SET moderation_hidden_at = now() WHERE id=?::uuid", product);
        String visible = "SELECT product_visible_to(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, ?::uuid) FROM products p WHERE p.id=?::uuid";
        String readable = "SELECT product_readable_by(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, ?::uuid) FROM products p WHERE p.id=?::uuid";
        assertThat(jdbc.queryForObject(visible, Boolean.class, seller.id(), product)).isTrue();
        assertThat(jdbc.queryForObject(visible, Boolean.class, viewer.id(), product)).isFalse();
        assertThat(jdbc.queryForObject(visible, Boolean.class, buyer.id(), product)).as("已同意联系请求的买家").isFalse();
        assertThat(jdbc.queryForObject(readable, Boolean.class, buyer.id(), product)).as("没有订单，联系请求不授予读取例外").isFalse();
        assertThat(jdbc.queryForObject(readable, Boolean.class, viewer.id(), product)).isFalse();
        // V9 的 4 参数版本委托给同一套规则
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, ?::uuid) FROM products WHERE id=?::uuid", Boolean.class, viewer.id(), product)).isFalse();
    }
}
