package com.lulu.campusmarketbackend;

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

import com.lulu.campusmarketbackend.building.BuildingFeedService;
import com.lulu.campusmarketbackend.building.BuildingScope;

import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 楼栋集市 feed 在万级数据下的执行计划（1.7A）。
 *
 * <p>数据只存在于这个一次性容器：20,000 件商品由 generate_series 在测试启动时生成，
 * 不写进任何迁移脚本。断言只针对<b>计划形态</b>（有没有全表扫描、用了哪个索引），
 * 耗时只打印进报告，不做依赖机器性能的毫秒硬断言。也<b>不</b>关闭 enable_seqscan——
 * 那样得到的是一个被强迫出来的计划，证明不了任何事。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class BuildingFeedPerformanceIT {

    static final int PRODUCTS = 20_000;
    private static final String MAPPER = "com.lulu.campusmarketbackend.mapper.ProductMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_perf")
            .withUsername("campus_perf").withPassword("campus_perf_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "building-perf-it-secret-0123456789ab");
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private SqlSessionFactory sessions;
    @Autowired private DataSource dataSource;
    @Autowired private BuildingFeedService feeds;
    private ExplainSupport explain;
    /**
     * 只生成一次数据。不用 PER_CLASS + @BeforeAll：那种生命周期下 Spring 会在
     * Testcontainers 启动容器之前就加载上下文，拿不到 JDBC URL。
     */
    private static boolean seeded;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        if (seeded) return;
        seeded = true;
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'perf-seller-' || lpad(g::text, 4, '0'), 'x', 'perf',
                       (ARRAY['东校区','西校区','南校区','北校区'])[1 + g % 4]
                FROM generate_series(0, 199) g
                """);
        // 80% 的商品有楼栋，按 (g/5)%20 均匀落到 20 栋楼；20% 没有楼栋，只有校区。
        // 状态 20 格一轮：14 在售、3 已售出、2 已下架、1 预约中。
        jdbc.update("""
                WITH sellers AS (SELECT array_agg(id ORDER BY account) AS ids
                                 FROM users WHERE account LIKE 'perf-seller-%'),
                     blds AS (SELECT array_agg(id ORDER BY id) AS ids,
                                     array_agg(campus_id ORDER BY id) AS campuses FROM buildings WHERE active)
                INSERT INTO products(id, seller_id, title, description, price, category, condition,
                                     campus, images, contact, status, views, created_at, building_id)
                SELECT gen_random_uuid(),
                       sellers.ids[1 + g % 200],
                       'perf 商品 ' || g, '批量生成的性能测试商品 ' || g,
                       1 + (g % 500),
                       (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6],
                       '全新',
                       CASE WHEN g % 5 = 0 THEN (ARRAY['东校区','西校区','南校区','北校区'])[1 + g % 4]
                            ELSE blds.campuses[1 + (g / 5) % 20] END,
                       '[]'::jsonb, '',
                       (ARRAY['在售','在售','在售','在售','在售','在售','在售','在售','在售','在售',
                              '在售','在售','在售','在售','已售出','已售出','已售出','已下架','已下架','预约中'])
                           [1 + (g / 7) % 20],
                       0,
                       now() - (g || ' minutes')::interval,
                       CASE WHEN g % 5 = 0 THEN NULL ELSE blds.ids[1 + (g / 5) % 20] END
                FROM generate_series(0, ?) g, sellers, blds
                """, PRODUCTS - 1);
        // 批量写入后必须更新统计信息，否则优化器会按「空表」做估算
        jdbc.execute("ANALYZE products");
        jdbc.execute("ANALYZE buildings");
    }

    private Map<String, Object> feedParams(String scope) {
        Map<String, Object> p = new HashMap<>();
        // 6.1A：feed 永远有一个登录的查看者（试点学校的种子用户）
        p.put("uid", jdbc.queryForObject("SELECT u.id FROM users u JOIN campuses c ON c.id = u.campus WHERE c.school_id = 'pilot' ORDER BY u.created_at LIMIT 1", java.util.UUID.class));
        p.put("category", null);
        p.put("condition", null);
        p.put("keyword", null);
        p.put("minPrice", null);
        p.put("maxPrice", null);
        p.put("scope", scope);
        p.put("buildingId", "east-qinyuan-1");
        p.put("campus", "东校区");
        p.put("zone", "沁园");
        p.put("orderBy", "p.created_at DESC");
        p.put("originBuildingId", "east-qinyuan-1");
        p.put("originLat", 31.0);
        p.put("originLng", 121.0);
        p.put("limit", 20);
        p.put("offset", 0);
        return p;
    }

    /** 生成本报告用的计划摘要，统一打印前缀便于从日志里取回。 */
    private ExplainSupport.Plan plan(String statement, Map<String, Object> params, String label) throws Exception {
        ExplainSupport.Plan plan = explain.explain(MAPPER + statement, params);
        System.out.println("PLAN " + label + " : " + plan.summary());
        return plan;
    }

    @Test
    @DisplayName("1. BUILDING 精确过滤：计数走 products_building_status；列表走它或 V9 的 products_created_order（按最新顺序读、凑满一页即停）；都不对 products 全表扫描")
    void buildingScopeUsesIndex() throws Exception {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products", Long.class)).isEqualTo(PRODUCTS);

        ExplainSupport.Plan count = plan("countFeedRows", feedParams("BUILDING"), "count BUILDING");
        assertThat(count.seqScanOn("products")).as("本楼计数不得全表扫描").isFalse();
        assertThat(count.indexesUsed()).contains("products_building_status");

        ExplainSupport.Plan list = plan("selectFeedRows", feedParams("BUILDING"), "latest BUILDING");
        assertThat(list.seqScanOn("products")).isFalse();
        assertThat(list.indexesUsed()).containsAnyOf("products_building_status", "products_created_order");
    }

    @Test
    @DisplayName("2. ZONE：园区内楼栋逐个走 products_building_status，不对 products 全表扫描")
    void zoneScopeUsesIndex() throws Exception {
        ExplainSupport.Plan count = plan("countFeedRows", feedParams("ZONE"), "count ZONE");
        assertThat(count.seqScanOn("products")).isFalse();
        assertThat(count.indexesUsed()).contains("products_building_status");
        // buildings 只有 20 行，对它顺序扫描是正确选择，不作为问题
    }

    @Test
    @DisplayName("3. CAMPUS 计数走 products_campus_created；SCHOOL 覆盖全表，顺序扫描是合理计划")
    void campusAndSchoolCountPlansAreReasonable() throws Exception {
        ExplainSupport.Plan campus = plan("countFeedRows", feedParams("CAMPUS"), "count CAMPUS");
        assertThat(campus.seqScanOn("products")).isFalse();
        assertThat(campus.indexesUsed()).contains("products_campus_created");

        // 全校范围就是整张表，用索引反而更慢。这里只记录计划，不强求索引
        plan("countFeedRows", feedParams("SCHOOL"), "count SCHOOL");
    }

    @Test
    @DisplayName("4. nearest：允许 Sort，但 Sort 之下必须先由索引把数据集缩小")
    void nearestSortsOnlyAfterIndexFilter() throws Exception {
        for (String scope : new String[]{"BUILDING", "ZONE", "CAMPUS"}) {
            Map<String, Object> params = feedParams(scope);
            params.put("orderBy", "nearest");
            ExplainSupport.Plan plan = plan("selectFeedRows", params, "nearest " + scope);
            assertThat(plan.nodes()).anySatisfy(n ->
                    assertThat(n.path("Node Type").asText()).isEqualTo("Sort"));
            assertThat(plan.seqScanOn("products"))
                    .as("%s 的 nearest 排序前必须先用索引缩小候选集", scope).isFalse();
        }
    }

    @Test
    @DisplayName("5. 计划与结果一致：feed 计数等于直接 SQL 计数")
    void countsMatchDirectSql() throws Exception {
        Long building = jdbc.queryForObject(
                "SELECT count(*) FROM products WHERE building_id='east-qinyuan-1' AND status <> '已下架'", Long.class);
        Long zone = jdbc.queryForObject(
                "SELECT count(*) FROM products p JOIN buildings b ON b.id=p.building_id "
                        + "WHERE b.campus_id='东校区' AND b.zone='沁园' AND b.active AND p.status <> '已下架'", Long.class);
        try (var session = sessions.openSession()) {
            assertThat((Long) session.selectOne(MAPPER + "countFeedRows", feedParams("BUILDING"))).isEqualTo(building);
            assertThat((Long) session.selectOne(MAPPER + "countFeedRows", feedParams("ZONE"))).isEqualTo(zone);
        }
        // 数据应足够「低选择性」：本楼商品只占全表很小一部分，索引才有意义
        assertThat(building).isBetween(200L, 2_000L);
    }

    @Test
    @DisplayName("6. 无 N+1：一次 feed 调用的语句数与页大小无关")
    void feedDoesNotIssuePerRowQueries() {
        UUID viewer = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus, dorm_building_id) "
                + "VALUES (?, ?, 'x', 'viewer', '东校区', 'east-qinyuan-1')", viewer, "perf-viewer-" + viewer);

        StatementCounter counter = StatementCounter.install(sessions);
        long small = counter.during(() -> feeds.feed(query(5), viewer.toString()));
        long large = counter.during(() -> feeds.feed(query(100), viewer.toString()));
        System.out.println("PLAN statements pageSize=5 -> " + small + ", pageSize=100 -> " + large);
        assertThat(small).as("计数器必须真的计到了语句，否则断言没有意义").isPositive();
        assertThat(large).as("页大小从 5 到 100，语句数必须完全相同").isEqualTo(small);
    }

    private BuildingFeedService.FeedQuery query(int pageSize) {
        return new BuildingFeedService.FeedQuery(null, null, "", null, null,
                BuildingScope.BUILDING, "nearest", 1, pageSize);
    }

}
