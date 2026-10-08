package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.support.ExplainSupport;
import com.lulu.campusmarketbackend.support.StatementCounter;
import com.lulu.campusmarketbackend.service.MarketService;
import com.lulu.campusmarketbackend.textbook.CatalogService;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 课程教材图谱在代表性数据量下的执行计划与语句数（模块 4 第十三节）。
 *
 * <p>2,500 门课程（本校 2,000）、5,000 个开课、10,000 个教材版本、20,000 件商品（12,000 件关联教材）。
 * 数据只在一次性容器里用 generate_series 生成；EXPLAIN 走生产 Mapper 的真实 SQL（ExplainSupport），
 * 不关闭 seqscan，不写依赖机器的毫秒断言。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class TextbookPerformanceIT {

    private static final String CATALOG = "com.lulu.campusmarketbackend.mapper.CatalogMapper.";
    private static final String PRODUCT = "com.lulu.campusmarketbackend.mapper.ProductMapper.";
    private static final String DEMAND = "com.lulu.campusmarketbackend.mapper.DemandMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_tb_perf")
            .withUsername("campus_tbp").withPassword("campus_tbp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "textbook-perf-it-secret-0123456789abc");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;
    @Autowired CatalogService catalog;
    @Autowired MarketService market;
    private ExplainSupport explain;
    private static boolean seeded;
    static String viewer;
    static String sampleEdition;
    static String sampleIsbn;
    static String sampleCourse;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        if (seeded) return;
        jdbc.update("INSERT INTO schools(id,name) VALUES ('other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('他校区','other-school','他校区') ON CONFLICT DO NOTHING");
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'tbp-' || lpad(g::text, 4, '0'), 'x', 'perf', '东校区'
                FROM generate_series(0, 499) g
                """);
        // 课程：本校 2,000 门 + 他校 500 门
        jdbc.update("""
                INSERT INTO courses(id, school_id, course_code, name, normalized_name)
                SELECT 'pc-' || g, CASE WHEN g < 2000 THEN 'pilot' ELSE 'other-school' END,
                       'PC' || lpad(g::text, 5, '0'), '性能课程 ' || g, '性能课程 ' || g
                FROM generate_series(0, 2499) g
                """);
        // 开课：5,000 个（每门课两个学期，前 500 门再多一个）
        jdbc.update("""
                INSERT INTO course_offerings(id, course_id, school_id, academic_year, term)
                SELECT 'po-' || c.n || '-' || lower(t.term), 'pc-' || c.n, CASE WHEN c.n < 2000 THEN 'pilot' ELSE 'other-school' END,
                       '2026-2027', t.term
                FROM generate_series(0, 2499) AS c(n)
                CROSS JOIN (VALUES ('AUTUMN'), ('SPRING')) AS t(term)
                """);
        // 教材版本：10,000 个（本校 9,000），ISBN 由 isbn10_to_isbn13 算出合法校验位
        jdbc.update("""
                INSERT INTO textbook_editions(id, school_id, isbn13, normalized_isbn, title, authors, publisher, edition_label, work_key)
                SELECT 'pe-' || g, CASE WHEN g < 9000 THEN 'pilot' ELSE 'other-school' END,
                       isbn10_to_isbn13(lpad(g::text, 9, '0') || '0'), isbn10_to_isbn13(lpad(g::text, 9, '0') || '0'),
                       '性能教材 ' || (g / 2), ARRAY['作者'], '出版社', '第 ' || (1 + g % 2) || ' 版', 'pw-' || (g / 2)
                FROM generate_series(0, 9999) g
                """);
        // 课程—教材：每个开课两本，其中一成是 PENDING
        jdbc.update("""
                INSERT INTO course_textbooks(course_offering_id, textbook_edition_id, school_id, usage_type, verification_status)
                SELECT o.id, 'pe-' || ((abs(hashtext(o.id)) + k) % 9000), 'pilot',
                       CASE WHEN k = 0 THEN 'REQUIRED' ELSE 'REFERENCE' END,
                       CASE WHEN abs(hashtext(o.id || k)) % 10 = 0 THEN 'PENDING' ELSE 'VERIFIED' END
                FROM course_offerings o CROSS JOIN generate_series(0, 1) k
                WHERE o.school_id = 'pilot'
                ON CONFLICT DO NOTHING
                """);
        // 商品：20,000 件教材书籍，其中 12,000 件关联教材版本
        jdbc.update("""
                INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, building_id, created_at)
                SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'tbp-' || lpad((g % 500)::text, 4, '0')),
                       'perf book ' || g, 'd', 10 + g % 90, '教材书籍', '全新', '东校区',
                       CASE WHEN g % 10 = 0 THEN '已售出' ELSE '在售' END,
                       (ARRAY['east-qinyuan-1','east-qinyuan-2','east-qinyuan-3','east-songyuan-4','east-songyuan-5'])[1 + g % 5],
                       now() - (g || ' minutes')::interval
                FROM generate_series(0, 19999) g
                """);
        jdbc.update("""
                INSERT INTO product_textbook_details(product_id, school_id, textbook_edition_id, isbn_snapshot, title_snapshot,
                                                     edition_snapshot, publisher_snapshot)
                SELECT p.id, 'pilot', e.id, e.normalized_isbn, e.title, e.edition_label, e.publisher
                FROM (SELECT id, row_number() OVER (ORDER BY title) - 1 AS n FROM products WHERE title LIKE 'perf book %') p
                JOIN textbook_editions e ON e.id = 'pe-' || (p.n % 9000)
                WHERE p.n < 12000
                """);
        // 需求订阅：3,000 条精确教材订阅 + 2,000 条关键词订阅（关键词订阅分布在六个分类）
        jdbc.update("""
                INSERT INTO demand_subscriptions(id, user_id, school_id, category, geo_scope, fingerprint, textbook_edition_id)
                SELECT gen_random_uuid(), u.id, 'pilot', '教材书籍', 'SCHOOL', md5(u.id::text || g) || md5(g::text), 'pe-' || (g % 9000)
                FROM generate_series(0, 2999) g
                JOIN users u ON u.account = 'tbp-' || lpad((g % 500)::text, 4, '0')
                ON CONFLICT DO NOTHING
                """);
        jdbc.update("""
                INSERT INTO demand_subscriptions(id, user_id, school_id, keyword, normalized_keyword, category, geo_scope, fingerprint)
                SELECT gen_random_uuid(), u.id, 'pilot', 'kw' || g, 'kw' || g,
                       (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6],
                       'SCHOOL', md5('k' || g) || md5(u.id::text)
                FROM generate_series(0, 1999) g
                JOIN users u ON u.account = 'tbp-' || lpad((g % 500)::text, 4, '0')
                """);
        // 一门课带 20 本已验证教材：检验课程详情不按教材逐条查询
        jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name) VALUES ('pc-many','pilot','很多教材的课','很多教材的课')");
        jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('po-many','pc-many','pilot','2026-2027','AUTUMN')");
        jdbc.update("""
                INSERT INTO course_textbooks(course_offering_id, textbook_edition_id, school_id, usage_type, verification_status)
                SELECT 'po-many', 'pe-' || (100 + g), 'pilot', 'REFERENCE', 'VERIFIED' FROM generate_series(0, 19) g
                """);
        jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name) VALUES ('pc-one','pilot','一本教材的课','一本教材的课')");
        jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('po-one','pc-one','pilot','2026-2027','AUTUMN')");
        jdbc.update("INSERT INTO course_textbooks(course_offering_id, textbook_edition_id, school_id, usage_type, verification_status) "
                + "VALUES ('po-one','pe-7','pilot','REQUIRED','VERIFIED')");

        for (String table : new String[]{"courses", "course_offerings", "textbook_editions", "course_textbooks",
                "products", "product_textbook_details", "demand_subscriptions", "users"}) {
            jdbc.execute("ANALYZE " + table);
        }
        viewer = jdbc.queryForObject("SELECT id::text FROM users WHERE account='tbp-0001'", String.class);
        sampleEdition = "pe-4242";
        sampleIsbn = jdbc.queryForObject("SELECT normalized_isbn FROM textbook_editions WHERE id=?", String.class, sampleEdition);
        sampleCourse = "pc-1234";
        seeded = true;   // 只在全部造数成功后标记，避免后续用例跑在半成品数据上
    }

    private ExplainSupport.Plan plan(String statement, Map<String, Object> params, String label) throws Exception {
        ExplainSupport.Plan plan = explain.explain(statement, params);
        System.out.println("PLAN " + label + " : " + plan.summary());
        return plan;
    }

    private static Map<String, Object> params(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    @DisplayName("1. 数据规模达标：≥2,000 门课程、≥5,000 个开课、≥10,000 个版本、≥20,000 件商品")
    void volume() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses", Long.class)).isGreaterThanOrEqualTo(2000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_offerings", Long.class)).isGreaterThanOrEqualTo(5000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_editions", Long.class)).isGreaterThanOrEqualTo(10000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products", Long.class)).isGreaterThanOrEqualTo(20000);
    }

    @Test
    @DisplayName("2. ISBN 精确查询走 (school_id, normalized_isbn) 唯一索引")
    void isbnLookupUsesIndex() throws Exception {
        ExplainSupport.Plan p = plan(CATALOG + "selectEditionByIsbn", params("isbn13", sampleIsbn, "schoolId", "pilot"), "isbn exact");
        assertThat(p.seqScanOn("textbook_editions")).isFalse();
        assertThat(p.indexesUsed()).contains("textbook_editions_school_isbn");
    }

    @Test
    @DisplayName("3. 课程搜索：按学校与规范化名称排序取页，每行的开课 / 教材计数经索引探测（不扫开课与关系全表）")
    void courseSearchPlan() throws Exception {
        Map<String, Object> q = params("schoolId", "pilot", "q", "性能课程 12", "codePrefix", null, "term", null,
                "academicYear", null, "campus", null, "limit", 20, "offset", 0);
        ExplainSupport.Plan p = plan(CATALOG + "selectCourses", q, "course search");
        assertThat(p.seqScanOn("course_offerings")).isFalse();
        assertThat(p.seqScanOn("course_textbooks")).isFalse();
        ExplainSupport.Plan filtered = plan(CATALOG + "selectCourses", params("schoolId", "pilot", "q", null, "codePrefix", null,
                "term", "SPRING", "academicYear", null, "campus", null, "limit", 20, "offset", 0), "course search by term");
        assertThat(filtered.seqScanOn("course_textbooks")).isFalse();
    }

    @Test
    @DisplayName("4. 课程详情的教材查询与教材详情的课程查询都按索引取回")
    void detailQueriesUseIndexes() throws Exception {
        ExplainSupport.Plan course = plan(CATALOG + "selectVerifiedTextbooks", params("courseId", sampleCourse, "offeringId", null), "course textbooks");
        assertThat(course.seqScanOn("course_textbooks")).isFalse();
        assertThat(course.seqScanOn("textbook_editions")).isFalse();
        assertThat(course.seqScanOn("product_textbook_details")).isFalse();

        ExplainSupport.Plan edition = plan(CATALOG + "selectEditionCourses", params("editionId", sampleEdition, "schoolId", "pilot"), "edition courses");
        assertThat(edition.seqScanOn("course_textbooks")).isFalse();
        assertThat(edition.indexesUsed()).contains("course_textbooks_edition_verified");

        ExplainSupport.Plan count = plan(CATALOG + "countOnSale", params("editionId", sampleEdition), "on-sale count");
        assertThat(count.seqScanOn("product_textbook_details")).isFalse();
        assertThat(count.indexesUsed()).contains("product_textbook_details_edition");
    }

    @Test
    @DisplayName("5. 精确教材商品流（生产 feed SQL + 版本过滤）不扫描商品与关联全表")
    void exactListingPlan() throws Exception {
        Map<String, Object> feed = params("uid", null, "category", null, "condition", null, "keyword", null,
                "minPrice", null, "maxPrice", null, "scope", "SCHOOL", "buildingId", null, "campus", null, "zone", null,
                "orderBy", "p.created_at DESC", "originBuildingId", null, "originLat", null, "originLng", null,
                "textbookEditionIds", List.of(sampleEdition), "onSaleOnly", true, "limit", 20, "offset", 0);
        ExplainSupport.Plan p = plan(PRODUCT + "selectFeedRows", feed, "exact listing");
        assertThat(p.seqScanOn("product_textbook_details")).isFalse();
        assertThat(p.seqScanOn("products")).isFalse();
    }

    @Test
    @DisplayName("6. 商品列表带教材摘要：课程名子查询按 course_textbooks_edition_verified 探测，不扫关系全表")
    void productListTextbookColumnsPlan() throws Exception {
        Map<String, Object> list = params("uid", null, "category", "教材书籍", "campus", null, "condition", null, "keyword", null,
                "minPrice", null, "maxPrice", null, "orderBy", "p.created_at DESC", "limit", 20, "offset", 0);
        ExplainSupport.Plan p = plan(PRODUCT + "selectProductRows", list, "product list with textbook");
        assertThat(p.seqScanOn("course_textbooks")).isFalse();
        assertThat(p.seqScanOn("product_textbook_details")).isFalse();
    }

    @Test
    @DisplayName("7. 候选订阅：精确版本走 match_textbook；普通订阅走排除了教材订阅（V9 起同时排除圈子订阅）的 match_public；不扫描订阅全表")
    void textbookCandidatesPlan() throws Exception {
        Map<String, Object> c = params("schoolId", "pilot", "sellerId", UUID.randomUUID(), "category", "教材书籍",
                "price", new java.math.BigDecimal("20"), "normalizedTitle", "perf book 1", "normalizedDescription", "d",
                "campus", "东校区", "buildingId", "east-qinyuan-1", "zone", "沁园", "textbookEditionId", sampleEdition);
        ExplainSupport.Plan p = plan(DEMAND + "selectMatchCandidates", c, "textbook candidates");
        assertThat(p.seqScanOn("demand_subscriptions")).isFalse();
        assertThat(p.indexesUsed()).contains("demand_subscriptions_match_textbook", "demand_subscriptions_match_public");
        // 未关联教材的商品只走普通订阅一路
        c.put("textbookEditionId", null);
        ExplainSupport.Plan plain = plan(DEMAND + "selectMatchCandidates", c, "plain candidates");
        assertThat(plain.seqScanOn("demand_subscriptions")).isFalse();
        assertThat(plain.indexesUsed()).doesNotContain("demand_subscriptions_match_textbook");
    }

    @Test
    @DisplayName("8. 无 N+1：课程详情 1 本与 20 本教材语句数相同；商品列表 / 教材详情的语句数与关联教材的商品数量无关")
    void statementCountsAreConstant() {
        StatementCounter counter = StatementCounter.install(sessions);
        long one = counter.during(() -> catalog.course(viewer, "pc-one"));
        long twenty = counter.during(() -> catalog.course(viewer, "pc-many"));
        System.out.println("PLAN course detail statements: 1 textbook -> " + one + ", 20 textbooks -> " + twenty);
        assertThat(one).isPositive();
        assertThat(twenty).isEqualTo(one);

        long page = counter.during(() -> market.products(Map.of("category", "教材书籍", "pageSize", "50"), viewer));
        long small = counter.during(() -> market.products(Map.of("category", "教材书籍", "pageSize", "1"), viewer));
        System.out.println("PLAN product list statements: 50 textbook cards -> " + page + ", 1 card -> " + small);
        assertThat(page).as("商品卡片不逐条查教材").isEqualTo(small);

        long detail = counter.during(() -> catalog.textbook(viewer, sampleEdition, "latest"));
        long detailOther = counter.during(() -> catalog.textbook(viewer, "pe-8", "latest"));
        System.out.println("PLAN textbook detail statements: " + detail + " / " + detailOther);
        assertThat(detail).isEqualTo(detailOther);
    }
}
