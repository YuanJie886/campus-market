package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.flow.OrderFlowService;
import com.lulu.campusmarketbackend.flow.TradeHistoryService;
import com.lulu.campusmarketbackend.support.ExplainSupport;
import com.lulu.campusmarketbackend.support.StatementCounter;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 可信面交闭环在万级订单下的执行计划与语句数（模块 3 第十三节）。
 *
 * <p>数据只在一次性容器里由 generate_series 生成，不写进任何迁移。
 * EXPLAIN 走生产 Mapper 的真实 SQL（ExplainSupport），不关闭 seqscan，不写毫秒硬断言。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class TrustedFlowPerformanceIT {

    static final int ORDERS = 10_000;
    static final int ITEMS_PER_TEMPLATE = 15;
    private static final String FLOW = "com.lulu.campusmarketbackend.mapper.FlowMapper.";
    private static final String INSPECTION = "com.lulu.campusmarketbackend.mapper.InspectionMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_tf_perf")
            .withUsername("campus_tfp").withPassword("campus_tfp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "trusted-flow-perf-secret-0123456789a");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;
    @Autowired OrderFlowService flows;
    @Autowired TradeHistoryService history;
    private ExplainSupport explain;
    private static boolean seeded;
    /** 参与订单最多的用户，用来测履历聚合。 */
    static UUID heavyUser;
    static UUID sampleOrder;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        if (seeded) return;
        seeded = true;
        // 一份 15 个条目的临时模板（停用状态，不影响正式模板）
        jdbc.update("INSERT INTO inspection_templates(id,category,version,title,active) VALUES ('perf-v1','其他',99,'性能模板',false)");
        jdbc.update("""
                INSERT INTO inspection_template_items(id,template_id,code,label,description,required,sort_order)
                SELECT 'perf-v1:C' || g, 'perf-v1', 'C' || lpad(g::text, 2, '0'), '条目 ' || g, '', true, g
                FROM generate_series(1, ?) g
                """, ITEMS_PER_TEMPLATE);
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'tfp-' || lpad(g::text, 4, '0'), 'x', 'perf', '东校区'
                FROM generate_series(0, 499) g
                """);
        jdbc.update("""
                INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status)
                SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'tfp-' || lpad((g % 500)::text, 4, '0')),
                       'perf ' || g, 'd', 10, '其他', '全新', '东校区', '已售出'
                FROM generate_series(0, ? - 1) g
                """, ORDERS);
        // 订单：每笔的买家与卖家不同；90% 已完成或已取消，10% 进行中（每件商品只有一笔订单）
        jdbc.update("""
                WITH p AS (SELECT id, seller_id, row_number() OVER (ORDER BY title) - 1 AS n FROM products WHERE title LIKE 'perf %'),
                     u AS (SELECT array_agg(id ORDER BY account) AS ids FROM users WHERE account LIKE 'tfp-%')
                INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact,
                                   confirmation_code, idempotency_key, request_hash, expires_at, created_at, updated_at)
                SELECT gen_random_uuid(), p.id, u.ids[1 + ((p.n * 7 + 3) % 500)], p.seller_id, 10,
                       CASE WHEN p.n % 10 = 0 THEN 'PENDING_MEETING' WHEN p.n % 3 = 0 THEN 'CANCELLED' ELSE 'COMPLETED' END,
                       '东校区-library', now() + interval '1 day', 'c', '123456', 'k' || p.n, 'h', now() + interval '2 day',
                       now() - (p.n || ' minutes')::interval, now() - (p.n || ' minutes')::interval
                FROM p, u
                WHERE u.ids[1 + ((p.n * 7 + 3) % 500)] <> p.seller_id
                """);
        jdbc.update("""
                INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, created_at)
                SELECT gen_random_uuid(), o.id, o.buyer_id, NULL, 'PENDING_SELLER_CONFIRM', o.created_at FROM orders o
                UNION ALL
                SELECT gen_random_uuid(), o.id, o.seller_id, 'PENDING_SELLER_CONFIRM', 'PENDING_MEETING', o.created_at + interval '1 minute' FROM orders o
                """);
        // 三成订单带 15 条目的验货快照
        jdbc.update("""
                INSERT INTO order_inspections(order_id, template_id, template_title_snapshot, template_version, status)
                SELECT id, 'perf-v1', '性能模板', 99, 'PENDING' FROM orders WHERE abs(hashtext(id::text)) % 10 < 3
                """);
        jdbc.update("""
                INSERT INTO order_inspection_items(order_id, item_code, label_snapshot, description_snapshot, required_snapshot,
                                                   sort_order, seller_condition_snapshot)
                SELECT i.order_id, t.code, t.label, t.description, t.required, t.sort_order, 'NORMAL'
                FROM order_inspections i CROSS JOIN inspection_template_items t WHERE t.template_id = 'perf-v1'
                """);
        // 六成已完成订单有买家评价，另有三成有卖家评价：评价规模与订单同一量级
        jdbc.update("""
                INSERT INTO reviews(id, order_id, reviewer_id, rating, comment)
                SELECT gen_random_uuid(), id, buyer_id, 1 + abs(hashtext(id::text)) % 5, 'ok'
                FROM orders WHERE status = 'COMPLETED' AND abs(hashtext(id::text || 'b')) % 10 < 6
                """);
        jdbc.update("""
                INSERT INTO reviews(id, order_id, reviewer_id, rating, comment)
                SELECT gen_random_uuid(), id, seller_id, 5, 'ok'
                FROM orders WHERE status = 'COMPLETED' AND abs(hashtext(id::text || 's')) % 10 < 3
                """);
        jdbc.update("""
                INSERT INTO order_flow_events(order_id, actor_id, event_code, meeting_revision)
                SELECT id, buyer_id, 'PRESENCE_DEPARTED', 0 FROM orders
                """);
        for (String table : new String[]{"orders", "order_events", "order_inspections", "order_inspection_items",
                "order_flow_events", "products", "users", "reviews"}) {
            jdbc.execute("ANALYZE " + table);
        }
        heavyUser = jdbc.queryForObject("""
                SELECT u FROM (SELECT buyer_id AS u FROM orders UNION ALL SELECT seller_id FROM orders) x
                GROUP BY u ORDER BY count(*) DESC, u LIMIT 1
                """, UUID.class);
        sampleOrder = jdbc.queryForObject(
                "SELECT order_id FROM order_inspections ORDER BY order_id LIMIT 1", UUID.class);
    }

    private ExplainSupport.Plan plan(String statement, Map<String, Object> params, String label) throws Exception {
        ExplainSupport.Plan plan = explain.explain(statement, params);
        System.out.println("PLAN " + label + " : " + plan.summary());
        return plan;
    }

    @Test
    @DisplayName("1. 订单验货条目按主键取回，不扫描全表")
    void inspectionItemsUsePrimaryKey() throws Exception {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_inspection_items", Long.class))
                .as("足够的数据量").isGreaterThan(40_000L);
        ExplainSupport.Plan plan = plan(INSPECTION + "selectInspectionItems", Map.of("orderId", sampleOrder), "inspection items");
        assertThat(plan.seqScanOn("order_inspection_items")).isFalse();
        assertThat(plan.indexesUsed()).contains("order_inspection_items_pkey");
    }

    @Test
    @DisplayName("2. 时间线按订单取两类事件，均走索引（V5 为 order_events 补的索引生效）")
    void timelineUsesIndexes() throws Exception {
        ExplainSupport.Plan plan = plan(FLOW + "selectTimeline", Map.of("orderId", sampleOrder), "timeline");
        assertThat(plan.seqScanOn("order_events")).as("修复前这里是对两万条事件的全表扫描").isFalse();
        assertThat(plan.seqScanOn("order_flow_events")).isFalse();
        assertThat(plan.indexesUsed()).contains("order_events_order_created", "order_flow_events_order");
    }

    @Test
    @DisplayName("3. 履历聚合：参与者过滤走 orders_buyer / orders_seller；关联表逐单按索引探测，不扫全表")
    void historyAggregatesUseIndexes() throws Exception {
        ExplainSupport.Plan own = plan(FLOW + "selectOwnCounts", Map.of("userId", heavyUser), "own counts");
        assertThat(own.seqScanOn("orders")).isFalse();
        assertThat(own.seqScanOn("order_inspections")).isFalse();
        assertThat(own.indexesUsed()).contains("orders_buyer", "orders_seller");

        ExplainSupport.Plan recent = plan(FLOW + "selectRecentOrders", Map.of("userId", heavyUser, "limit", 10), "recent");
        assertThat(recent.seqScanOn("orders")).isFalse();

        ExplainSupport.Plan pub = plan(FLOW + "selectPublicCounts", Map.of("userId", heavyUser), "public counts");
        assertThat(pub.seqScanOn("orders")).isFalse();
        assertThat(pub.seqScanOn("reviews")).as("评价按订单经唯一索引取回").isFalse();
    }

    @Test
    @DisplayName("4. 聚合结果与直接 SQL 一致")
    void aggregatesAreCorrect() {
        Map<String, Object> mine = history.own(heavyUser.toString());
        Long completed = jdbc.queryForObject("SELECT count(*) FROM orders WHERE (buyer_id=? OR seller_id=?) AND status='COMPLETED'",
                Long.class, heavyUser, heavyUser);
        assertThat(((Number) mine.get("completed")).longValue()).isEqualTo(completed);
        Map<String, Object> pub = history.publicSummary(heavyUser.toString());
        Long reviews = jdbc.queryForObject("SELECT count(*) FROM reviews r JOIN orders o ON o.id=r.order_id "
                + "WHERE (o.buyer_id=? OR o.seller_id=?) AND r.reviewer_id<>?", Long.class, heavyUser, heavyUser, heavyUser);
        assertThat(((Number) pub.get("reviewCount")).longValue()).isEqualTo(reviews);
        assertThat(((Number) pub.get("completedCount")).longValue()).isEqualTo(completed);
    }

    @Test
    @DisplayName("5. 无 N+1：15 个条目与 0 个条目的订单详情语句数相同；订单多与少的用户履历语句数相同")
    void noPerItemOrPerOrderQueries() {
        StatementCounter counter = StatementCounter.install(sessions);
        Map<String, Object> many = jdbc.queryForMap(
                "SELECT o.id, o.buyer_id FROM orders o JOIN order_inspections i ON i.order_id=o.id ORDER BY o.id LIMIT 1");
        UUID none = UUID.randomUUID();
        Map<String, Object> base = jdbc.queryForMap("SELECT product_id, buyer_id, seller_id FROM orders WHERE id=?", many.get("id"));
        UUID product = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus,status) "
                + "VALUES (?,?,'无清单','d',10,'其他','全新','东校区','已售出')", product, base.get("seller_id"));
        jdbc.update("INSERT INTO orders(id,product_id,buyer_id,seller_id,price,status,meeting_point_id,meeting_at,contact,"
                + "confirmation_code,idempotency_key,request_hash,expires_at) VALUES (?,?,?,?,10,'COMPLETED','东校区-library',"
                + "now(),'c','123456',?,'h',now())", none, product, base.get("buyer_id"), base.get("seller_id"), "none" + none);
        jdbc.update("INSERT INTO order_inspections(order_id,status) VALUES (?,'NOT_PROVIDED')", none);

        String buyer = String.valueOf(many.get("buyer_id"));
        long fifteen = counter.during(() -> flows.view(buyer, String.valueOf(many.get("id"))));
        long zero = counter.during(() -> flows.view(buyer, none.toString()));
        System.out.println("PLAN flow view statements: 15 items -> " + fifteen + ", 0 items -> " + zero);
        assertThat(fifteen).isPositive();
        assertThat(fifteen).as("条目数不影响语句数").isEqualTo(zero);

        UUID light = jdbc.queryForObject("""
                SELECT u FROM (SELECT buyer_id AS u FROM orders UNION ALL SELECT seller_id FROM orders) x
                GROUP BY u ORDER BY count(*) ASC, u LIMIT 1
                """, UUID.class);
        long heavy = counter.during(() -> history.own(heavyUser.toString()));
        long lite = counter.during(() -> history.own(light.toString()));
        long heavyPublic = counter.during(() -> history.publicSummary(heavyUser.toString()));
        long litePublic = counter.during(() -> history.publicSummary(light.toString()));
        System.out.println("PLAN history statements: heavy " + heavy + "/" + heavyPublic + ", light " + lite + "/" + litePublic);
        assertThat(heavy).isEqualTo(lite);
        assertThat(heavyPublic).isEqualTo(litePublic);
    }
}
