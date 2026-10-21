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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 7 十一：真实 PostgreSQL 上的治理竞态。每组跑多轮，断言的是任何交错下都成立的确定结果；
 * 全部依靠行锁与数据库约束（案件 FOR UPDATE、用户 FOR SHARE / FOR NO KEY UPDATE），不依赖任何单机内存锁。
 * 平台改为「只展示商品 + 联系请求」后，依赖下单 / 取消 / 改约 / 爽约报告的 9 组竞态已退役（见 docs/phase-0-test-retirement.md）。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.moderation-report.limit=1000",
        "campus-market.rate-limit.appeal-submit.limit=1000",
        "campus-market.rate-limit.circle-create.limit=1000",
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

    private User staff(String role) throws Exception {
        User u = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', ?)", u.id(), role);
        return u;
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
    @DisplayName("8b. 所有者先归档、工作人员后提交归档（竞态里 CI 上出现过的顺序）：工作人员 200，动作记录为未生效，归档事件只有所有者一条")
    void ownerArchivesFirstThenStaffArchiveIsRecordedAsNotEffective() throws Exception {
        User senior = staff("SENIOR_MODERATOR");
        User owner = api.register(), member = api.register();
        String circle = api.createCircle(owner, "先归档后处理", "PRIVATE");
        api.join(owner, circle, member);
        String caseId = report(member, "CIRCLE", circle, "SPAM");
        api.ok(api.post(owner, "/v1/circles/" + circle + "/archive", Map.of()));
        assertThat(status(decide(senior, caseId, "ARCHIVE_CIRCLE", "POLICY_VIOLATION", null))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM moderation_cases WHERE id=?::uuid", String.class, caseId)).isEqualTo("RESOLVED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions WHERE case_id=?::uuid AND NOT effective", Long.class, caseId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", Long.class, circle)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT actor_user_id::text FROM circle_events WHERE circle_id=?::uuid AND event_code='CIRCLE_ARCHIVED'", String.class, circle)).isEqualTo(owner.id());
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
            api.ok(decide(a, caseId, "RESTRICT_CONTACT", "POLICY_VIOLATION", 1));
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
