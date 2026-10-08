package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.demand.DemandMatchService;
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
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 需求候选查询在两万条订阅下的执行计划（2.3 / 回归第 16 项）。 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class DemandMatchPerformanceIT {

    static final int SUBSCRIPTIONS = 20_000;
    private static final String MAPPER = "com.lulu.campusmarketbackend.mapper.DemandMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_demand_perf")
            .withUsername("campus_dp").withPassword("campus_dp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "demand-perf-it-secret-0123456789abcd");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;
    @Autowired DemandMatchService matches;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    private ExplainSupport explain;
    private static boolean seeded;
    private static UUID seller;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        if (seeded) return;
        seeded = true;
        seller = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,?,?)",
                seller, "dp-seller", "x", "seller", "东校区");
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'dp-user-' || lpad(g::text, 4, '0'), 'x', 'perf',
                       (ARRAY['东校区','西校区','南校区','北校区'])[1 + g % 4]
                FROM generate_series(0, 499) g
                """);
        // 两万条订阅：80% 带关键词（2000 个不同的词，每个词约 8 人订阅），一半不限分类，
        // 地理范围四种轮换，锚点均匀落到 20 栋启用楼栋
        jdbc.update("""
                WITH u AS (SELECT array_agg(id ORDER BY account) AS ids FROM users WHERE account LIKE 'dp-user-%'),
                     b AS (SELECT array_agg(id ORDER BY id) AS ids, array_agg(campus_id ORDER BY id) AS campuses
                           FROM buildings WHERE active),
                     rows AS (
                       SELECT g,
                              CASE WHEN g % 5 = 0 THEN NULL ELSE 'kw' || (g % 2000) END AS kw,
                              CASE WHEN g % 2 = 0 OR g % 5 = 0
                                   THEN (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6]
                                   ELSE NULL END AS cat,
                              (ARRAY['SCHOOL','CAMPUS','ZONE','BUILDING'])[1 + (g / 3) % 4] AS scope,
                              1 + (g / 7) % 20 AS bi
                       FROM generate_series(0, ?) g)
                INSERT INTO demand_subscriptions(id, user_id, school_id, keyword, normalized_keyword, category,
                    min_price, max_price, geo_scope, campus_id, building_id, fingerprint)
                SELECT gen_random_uuid(), u.ids[1 + r.g % 500], 'pilot', r.kw, r.kw, r.cat,
                       CASE WHEN r.g % 3 = 0 THEN 10 ELSE NULL END,
                       CASE WHEN r.g % 3 = 0 THEN 500 ELSE NULL END,
                       r.scope,
                       CASE WHEN r.scope = 'SCHOOL' THEN NULL
                            WHEN r.scope = 'CAMPUS' THEN b.campuses[r.bi] ELSE b.campuses[r.bi] END,
                       CASE WHEN r.scope IN ('ZONE','BUILDING') THEN b.ids[r.bi] ELSE NULL END,
                       encode(sha256(r.g::text::bytea), 'hex')
                FROM rows r, u, b
                """, SUBSCRIPTIONS - 1);
        jdbc.execute("ANALYZE demand_subscriptions");
        jdbc.execute("ANALYZE buildings");
    }

    private Map<String, Object> params(String category) {
        Map<String, Object> p = new HashMap<>();
        p.put("schoolId", "pilot");
        p.put("sellerId", seller);
        p.put("category", category);
        p.put("price", new BigDecimal("100"));
        p.put("normalizedTitle", "kw42 护眼台灯");
        p.put("normalizedDescription", "九成新");
        p.put("campus", "东校区");
        p.put("buildingId", "east-qinyuan-1");
        p.put("zone", "沁园");
        return p;
    }

    @Test
    @DisplayName("1. 候选查询不对 demand_subscriptions 全表扫描，走 (school_id, category) 部分索引")
    void candidateQueryUsesIndex() throws Exception {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions", Long.class)).isEqualTo(SUBSCRIPTIONS);
        for (String category : new String[]{"数码电子", "其他"}) {
            ExplainSupport.Plan plan = explain.explain(MAPPER + "selectMatchCandidates", params(category));
            System.out.println("PLAN candidates " + category + " : " + plan.summary()
                    + " | rows=" + plan.top().path("Actual Rows").asText()
                    + " | shared hit=" + plan.top().path("Shared Hit Blocks").asText());
            assertThat(plan.seqScanOn("demand_subscriptions")).as("两万条订阅不得逐行扫描").isFalse();
            // V6 起普通订阅的候选走 demand_subscriptions_match_plain：与 V4 的 match_category 同为
            // (school_id, category) 部分索引，只是排除了精确教材版本订阅（见 TextbookPerformanceIT）
            // V9 起再排除圈子订阅：同一收敛方式的 demand_subscriptions_match_public 取代了 match_plain
            assertThat(plan.indexesUsed()).contains("demand_subscriptions_match_public");
        }
    }

    @Test
    @DisplayName("2. SQL 候选集与独立的 Java 参照实现逐条一致")
    void candidatesMatchReferenceImplementation() {
        Map<String, Object> p = params("数码电子");
        java.util.Set<String> fromSql = new java.util.HashSet<>();
        try (var session = sessions.openSession()) {
            java.util.List<Map<String, Object>> rows = session.selectList(MAPPER + "selectMatchCandidates", p);
            rows.forEach(r -> fromSql.add(r.get("id").toString()));
        }

        // 参照实现：把规则直接写成 Java，与 SQL 互为校验
        java.util.Set<String> expected = new java.util.HashSet<>();
        jdbc.query("""
                SELECT s.id, s.user_id, s.normalized_keyword, s.category, s.min_price, s.max_price,
                       s.geo_scope, s.campus_id, s.building_id, sb.zone
                FROM demand_subscriptions s LEFT JOIN buildings sb ON sb.id = s.building_id
                WHERE s.active AND s.school_id = 'pilot'
                """, rs -> {
            String keyword = rs.getString("normalized_keyword");
            String category = rs.getString("category");
            BigDecimal min = rs.getBigDecimal("min_price"), max = rs.getBigDecimal("max_price");
            BigDecimal price = (BigDecimal) p.get("price");
            String scope = rs.getString("geo_scope");
            boolean geo = switch (scope) {
                case "SCHOOL" -> true;
                case "CAMPUS" -> "东校区".equals(rs.getString("campus_id"));
                case "BUILDING" -> "east-qinyuan-1".equals(rs.getString("building_id"));
                default -> "东校区".equals(rs.getString("campus_id")) && "沁园".equals(rs.getString("zone"));
            };
            boolean ok = !seller.toString().equals(rs.getString("user_id"))
                    && (category == null || category.equals(p.get("category")))
                    && (min == null || min.compareTo(price) <= 0)
                    && (max == null || max.compareTo(price) >= 0)
                    && (keyword == null
                        || ((String) p.get("normalizedTitle")).contains(keyword)
                        || ((String) p.get("normalizedDescription")).contains(keyword))
                    && geo;
            if (ok) expected.add(rs.getString("id"));
        });
        assertThat(expected).as("参照集合不应为空，否则比较没有意义").isNotEmpty();
        assertThat(fromSql).isEqualTo(expected);
    }

    @Test
    @DisplayName("3. 真实评估一件商品：数百条命中也只有固定几条语句")
    void evaluateIssuesConstantStatements() {
        UUID product = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus,building_id) "
                        + "VALUES (?,?,?,?,?,?,?,?,?)",
                product, seller, "KW42 护眼台灯", "九成新", new BigDecimal("100"), "数码电子", "全新", "东校区", "east-qinyuan-1");
        StatementCounter counter = StatementCounter.install(sessions);
        long statements = counter.during(() ->
                transactions.executeWithoutResult(s -> matches.evaluate(product)));
        Integer written = jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?", Integer.class, product);
        System.out.println("PLAN evaluate : statements=" + statements + ", matches written=" + written);
        assertThat(written).isGreaterThan(100);
        // 读商品、查学校、查候选、批量写入、失效其余——与命中条数无关
        assertThat(statements).isLessThanOrEqualTo(5);
    }
}
