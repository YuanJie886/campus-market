package com.lulu.campusmarketbackend.circle;

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
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 6 十一、性能证据：1,000 个圈子、20,000 条成员关系、50,000 件商品（公开与圈子可见混合）、
 * 10,000 条圈子订阅。对生产 Mapper SQL 执行 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)，只断言计划形状与语句条数，
 * 不断言毫秒数，也不关闭顺序扫描。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.circle-create.limit=1000",
        "campus-market.rate-limit.circle-invite-create.limit=1000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CirclePerformanceIT {

    private static final String PRODUCT = "com.lulu.campusmarketbackend.mapper.ProductMapper.";
    private static final String DEMAND = "com.lulu.campusmarketbackend.mapper.DemandMapper.";
    private static final String CIRCLE = "com.lulu.campusmarketbackend.mapper.CircleMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_circle_perf")
            .withUsername("campus_cp").withPassword("campus_cp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "circle-perf-it-secret-0123456789abcdef");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;
    @Autowired TransactionTemplate tx;

    private ExplainSupport explain;
    private StatementCounter counter;
    private SupplyApi api;
    private static boolean seeded;
    static UUID member;
    static UUID sampleCircle;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        counter = StatementCounter.install(sessions);
        api = new SupplyApi(mockMvc, json);
        if (seeded) return;
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'cp-' || lpad(g::text, 5, '0'), 'x', 'perf', '东校区'
                FROM generate_series(0, 1999) g
                """);
        // 1,000 个圈子：每个圈子 20 名成员（第 1 名为 OWNER），共 20,000 条成员关系
        tx.executeWithoutResult(s -> {
            jdbc.update("""
                    INSERT INTO circles(id, school_id, type, name, visibility, owner_user_id)
                    SELECT gen_random_uuid(), 'pilot', (ARRAY['CLASS','CLUB','INTEREST','OTHER'])[1 + g % 4], '性能圈 ' || g,
                           CASE WHEN g % 3 = 0 THEN 'DISCOVERABLE' ELSE 'PRIVATE' END,
                           (SELECT id FROM users WHERE account = 'cp-' || lpad(((g * 20) % 2000)::text, 5, '0'))
                    FROM generate_series(0, 999) g
                    """);
            jdbc.update("""
                    INSERT INTO circle_memberships(circle_id, user_id, school_id, role)
                    SELECT c.id, u.id, 'pilot', CASE WHEN k = 0 THEN 'OWNER' ELSE 'MEMBER' END
                    FROM (SELECT id, owner_user_id, split_part(name, ' ', 2)::int AS n FROM circles) c
                    CROSS JOIN generate_series(0, 19) k
                    JOIN users u ON u.account = 'cp-' || lpad((((c.n * 20) + k) % 2000)::text, 5, '0')
                    ON CONFLICT DO NOTHING
                    """);
        });
        // 50,000 件商品：80% 公开，20% 圈子可见（每件关联其卖家所在的 1～3 个圈子）
        tx.executeWithoutResult(s -> {
            jdbc.update("""
                    INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, visibility, building_id, created_at)
                    SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'cp-' || lpad((g % 2000)::text, 5, '0')),
                           'perf circle item ' || g, 'd', 10 + g % 90,
                           (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6], '全新', '东校区',
                           CASE WHEN g % 10 = 0 THEN '已售出' ELSE '在售' END,
                           CASE WHEN g % 5 = 0 THEN 'CIRCLE_ONLY' ELSE 'PUBLIC' END,
                           (ARRAY['east-qinyuan-1','east-qinyuan-2','east-qinyuan-3','east-songyuan-4','east-songyuan-5'])[1 + g % 5],
                           now() - (g || ' seconds')::interval
                    FROM generate_series(0, 49999) g
                    """);
            jdbc.update("""
                    INSERT INTO product_circle_visibility(product_id, circle_id)
                    SELECT p.id, m.circle_id FROM products p
                    CROSS JOIN LATERAL (SELECT circle_id FROM circle_memberships
                                        WHERE user_id = p.seller_id AND status = 'ACTIVE'
                                        ORDER BY circle_id LIMIT 1 + (abs(hashtext(p.id::text)) % 3)) m
                    WHERE p.visibility = 'CIRCLE_ONLY'
                    """);
        });
        // 10,000 条圈子订阅 + 5,000 条普通订阅
        jdbc.update("""
                INSERT INTO demand_subscriptions(id, user_id, school_id, keyword, normalized_keyword, category, geo_scope, fingerprint, circle_id)
                SELECT gen_random_uuid(), m.user_id, 'pilot', 'kw' || m.rn, 'kw' || m.rn,
                       (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + m.rn % 6], 'SCHOOL',
                       md5('c' || m.rn) || md5(m.user_id::text), m.circle_id
                FROM (SELECT user_id, circle_id, row_number() OVER (ORDER BY circle_id, user_id) AS rn FROM circle_memberships) m
                WHERE m.rn <= 10000
                """);
        jdbc.update("""
                INSERT INTO demand_subscriptions(id, user_id, school_id, keyword, normalized_keyword, category, geo_scope, fingerprint)
                SELECT gen_random_uuid(), u.id, 'pilot', 'pk' || g, 'pk' || g,
                       (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6], 'SCHOOL', md5('p' || g) || md5(u.id::text)
                FROM generate_series(0, 4999) g JOIN users u ON u.account = 'cp-' || lpad((g % 2000)::text, 5, '0')
                """);
        for (String table : new String[]{"users", "circles", "circle_memberships", "products", "product_circle_visibility", "demand_subscriptions"}) {
            jdbc.execute("ANALYZE " + table);
        }
        member = jdbc.queryForObject("SELECT id FROM users WHERE account='cp-00042'", UUID.class);
        sampleCircle = jdbc.queryForObject("SELECT circle_id FROM circle_memberships WHERE user_id=? ORDER BY circle_id LIMIT 1", UUID.class, member);
        seeded = true;
    }

    private ExplainSupport.Plan plan(String statement, Map<String, Object> params, String label) throws Exception {
        ExplainSupport.Plan plan = explain.explain(statement, params);
        System.out.println("PLAN " + label + " : " + plan.summary());
        return plan;
    }

    private static Map<String, Object> listParams(UUID uid) {
        Map<String, Object> m = new HashMap<>();
        m.put("uid", uid);
        for (String k : List.of("category", "campus", "condition", "keyword", "minPrice", "maxPrice")) m.put(k, null);
        m.put("orderBy", "p.created_at DESC");
        m.put("limit", 20);
        m.put("offset", 0);
        return m;
    }

    private static Map<String, Object> feedParams(UUID uid, String scope, UUID circleId) {
        Map<String, Object> p = new HashMap<>();
        p.put("uid", uid);
        for (String k : List.of("category", "condition", "keyword", "minPrice", "maxPrice", "textbookEditionIds")) p.put(k, null);
        p.put("scope", scope);
        p.put("buildingId", "east-qinyuan-1");
        p.put("campus", "东校区");
        p.put("zone", "沁园");
        p.put("orderBy", "p.created_at DESC");
        p.put("originBuildingId", "east-qinyuan-1");
        p.put("originLat", 31.0);
        p.put("originLng", 121.0);
        p.put("onSaleOnly", false);
        p.put("circleId", circleId);
        p.put("limit", 20);
        p.put("offset", 0);
        return p;
    }

    @Test
    @DisplayName("1. 数据规模：1,000 个圈子、20,000 条成员关系、50,000 件商品（公开与圈子可见混合）、10,000 条圈子订阅")
    void volume() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circles", Long.class)).isGreaterThanOrEqualTo(1000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships", Long.class)).isGreaterThanOrEqualTo(20000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products", Long.class)).isGreaterThanOrEqualTo(50000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE visibility='CIRCLE_ONLY'", Long.class)).isGreaterThanOrEqualTo(10000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE circle_id IS NOT NULL", Long.class)).isEqualTo(10000);
    }

    @Test
    @DisplayName("2. 首页公开列表（未登录 / 成员）按 products_created_order 顺序读取、凑满一页即停，不再全表扫描 + 排序；圈子关系只按索引探测；搜索计数不扫关系或成员全表")
    void publicList() throws Exception {
        for (UUID viewer : new UUID[]{null, member}) {
            ExplainSupport.Plan p = plan(PRODUCT + "selectProductRows", listParams(viewer), "home list viewer=" + viewer);
            assertThat(p.seqScanOn("product_circle_visibility")).isFalse();
            assertThat(p.seqScanOn("circle_memberships")).isFalse();
            assertThat(p.sql()).as("生产 SQL 调用权威可见性函数").contains("product_visible_to");
            assertThat(p.seqScanOn("products")).as("首页不因可见性判断退化为全表扫描").isFalse();
            assertThat(p.indexesUsed()).contains("products_created_order");
        }
        Map<String, Object> search = listParams(member);
        search.put("keyword", "perf circle item 12");
        ExplainSupport.Plan count = plan(PRODUCT + "countProductRows", search, "search count");
        assertThat(count.seqScanOn("product_circle_visibility")).isFalse();
        assertThat(count.seqScanOn("circle_memberships")).isFalse();
    }

    @Test
    @DisplayName("3. 圈子商品流按 product_circle_visibility_circle 取回；楼栋 feed 叠加圈子权限不扫关系全表；商品详情权限按主键")
    void circleFeedAndDetail() throws Exception {
        ExplainSupport.Plan circleFeed = plan(PRODUCT + "selectFeedRows", feedParams(member, "SCHOOL", sampleCircle), "circle feed");
        assertThat(circleFeed.seqScanOn("product_circle_visibility")).isFalse();
        assertThat(circleFeed.indexesUsed()).contains("product_circle_visibility_circle");
        ExplainSupport.Plan circleCount = plan(PRODUCT + "countFeedRows", feedParams(member, "SCHOOL", sampleCircle), "circle feed count");
        assertThat(circleCount.seqScanOn("product_circle_visibility")).isFalse();

        ExplainSupport.Plan building = plan(PRODUCT + "selectFeedRows", feedParams(member, "BUILDING", null), "building feed with circles");
        assertThat(building.seqScanOn("products")).isFalse();
        assertThat(building.seqScanOn("product_circle_visibility")).isFalse();
        assertThat(building.seqScanOn("circle_memberships")).isFalse();

        UUID circleProduct = jdbc.queryForObject("SELECT product_id FROM product_circle_visibility WHERE circle_id=? LIMIT 1", UUID.class, sampleCircle);
        Map<String, Object> detail = new HashMap<>();
        detail.put("id", circleProduct);
        detail.put("uid", member);
        ExplainSupport.Plan d = plan(PRODUCT + "selectRowForViewer", detail, "detail readable");
        assertThat(d.seqScanOn("products")).isFalse();
        assertThat(d.seqScanOn("product_circle_visibility")).isFalse();
        assertThat(d.seqScanOn("orders")).isFalse();
    }

    @Test
    @DisplayName("4. 需求匹配：圈子商品只按 demand_subscriptions_match_circle 取圈子订阅；公开商品走排除了圈子订阅的 match_public")
    void demandCandidates() throws Exception {
        Map<String, Object> c = new HashMap<>();
        c.put("schoolId", "pilot");
        c.put("sellerId", UUID.randomUUID());
        c.put("category", "生活用品");
        c.put("price", new BigDecimal("20"));
        c.put("normalizedTitle", "kw12 台灯");
        c.put("normalizedDescription", "d");
        c.put("campus", "东校区");
        c.put("buildingId", "east-qinyuan-1");
        c.put("zone", "沁园");
        c.put("textbookEditionId", null);
        c.put("circleIds", List.of(sampleCircle));
        ExplainSupport.Plan circle = plan(DEMAND + "selectMatchCandidates", c, "circle candidates");
        assertThat(circle.seqScanOn("demand_subscriptions")).isFalse();
        assertThat(circle.indexesUsed()).contains("demand_subscriptions_match_circle");
        c.put("circleIds", null);
        ExplainSupport.Plan pub = plan(DEMAND + "selectMatchCandidates", c, "public candidates");
        assertThat(pub.seqScanOn("demand_subscriptions")).isFalse();
        assertThat(pub.indexesUsed()).contains("demand_subscriptions_match_public");
    }

    @Test
    @DisplayName("5. 我的圈子走 circle_memberships_user_active；成员管理按主键前缀取回，不扫成员全表")
    void circlePages() throws Exception {
        Map<String, Object> mine = new HashMap<>();
        mine.put("userId", member);
        ExplainSupport.Plan my = plan(CIRCLE + "selectMyCircles", mine, "my circles");
        assertThat(my.seqScanOn("circle_memberships")).isFalse();
        assertThat(my.indexesUsed()).contains("circle_memberships_user_active");
        Map<String, Object> members = new HashMap<>();
        members.put("circleId", sampleCircle);
        members.put("limit", 20);
        members.put("offset", 0);
        ExplainSupport.Plan m = plan(CIRCLE + "selectMembers", members, "members");
        assertThat(m.seqScanOn("circle_memberships")).isFalse();
    }

    @Test
    @DisplayName("6. 无 N+1：商品卡片不逐条查圈子；关联 1 个与 5 个圈子时列表与详情的语句条数相同；公开列表语句数与圈子功能无关")
    void statementCounts() throws Exception {
        User seller = api.register();
        List<String> circles = new java.util.ArrayList<>();
        for (int i = 0; i < 5; i++) circles.add(api.createCircle(seller, "计数圈 " + i, "PRIVATE"));
        String one = api.circleProduct(seller, "counter one circle", circles.get(0));
        String five = api.circleProduct(seller, "counter five circles", circles.toArray(String[]::new));
        long detailOne = counter.during(() -> call(() -> api.ok(api.get(seller, "/v1/products/" + one))));
        long detailFive = counter.during(() -> call(() -> api.ok(api.get(seller, "/v1/products/" + five))));
        System.out.println("STATEMENTS detail 1 circle=" + detailOne + " 5 circles=" + detailFive);
        assertThat(detailFive).isEqualTo(detailOne);
        long listOne = counter.during(() -> call(() -> api.ok(api.get(seller, "/v1/products?keyword=counter one"))));
        long listFive = counter.during(() -> call(() -> api.ok(api.get(seller, "/v1/products?keyword=counter"))));
        long publicList = counter.during(() -> call(() -> api.ok(api.get(seller, "/v1/products?keyword=perf circle item 1"))));
        System.out.println("STATEMENTS list 1=" + listOne + " both=" + listFive + " public=" + publicList);
        assertThat(listFive).isEqualTo(listOne);
        assertThat(publicList).isEqualTo(listOne);
    }

    @Test
    @DisplayName("7. 6.1C 成员分页：1000 人的圈子按 circle_memberships_page 索引顺序取页（首页与第 40 页都不排序全部成员）；每页语句条数与页大小、页码无关")
    void memberPagination() throws Exception {
        User owner = api.register();
        String circle = api.createCircle(owner, "千人圈", "PRIVATE");
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) "
                + "SELECT gen_random_uuid(), 'k-' || ? || '-' || g, 'x', '千人' || g, '东校区' FROM generate_series(1, 999) g", circle);
        jdbc.update("INSERT INTO circle_memberships(circle_id, user_id, school_id, role, joined_at) "
                + "SELECT ?::uuid, u.id, 'pilot', 'MEMBER', now() - (row_number() OVER (ORDER BY u.account)) * interval '1 second' "
                + "FROM users u WHERE u.account LIKE 'k-' || ? || '-%'", circle, circle);
        jdbc.execute("VACUUM ANALYZE circle_memberships");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND status='ACTIVE'", Long.class, circle)).isEqualTo(1000);
        for (int offset : new int[]{0, 780}) {
            Map<String, Object> q = new HashMap<>();
            q.put("circleId", UUID.fromString(circle));
            q.put("limit", 20);
            q.put("offset", offset);
            ExplainSupport.Plan p = plan(CIRCLE + "selectMembers", q, "members offset " + offset);
            assertThat(p.seqScanOn("circle_memberships")).isFalse();
            assertThat(p.indexesUsed()).as("offset %d", offset).contains("circle_memberships_page");
            assertThat(p.seqScanOn("users")).as("只按主键取这一页成员的昵称与头像").isFalse();
            assertThat(p.nodes()).as("不对 1000 名成员排序：计划里的排序（如有）只处理这一页").allSatisfy(n -> {
                if ("Sort".equals(n.path("Node Type").asText())) assertThat(n.path("Actual Rows").asLong()).isLessThanOrEqualTo(20);
            });
        }
        long small = counter.during(() -> call(() -> api.ok(api.get(owner, "/v1/circles/" + circle + "/members?size=20"))));
        long large = counter.during(() -> call(() -> api.ok(api.get(owner, "/v1/circles/" + circle + "/members?size=100&page=10"))));
        System.out.println("STATEMENTS members size=20 -> " + small + ", size=100 page=10 -> " + large);
        assertThat(large).as("无 N+1：成员投影一次取回").isEqualTo(small);
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
