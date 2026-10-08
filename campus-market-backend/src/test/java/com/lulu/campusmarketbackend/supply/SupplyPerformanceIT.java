package com.lulu.campusmarketbackend.supply;

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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.bundle;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 5 性能证据（十三）：在 10,000 草稿、1,000 批次、20,000 商品（含 2,000 件整套打包）、
 * 10,000 笔带快照的已完成订单上，对生产 Mapper SQL 做 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)。
 * 只断言计划形状（不扫全表、用到的索引）与语句条数，不断言毫秒数，也不关闭顺序扫描。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.listing-draft-create.limit=1000",
        "campus-market.rate-limit.price-guidance.limit=1000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SupplyPerformanceIT {

    private static final String SUPPLY = "com.lulu.campusmarketbackend.mapper.SupplyMapper.";
    private static final String PRODUCT = "com.lulu.campusmarketbackend.mapper.ProductMapper.";
    private static final String BUNDLE = "com.lulu.campusmarketbackend.mapper.BundleMapper.";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_supply_perf")
            .withUsername("campus_sp").withPassword("campus_sp_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "supply-perf-it-secret-0123456789abcd");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired SqlSessionFactory sessions;
    @Autowired DataSource dataSource;
    @Autowired TransactionTemplate transactions;
    @Autowired ListingBatchService batches;

    private ExplainSupport explain;
    private StatementCounter counter;
    private SupplyApi api;
    private static boolean seeded;
    static UUID sampleOwner;
    static UUID sampleBatch;
    static UUID sampleBundle;
    static UUID sampleAssistant;

    @BeforeEach
    void seed() {
        explain = new ExplainSupport(sessions, dataSource);
        counter = StatementCounter.install(sessions);
        api = new SupplyApi(mockMvc, json);
        if (seeded) return;
        jdbc.update("""
                INSERT INTO users(id, account, password_hash, nickname, campus)
                SELECT gen_random_uuid(), 'spp-' || lpad(g::text, 4, '0'), 'x', 'perf', '东校区'
                FROM generate_series(0, 499) g
                """);
        // 草稿：10,000 条，分布在 500 个所有者名下
        jdbc.update("""
                INSERT INTO listing_drafts(id, owner_user_id, editor_user_id, draft_type, payload, status, expires_at, created_at, updated_at)
                SELECT gen_random_uuid(), u.id, u.id, CASE WHEN g % 10 = 0 THEN 'BUNDLE' ELSE 'SINGLE' END,
                       jsonb_build_object('title', '草稿 ' || g, 'price', 10 + g % 90, 'category', '生活用品'),
                       CASE WHEN g % 7 = 0 THEN 'READY' ELSE 'DRAFT' END,
                       now() + interval '30 days', now() - interval '1 day', now() - (g || ' seconds')::interval
                FROM generate_series(0, 9999) g
                JOIN users u ON u.account = 'spp-' || lpad((g % 500)::text, 4, '0')
                """);
        // 批次：1,000 个，每个 5 条草稿（同一所有者）
        jdbc.update("""
                INSERT INTO listing_batches(id, owner_user_id, created_at, updated_at)
                SELECT gen_random_uuid(), u.id, now() - (g || ' minutes')::interval, now()
                FROM generate_series(0, 999) g
                JOIN users u ON u.account = 'spp-' || lpad((g % 500)::text, 4, '0')
                """);
        jdbc.update("""
                INSERT INTO listing_batch_items(batch_id, draft_id, owner_user_id, position)
                SELECT b.id, d.id, b.owner_user_id, d.rn
                FROM (SELECT id, owner_user_id, row_number() OVER (PARTITION BY owner_user_id ORDER BY created_at) AS brn FROM listing_batches) b
                JOIN (SELECT id, owner_user_id, row_number() OVER (PARTITION BY owner_user_id ORDER BY updated_at) AS rn0 FROM listing_drafts) d0
                  ON d0.owner_user_id = b.owner_user_id AND d0.rn0 BETWEEN (b.brn - 1) * 5 + 1 AND b.brn * 5
                CROSS JOIN LATERAL (SELECT d0.id, d0.rn0 - (b.brn - 1) * 5 AS rn) d
                """);
        // 商品：18,000 件单件 + 2,000 件整套打包（每件 5～30 条明细）
        transactions.executeWithoutResult(s -> {
            jdbc.update("""
                    INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, listing_kind, created_at)
                    SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'spp-' || lpad((g % 500)::text, 4, '0')),
                           'perf item ' || g, 'd', 10 + g % 90,
                           (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6],
                           (ARRAY['全新','几乎全新','轻微使用痕迹','明显使用痕迹'])[1 + g % 4],
                           (ARRAY['东校区','西校区'])[1 + g % 2],
                           CASE WHEN g % 2 = 0 THEN '已售出' ELSE '在售' END,
                           CASE WHEN g % 10 = 0 THEN 'BUNDLE' ELSE 'SINGLE' END,
                           now() - (g || ' minutes')::interval
                    FROM generate_series(0, 19999) g
                    """);
            jdbc.update("""
                    INSERT INTO bundle_items(product_id, item_code, name, category, condition, quantity, sort_order)
                    SELECT p.id, 'I' || lpad((k + 1)::text, 2, '0'), '明细 ' || k, '生活用品', '全新', 1 + k % 3, k
                    FROM products p
                    CROSS JOIN LATERAL generate_series(0, 4 + (abs(hashtext(p.id::text)) % 26)) k
                    WHERE p.listing_kind = 'BUNDLE'
                    """);
        });
        // 已完成订单：10,000 笔，带成交价快照（取每件已售出商品一笔）
        jdbc.update("""
                INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact,
                                   confirmation_code, idempotency_key, request_hash, expires_at, price_snapshot, currency,
                                   school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot)
                SELECT gen_random_uuid(), p.id, (SELECT id FROM users WHERE account = 'spp-0499'), p.seller_id, p.price, 'COMPLETED',
                       '东校区-library', now() + interval '1 day', '13800000000', '123456', 'seed-' || p.id, 'h',
                       now() + interval '2 days', p.price, 'CNY',
                       (SELECT school_id FROM campuses WHERE id = p.campus), p.category, p.condition, p.listing_kind
                FROM products p WHERE p.status = '已售出'
                """);
        for (String table : new String[]{"users", "listing_drafts", "listing_batches", "listing_batch_items", "products",
                "bundle_items", "orders"}) {
            jdbc.execute("ANALYZE " + table);
        }
        sampleOwner = jdbc.queryForObject("SELECT id FROM users WHERE account='spp-0042'", UUID.class);
        sampleBatch = jdbc.queryForObject("SELECT id FROM listing_batches WHERE owner_user_id=? ORDER BY created_at LIMIT 1", UUID.class, sampleOwner);
        sampleBundle = jdbc.queryForObject("SELECT product_id FROM bundle_items GROUP BY product_id HAVING count(*) = 30 LIMIT 1", UUID.class);
        sampleAssistant = jdbc.queryForObject("SELECT id FROM users WHERE account='spp-0043'", UUID.class);
        seeded = true;
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
    @DisplayName("1. 数据规模：10,000 草稿、1,000 批次、20,000 商品（2,000 件整套打包）、10,000 笔带快照的已完成订单")
    void volume() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts", Long.class)).isGreaterThanOrEqualTo(10_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_batches", Long.class)).isGreaterThanOrEqualTo(1_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_batch_items", Long.class)).isGreaterThanOrEqualTo(5_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products", Long.class)).isGreaterThanOrEqualTo(20_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE listing_kind='BUNDLE'", Long.class)).isGreaterThanOrEqualTo(2_000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE status='COMPLETED' AND price_snapshot IS NOT NULL", Long.class)).isGreaterThanOrEqualTo(10_000);
    }

    @Test
    @DisplayName("2. 我的草稿列表按 listing_drafts_owner_updated 取页；所在批次按部分唯一索引探测；不扫描草稿或批次条目全表")
    void draftListPlan() throws Exception {
        ExplainSupport.Plan p = plan(SUPPLY + "selectDraftsByOwner", params("owner", sampleOwner, "limit", 200), "draft list");
        assertThat(p.seqScanOn("listing_drafts")).isFalse();
        assertThat(p.seqScanOn("listing_batch_items")).isFalse();
        assertThat(p.indexesUsed()).contains("listing_drafts_owner_updated", "listing_batch_items_one_open_batch");

        ExplainSupport.Plan assisting = plan(SUPPLY + "selectDraftsForAssistant", params("assistant", sampleAssistant), "assistant drafts");
        assertThat(assisting.seqScanOn("listing_assist_invites")).isFalse();
    }

    @Test
    @DisplayName("3. 批次详情 / 批次列表 / 发布时的草稿行锁与幂等查询都走索引")
    void batchPlans() throws Exception {
        ExplainSupport.Plan items = plan(SUPPLY + "selectBatchItems", params("batchId", sampleBatch), "batch items");
        assertThat(items.seqScanOn("listing_batch_items")).isFalse();
        assertThat(items.seqScanOn("listing_drafts")).isFalse();

        ExplainSupport.Plan list = plan(SUPPLY + "selectBatchesByOwner", params("owner", sampleOwner), "batch list");
        assertThat(list.seqScanOn("listing_batches")).isFalse();
        assertThat(list.indexesUsed()).contains("listing_batches_owner_created");

        List<UUID> ids = jdbc.queryForList("SELECT draft_id FROM listing_batch_items WHERE batch_id=?", UUID.class, sampleBatch);
        ExplainSupport.Plan lock = plan(SUPPLY + "lockDrafts", params("ids", ids), "lock drafts");
        assertThat(lock.seqScanOn("listing_drafts")).isFalse();

        ExplainSupport.Plan idem = plan(SUPPLY + "selectPublishRequest", params("owner", sampleOwner, "key", "no-such-key-000"), "publish idempotency");
        assertThat(idem.seqScanOn("listing_publish_requests")).isFalse();
    }

    @Test
    @DisplayName("4. 批次详情的语句条数与条目数无关：1 件与 20 件相同（草稿一次取回、参考数据一次预读）")
    void batchDetailIsNotLinear() throws Exception {
        User owner = api.register();
        String one = api.readyBatch(owner, 1, "perf-one");
        String twenty = api.readyBatch(owner, 20, "perf-twenty");
        long small = counter.during(() -> batches.detail(owner.id(), one));
        long large = counter.during(() -> batches.detail(owner.id(), twenty));
        System.out.println("STATEMENTS batch detail 1 item=" + small + " 20 items=" + large);
        assertThat(large).isEqualTo(small);
    }

    @Test
    @DisplayName("5. 整套打包：明细按主键前缀取回；商品列表卡片摘要是同一条 SQL 的标量子查询（不逐卡查询）；详情与下单的语句条数 2 条与 30 条明细相同")
    void bundlePlansAndCounts() throws Exception {
        ExplainSupport.Plan items = plan(BUNDLE + "selectItems", params("productId", sampleBundle), "bundle items");
        assertThat(items.seqScanOn("bundle_items")).isFalse();

        Map<String, Object> list = params("uid", null, "category", null, "campus", null, "condition", null, "keyword", null,
                "minPrice", null, "maxPrice", null, "orderBy", "p.created_at DESC", "limit", 20, "offset", 0);
        ExplainSupport.Plan cards = plan(PRODUCT + "selectProductRows", list, "product list with bundle summary");
        assertThat(cards.seqScanOn("bundle_items")).isFalse();

        User seller = api.register();
        User viewer = api.register();
        String small = api.ok(api.post(seller, "/v1/products", bundle("perf bundle 2", 50, 2))).path("id").asText();
        String large = api.ok(api.post(seller, "/v1/products", bundle("perf bundle 30", 500, 30))).path("id").asText();
        long detailSmall = counter.during(() -> call(() -> api.ok(api.get(viewer, "/v1/products/" + small))));
        long detailLarge = counter.during(() -> call(() -> api.ok(api.get(viewer, "/v1/products/" + large))));
        System.out.println("STATEMENTS bundle detail 2 items=" + detailSmall + " 30 items=" + detailLarge);
        assertThat(detailLarge).isEqualTo(detailSmall);

        long orderSmall = counter.during(() -> call(() -> api.order(api.register(), small)));
        long orderLarge = counter.during(() -> call(() -> api.order(api.register(), large)));
        System.out.println("STATEMENTS bundle order 2 items=" + orderSmall + " 30 items=" + orderLarge);
        assertThat(orderLarge).as("验货快照一条 INSERT…SELECT 生成全部明细").isEqualTo(orderSmall);

        long listCount = counter.during(() -> call(() -> api.ok(api.get(viewer, "/v1/products?pageSize=20"))));
        long listCountBundles = counter.during(() -> call(() -> api.ok(api.get(viewer, "/v1/products?pageSize=20&keyword=perf bundle"))));
        System.out.println("STATEMENTS product list=" + listCount + " bundle-only list=" + listCountBundles);
        assertThat(listCountBundles).isEqualTo(listCount);
    }

    @Test
    @DisplayName("6. 价格参考聚合：多校规模下（21 所学校、约 7 万笔已完成订单）只读订单上的维度快照，经覆盖索引（V9 起为 orders_public_trade_guidance，排除圈子商品）聚合，不扫订单全表、不连接商品")
    void priceGuidancePlan() throws Exception {
        // 其他 20 所学校的历史成交，使本校只占平台数据的一小部分
        if (jdbc.queryForObject("SELECT count(*) FROM schools WHERE id LIKE 'perf-s%'", Integer.class) == 0) {
            jdbc.update("INSERT INTO schools(id,name) SELECT 'perf-s' || g, '性能学校 ' || g FROM generate_series(0, 19) g");
            jdbc.update("INSERT INTO campuses(id,school_id,name) SELECT 'perf-c' || g, 'perf-s' || g, 'perf-c' || g FROM generate_series(0, 19) g");
            // V10：卖家与商品同校、买家与商品同校——每所学校各有自己的卖家与买家
            jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) "
                    + "SELECT gen_random_uuid(), r || '-perf-c' || g, 'x', 'perf', 'perf-c' || g FROM generate_series(0, 19) g, unnest(ARRAY['spp-seller','spp-buyer']) r");
            jdbc.update("""
                    INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, created_at)
                    SELECT gen_random_uuid(), (SELECT id FROM users WHERE account = 'spp-seller-perf-c' || (g % 20)), 'other school ' || g, 'd', 10 + g % 90,
                           (ARRAY['数码电子','教材书籍','生活用品','服饰鞋包','运动户外','其他'])[1 + g % 6], '全新',
                           'perf-c' || (g % 20), '已售出', now()
                    FROM generate_series(0, 59999) g
                    """);
            jdbc.update("""
                    INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact,
                                       confirmation_code, idempotency_key, request_hash, expires_at, price_snapshot, currency,
                                       school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot)
                    SELECT gen_random_uuid(), p.id, (SELECT id FROM users WHERE account = 'spp-buyer-' || p.campus), p.seller_id, p.price, 'COMPLETED',
                           '东校区-library', now() + interval '1 day', '13800000000', '123456', 'seed-' || p.id, 'h',
                           now() + interval '2 days', p.price, 'CNY',
                           (SELECT school_id FROM campuses WHERE id = p.campus), p.category, p.condition, p.listing_kind
                    FROM products p WHERE p.title LIKE 'other school %'
                    """);
            jdbc.execute("VACUUM ANALYZE products");
            jdbc.execute("VACUUM ANALYZE orders");
        }
        for (Map<String, Object> q : List.of(
                params("schoolId", "pilot", "category", "生活用品", "condition", null, "textbookEditionId", null),
                params("schoolId", "pilot", "category", "数码电子", "condition", "全新", "textbookEditionId", null))) {
            ExplainSupport.Plan p = plan(SUPPLY + "selectPriceGuidance", q, "price guidance " + q.get("category"));
            assertThat(p.seqScanOn("orders")).isFalse();
            assertThat(p.summary()).as("V8 起只读订单快照，不再连接商品或校区").doesNotContain("(products)").doesNotContain("(campuses)");
            assertThat(p.indexesUsed()).contains("orders_public_trade_guidance");
        }
    }

    // ------------------------------------------------------------------

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
