package com.lulu.campusmarketbackend.governance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.ExplainSupport;
import com.lulu.campusmarketbackend.support.StatementCounter;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.apache.ibatis.session.SqlSessionFactory;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 7 十四：治理数据的性能证据。多校规模（11 所学校）下：
 * 100,000 条取消记录、50,000 条举报、10,000 个案件、100,000 条治理动作、50,000 条限制、20,000 条已确认爽约。
 * 用生产 Mapper SQL 执行 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)，只断言计划形状与语句条数；不关闭顺序扫描、不断言毫秒数。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class GovernancePerformanceIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_governance_perf").withUsername("campus_gov_perf").withPassword("campus_gov_perf_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "governance-perf-it-secret-0123456789ab");
    }

    private static final String G = "com.lulu.campusmarketbackend.mapper.GovernanceMapper.";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;

    private ExplainSupport explain;
    private StatementCounter counter;
    private SupplyApi api;
    private static boolean seeded;
    static UUID pilotUser;
    static UUID pilotReporter;
    static UUID sampleCase;
    static UUID sampleProduct;
    static UUID sampleMessage;

    @BeforeEach
    void setUp() {
        explain = new ExplainSupport(sessions, dataSource);
        counter = StatementCounter.install(sessions);
        api = new SupplyApi(mockMvc, json);
        if (seeded) return;
        jdbc.update("INSERT INTO schools(id,name) SELECT 'gov-s' || g, '治理性能学校 ' || g FROM generate_series(0, 9) g");
        jdbc.update("INSERT INTO campuses(id,school_id,name) SELECT 'gov-c' || g, 'gov-s' || g, 'gov-c' || g FROM generate_series(0, 9) g");
        // 11 所学校（试点学校 + 10 所），每校 300 名用户、1,000 件商品
        jdbc.execute("""
                CREATE TEMP TABLE gov_schools AS
                SELECT 'pilot'::text AS school, '东校区'::text AS campus, 0 AS k
                UNION ALL SELECT 'gov-s' || g, 'gov-c' || g, g + 1 FROM generate_series(0, 9) g
                """);
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'gp-' || s.k || '-' || i, 'x', 'n' || i, s.campus FROM gov_schools s, generate_series(1, 300) i
                """);
        jdbc.update("""
                INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status)
                SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'gp-' || s.k || '-' || (1 + i % 300)),
                       'gp 商品 ' || i, 'd', 10, '其他', '全新', s.campus, '在售'
                FROM gov_schools s, generate_series(1, 1000) i
                """);
        // 100,000 张已取消订单与取消记录（买家与商品同校）
        jdbc.update("""
                INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact,
                                   confirmation_code, idempotency_key, request_hash, expires_at, created_at, updated_at)
                SELECT gen_random_uuid(), p.id,
                       (SELECT u.id FROM users u WHERE u.account = 'gp-' || s.k || '-' || (1 + (g * 7 + 3) % 300)),
                       p.seller_id, 10, 'CANCELLED', '东校区-library', now() - interval '3 days', 'c', '123456',
                       'gp-' || p.id || '-' || g, 'h', now() - interval '2 days', now() - (g % 60) * interval '1 day', now() - (g % 60) * interval '1 day'
                FROM gov_schools s JOIN campuses c ON c.school_id = s.school AND c.id = s.campus
                JOIN LATERAL (SELECT id, seller_id FROM products WHERE campus = s.campus ORDER BY id LIMIT 1000) p ON true
                CROSS JOIN generate_series(1, 9) g
                WHERE (SELECT u.id FROM users u WHERE u.account = 'gp-' || s.k || '-' || (1 + (g * 7 + 3) % 300)) <> p.seller_id
                """);
        jdbc.update("""
                INSERT INTO order_cancellations(order_id, school_id, actor_user_id, phase, reason_code, created_at)
                SELECT o.id, c.school_id, o.buyer_id,
                       (ARRAY['BEFORE_SELLER_CONFIRM','AFTER_SELLER_CONFIRM','AFTER_MEETING_AGREED','AFTER_ARRIVAL_REPORTED'])[1 + abs(hashtext(o.id::text)) % 4],
                       'CHANGED_MIND', o.created_at
                FROM orders o JOIN products p ON p.id = o.product_id JOIN campuses c ON c.id = p.campus
                """);
        // 每校 2 名工作人员
        jdbc.update("""
                INSERT INTO staff_members(user_id, school_id, role)
                SELECT u.id, s.school, 'MODERATOR' FROM gov_schools s JOIN users u ON u.account IN ('gp-' || s.k || '-1', 'gp-' || s.k || '-2')
                """);
        // 10,000 个案件（每件商品至多一个），状态混合
        jdbc.update("""
                INSERT INTO moderation_cases(id, school_id, target_type, target_id, status, resolution_code, resolved_at, report_count, created_at, updated_at)
                SELECT gen_random_uuid(), c.school_id, 'PRODUCT', p.id,
                       CASE WHEN r < 3 THEN 'OPEN' WHEN r < 4 THEN 'UNDER_REVIEW' WHEN r < 9 THEN 'RESOLVED' ELSE 'DISMISSED' END,
                       CASE WHEN r BETWEEN 4 AND 8 THEN 'HIDE_PRODUCT' WHEN r = 9 THEN 'NO_ACTION' END,
                       CASE WHEN r >= 4 THEN now() - interval '1 day' END,
                       5, now() - (r + 1) * interval '1 hour', now() - interval '1 hour'
                FROM (SELECT p.*, abs(hashtext(p.id::text)) % 10 AS r, row_number() OVER (ORDER BY p.id) AS n FROM products p WHERE p.title LIKE 'gp 商品%') p
                JOIN campuses c ON c.id = p.campus
                WHERE p.n <= 10000
                """);
        // 50,000 条举报：每个案件 5 位不同的同校举报人
        jdbc.update("""
                INSERT INTO moderation_reports(id, school_id, case_id, reporter_user_id, target_type, target_id, reason_code, created_at)
                SELECT gen_random_uuid(), mc.school_id, mc.id,
                       (SELECT u.id FROM users u JOIN campuses cu ON cu.id = u.campus WHERE cu.school_id = mc.school_id
                        ORDER BY u.id OFFSET (abs(hashtext(mc.id::text)) + j * 37) % 290 LIMIT 1),
                       'PRODUCT', mc.target_id, 'SPAM', mc.created_at
                FROM moderation_cases mc CROSS JOIN generate_series(1, 5) j
                ON CONFLICT DO NOTHING
                """);
        // 100,000 条治理动作（每个案件 10 条，不需要关联限制的动作码）
        jdbc.update("""
                INSERT INTO moderation_actions(id, school_id, case_id, staff_user_id, action_code, reason_code, target_type, target_id, effective, created_at,
                                               subject_user_id)
                SELECT gen_random_uuid(), mc.school_id, mc.id, st.user_id, (ARRAY['HIDE_PRODUCT','RESTORE_PRODUCT','NO_ACTION'])[1 + j % 3],
                       'POLICY_VIOLATION', 'PRODUCT', mc.target_id, j % 3 <> 2, mc.created_at + j * interval '1 minute',
                       (SELECT p.seller_id FROM products p WHERE p.id = mc.target_id)
                FROM moderation_cases mc JOIN LATERAL (SELECT user_id FROM staff_members WHERE school_id = mc.school_id LIMIT 1) st ON true
                CROSS JOIN generate_series(1, 10) j
                """);
        // 50,000 条限制（大多已到期，少量仍有效）
        jdbc.update("""
                INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at, created_at)
                SELECT gen_random_uuid(), u.id, mc.school_id, (ARRAY['BOOKING','PUBLISHING','CIRCLE_CREATION'])[1 + j % 3], 'CASE', mc.id, st.user_id, 'POLICY_VIOLATION',
                       now() - ((j * 3) % 60) * interval '1 day', now() - ((j * 3) % 60) * interval '1 day' + interval '2 days', now() - ((j * 3) % 60) * interval '1 day'
                FROM moderation_cases mc JOIN LATERAL (SELECT user_id FROM staff_members WHERE school_id = mc.school_id LIMIT 1) st ON true
                JOIN LATERAL (SELECT u.id FROM users u JOIN campuses cu ON cu.id = u.campus WHERE cu.school_id = mc.school_id
                              ORDER BY u.id OFFSET abs(hashtext(mc.id::text)) % 290 LIMIT 1) u ON true
                CROSS JOIN generate_series(1, 5) j
                """);
        // 20,000 条已确认的爽约报告（V11：每张订单先有卖家接单时冻结的明确档期快照）
        jdbc.update("""
                INSERT INTO order_slot_agreements(order_id, meeting_revision, meeting_point_id, starts_at, ends_at, source)
                SELECT o.id, 0, o.meeting_point_id, o.meeting_at, o.meeting_at + interval '1 hour', 'SELLER_ACCEPTED_BOOKING'
                FROM (SELECT * FROM orders ORDER BY id LIMIT 20000) o
                """);
        jdbc.update("""
                INSERT INTO order_no_show_reports(id, order_id, meeting_revision, school_id, reporter_user_id, reported_user_id, reason_code, created_at)
                SELECT gen_random_uuid(), o.id, 0, c.school_id, o.buyer_id, o.seller_id, 'DID_NOT_ARRIVE', o.created_at
                FROM (SELECT * FROM orders ORDER BY id LIMIT 20000) o JOIN products p ON p.id = o.product_id JOIN campuses c ON c.id = p.campus
                """);
        jdbc.update("UPDATE order_no_show_reports SET status='ACKNOWLEDGED', responded_at = created_at, confirmed_at = created_at");
        // V11：10,000 条自动限制（SYSTEM_RULE），每条 1 份依据
        jdbc.update("""
                INSERT INTO user_restrictions(id, user_id, school_id, scope, source, no_show_report_id, reason_code, starts_at, ends_at, created_at,
                                              rule_version, decided_at)
                SELECT gen_random_uuid(), n.reported_user_id, n.school_id, 'BOOKING', 'SYSTEM_RULE', n.id, 'CONFIRMED_NO_SHOW',
                       n.confirmed_at, n.confirmed_at + interval '24 hours', n.confirmed_at, 'NO_SHOW_V1', n.confirmed_at
                FROM (SELECT * FROM order_no_show_reports ORDER BY id LIMIT 10000) n
                """);
        jdbc.update("""
                INSERT INTO user_restriction_basis(restriction_id, no_show_report_id, confirmed_at)
                SELECT r.id, r.no_show_report_id, r.starts_at FROM user_restrictions r WHERE r.source = 'SYSTEM_RULE'
                """);
        // 5,000 条申诉
        jdbc.update("""
                INSERT INTO moderation_appeals(id, school_id, user_id, restriction_id, case_id, reason, created_at)
                SELECT gen_random_uuid(), r.school_id, r.user_id, r.id, r.case_id, '申诉', r.created_at
                FROM (SELECT * FROM user_restrictions ORDER BY id LIMIT 5000) r
                """);
        for (String t : List.of("orders", "order_cancellations", "moderation_cases", "moderation_reports", "moderation_actions",
                "user_restrictions", "order_no_show_reports", "moderation_appeals", "users", "products",
                "order_slot_agreements", "user_restriction_basis")) {
            jdbc.execute("VACUUM ANALYZE " + t);
        }
        pilotUser = jdbc.queryForObject("SELECT user_id FROM user_restrictions WHERE school_id = 'pilot' AND source = 'CASE' ORDER BY id LIMIT 1", UUID.class);
        pilotReporter = jdbc.queryForObject("SELECT reporter_user_id FROM moderation_reports WHERE school_id = 'pilot' ORDER BY id LIMIT 1", UUID.class);
        sampleCase = jdbc.queryForObject("SELECT id FROM moderation_cases WHERE school_id = 'pilot' ORDER BY id LIMIT 1", UUID.class);
        sampleProduct = jdbc.queryForObject("SELECT target_id FROM moderation_cases WHERE id = ?", UUID.class, sampleCase);
        seeded = true;
    }

    private ExplainSupport.Plan plan(String statement, Map<String, Object> params, String label) throws Exception {
        ExplainSupport.Plan plan = explain.explain(G + statement, params);
        System.out.println("PLAN " + label + " : " + plan.summary());
        return plan;
    }

    @Test
    @DisplayName("1. 数据规模：10 万取消记录、5 万举报、1 万案件、10 万治理动作、5 万限制、2 万已确认爽约，分布在 11 所学校")
    void volumes() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_cancellations", Long.class)).isGreaterThanOrEqualTo(95_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_reports", Long.class)).isGreaterThanOrEqualTo(49_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_cases", Long.class)).isGreaterThanOrEqualTo(10_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM moderation_actions", Long.class)).isGreaterThanOrEqualTo(100_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE source='CASE'", Long.class)).isEqualTo(50_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE source='SYSTEM_RULE'", Long.class)).isEqualTo(10_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_slot_agreements", Long.class)).isGreaterThanOrEqualTo(20_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_no_show_reports WHERE status='ACKNOWLEDGED'", Long.class)).isEqualTo(20_000);
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT school_id) FROM moderation_cases", Long.class)).isEqualTo(11);
    }

    @Test
    @DisplayName("2. 工作人员待处理列表与申诉列表：学校在索引前缀、按页取回，不跨校扫描")
    void staffQueues() throws Exception {
        Map<String, Object> q = new HashMap<>();
        q.put("schoolId", "pilot");
        q.put("status", "OPEN");
        q.put("targetType", null);
        q.put("limit", 20);
        q.put("offset", 0);
        // 7.1C：队列同时过滤掉与本人有利益冲突的案件（函数在同一条语句里逐行判断，仍走学校前缀索引）
        q.put("staff", jdbc.queryForObject("SELECT user_id FROM staff_members WHERE school_id='pilot' LIMIT 1", UUID.class));
        ExplainSupport.Plan list = plan("selectCases", q, "staff queue");
        assertThat(list.seqScanOn("moderation_cases")).isFalse();
        assertThat(list.indexesUsed()).contains("moderation_cases_queue");
        ExplainSupport.Plan count = plan("countCases", q, "staff queue count");
        assertThat(count.seqScanOn("moderation_cases")).isFalse();
        Map<String, Object> a = new HashMap<>();
        a.put("schoolId", "pilot");
        a.put("status", "PENDING");
        a.put("limit", 20);
        a.put("offset", 0);
        a.put("staff", q.get("staff"));
        ExplainSupport.Plan appeals = plan("selectAppeals", a, "appeal queue");
        assertThat(appeals.seqScanOn("moderation_appeals")).isFalse();
        assertThat(appeals.indexesUsed()).contains("moderation_appeals_queue");
    }

    @Test
    @DisplayName("3. 用户侧：我的举报、我的限制、当前有效限制、30 天爽约计数、本人取消记录都按用户索引取回")
    void userSide() throws Exception {
        ExplainSupport.Plan mine = plan("selectMyReports", Map.of("reporter", pilotReporter), "my reports");
        assertThat(mine.seqScanOn("moderation_reports")).isFalse();
        assertThat(mine.seqScanOn("moderation_cases")).isFalse();
        assertThat(mine.indexesUsed()).contains("moderation_reports_mine");
        ExplainSupport.Plan restrictions = plan("selectMyRestrictions", Map.of("userId", pilotUser), "my restrictions");
        assertThat(restrictions.seqScanOn("user_restrictions")).isFalse();
        assertThat(restrictions.indexesUsed()).contains("user_restrictions_mine");
        ExplainSupport.Plan active = plan("selectActiveRestriction", Map.of("userId", pilotUser, "scope", "BOOKING"), "active restriction");
        assertThat(active.seqScanOn("user_restrictions")).isFalse();
        assertThat(active.indexesUsed()).contains("user_restrictions_active");
        UUID reported = jdbc.queryForObject("SELECT reported_user_id FROM order_no_show_reports ORDER BY id LIMIT 1", UUID.class);
        ExplainSupport.Plan window = plan("countConfirmedNoShows", Map.of("userId", reported), "no-show window");
        assertThat(window.seqScanOn("order_no_show_reports")).isFalse();
        // V11 起计数还要判断档期快照：由覆盖订单与版本的 order_no_show_reports_confirmed_slot（只含已确认的行）取回
        assertThat(window.indexesUsed()).anyMatch(i -> i.startsWith("order_no_show_reports_confirmed"));
        assertThat(window.seqScanOn("order_slot_agreements")).isFalse();
        UUID actor = jdbc.queryForObject("SELECT actor_user_id FROM order_cancellations ORDER BY order_id LIMIT 1", UUID.class);
        ExplainSupport.Plan cancels = plan("selectOwnCancellations", Map.of("userId", actor), "own cancellations");
        assertThat(cancels.seqScanOn("order_cancellations")).isFalse();
        assertThat(cancels.indexesUsed()).contains("order_cancellations_actor");
    }

    @Test
    @DisplayName("4. 案件详情：目标案件查询、案件下的举报与动作都按案件 / 目标索引；消息目标只按主键读那一条，不读会话里的其他消息")
    void caseDetail() throws Exception {
        Map<String, Object> t = new HashMap<>();
        t.put("schoolId", "pilot");
        t.put("targetType", "PRODUCT");
        t.put("targetId", sampleProduct);
        ExplainSupport.Plan target = plan("selectCasesForTarget", t, "cases for target");
        assertThat(target.seqScanOn("moderation_cases")).isFalse();
        ExplainSupport.Plan actions = plan("selectCaseActions", Map.of("caseId", sampleCase), "case actions");
        assertThat(actions.seqScanOn("moderation_actions")).isFalse();
        assertThat(actions.indexesUsed()).contains("moderation_actions_case");
        ExplainSupport.Plan reports = plan("selectCaseReports", Map.of("caseId", sampleCase), "case reports");
        assertThat(reports.seqScanOn("moderation_reports")).isFalse();
        assertThat(reports.indexesUsed()).contains("moderation_reports_case");
        ExplainSupport.Plan message = plan("selectMessageTarget", Map.of("id", UUID.randomUUID()), "message target");
        assertThat(message.seqScanOn("messages")).isFalse();
        assertThat(message.seqScanOn("conversations")).isFalse();
    }

    @Test
    @DisplayName("6. V11：档期快照按主键；30 天计数（含快照条件）仍走已确认索引；以某次确认为依据的限制按依据索引；我的处理通知按动作涉及的用户索引")
    void v11Queries() throws Exception {
        Map<String, Object> order = jdbc.queryForMap("SELECT order_id, meeting_revision FROM order_slot_agreements ORDER BY order_id LIMIT 1");
        ExplainSupport.Plan slot = plan("selectSlotAgreement", Map.of("orderId", order.get("order_id"), "revision", order.get("meeting_revision")), "slot snapshot");
        assertThat(slot.seqScanOn("order_slot_agreements")).isFalse();
        assertThat(slot.indexesUsed()).contains("order_slot_agreements_pkey");
        UUID reported = jdbc.queryForObject("SELECT reported_user_id FROM order_no_show_reports ORDER BY id LIMIT 1", UUID.class);
        ExplainSupport.Plan window = plan("selectConfirmedNoShowsInWindow", Map.of("userId", reported), "no-show basis window");
        assertThat(window.seqScanOn("order_no_show_reports")).isFalse();
        assertThat(window.seqScanOn("order_slot_agreements")).isFalse();
        assertThat(window.indexesUsed()).anyMatch(i -> i.startsWith("order_no_show_reports_confirmed"));
        UUID report = jdbc.queryForObject("SELECT no_show_report_id FROM user_restriction_basis ORDER BY no_show_report_id LIMIT 1", UUID.class);
        ExplainSupport.Plan based = plan("lockRestrictionsBasedOn", Map.of("reportId", report), "restrictions based on report");
        assertThat(based.seqScanOn("user_restriction_basis")).isFalse();
        assertThat(based.seqScanOn("user_restrictions")).isFalse();
        assertThat(based.indexesUsed()).contains("user_restriction_basis_report");
        UUID subject = jdbc.queryForObject("SELECT subject_user_id FROM moderation_actions WHERE subject_user_id IS NOT NULL AND school_id='pilot' ORDER BY id LIMIT 1", UUID.class);
        ExplainSupport.Plan notices = plan("selectMyActionNotices", Map.of("userId", subject), "my action notices");
        assertThat(notices.seqScanOn("moderation_actions")).isFalse();
        assertThat(notices.indexesUsed()).contains("moderation_actions_subject");
        UUID restriction = jdbc.queryForObject("SELECT id FROM user_restrictions WHERE source='SYSTEM_RULE' ORDER BY id LIMIT 1", UUID.class);
        ExplainSupport.Plan basis = plan("selectBasis", Map.of("restrictionId", restriction), "restriction basis");
        assertThat(basis.seqScanOn("user_restriction_basis")).isFalse();
    }

    @Test
    @DisplayName("5. 无 N+1：案件列表的语句条数与页大小无关；案件详情与举报、动作的数量无关")
    void statementCounts() throws Exception {
        User staff = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'MODERATOR')", staff.id());
        long small = counter.during(() -> call(() -> api.ok(api.get(staff, "/v1/moderation/cases?size=20"))));
        long large = counter.during(() -> call(() -> api.ok(api.get(staff, "/v1/moderation/cases?size=100&page=3"))));
        System.out.println("STATEMENTS case list size=20 -> " + small + ", size=100 -> " + large);
        assertThat(large).isEqualTo(small);
        List<String> ids = new ArrayList<>();
        for (int n : new int[]{1, 30}) {
            UUID product = jdbc.queryForObject("SELECT id FROM products WHERE campus='东校区' AND NOT EXISTS (SELECT 1 FROM moderation_cases c WHERE c.target_id = products.id) ORDER BY id LIMIT 1", UUID.class);
            UUID caseId = UUID.randomUUID();
            jdbc.update("INSERT INTO moderation_cases(id, school_id, target_type, target_id, report_count) VALUES (?, 'pilot', 'PRODUCT', ?, ?)", caseId, product, n);
            jdbc.update("""
                    INSERT INTO moderation_reports(id, school_id, case_id, reporter_user_id, target_type, target_id, reason_code)
                    SELECT gen_random_uuid(), 'pilot', ?, u.id, 'PRODUCT', ?, 'SPAM'
                    FROM (SELECT u.id FROM users u WHERE u.campus = '东校区' ORDER BY u.id LIMIT ?) u
                    """, caseId, product, n);
            jdbc.update("""
                    INSERT INTO moderation_actions(id, school_id, case_id, staff_user_id, action_code, reason_code, target_type, target_id, effective)
                    SELECT gen_random_uuid(), 'pilot', ?, ?::uuid, 'NO_ACTION', 'DUPLICATE', 'PRODUCT', ?, false FROM generate_series(1, ?)
                    """, caseId, staff.id(), product, n);
            ids.add(caseId.toString());
        }
        long one = counter.during(() -> call(() -> api.ok(api.get(staff, "/v1/moderation/cases/" + ids.get(0)))));
        long thirty = counter.during(() -> call(() -> api.ok(api.get(staff, "/v1/moderation/cases/" + ids.get(1)))));
        System.out.println("STATEMENTS case detail 1 report -> " + one + ", 30 reports -> " + thirty);
        assertThat(thirty).isEqualTo(one);
    }

    @FunctionalInterface
    interface ThrowingRunnable { void run() throws Exception; }

    private static void call(ThrowingRunnable r) {
        try {
            r.run();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
