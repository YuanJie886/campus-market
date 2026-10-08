package com.lulu.campusmarketbackend.supply;

import com.fasterxml.jackson.databind.JsonNode;
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
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 5.1E / 5.6：订单成交价快照与历史成交价格参考。
 * 统计样本直接写入数据库（已完成、带快照的订单），每个用例使用独立的学校，互不干扰。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.price-guidance.limit=12",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PriceGuidanceIT {

    static final String NOTE = "这是校内历史已完成交易的统计参考，不是平台估价或成交保证。";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_price")
            .withUsername("campus_price").withPassword("campus_price_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "price-guidance-it-secret-0123456789ab");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;

    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    record School(String id, String campus) {}

    @Test
    @DisplayName("1. 成交价快照：下单时在同一事务写入价格与币种；之后改价不改写快照；数据库拒绝任何改写；新订单用新价格")
    void priceSnapshot() throws Exception {
        User seller = api.register();
        String product = api.ok(api.post(seller, "/v1/products", single("生活用品", "快照台灯", 88))).path("id").asText();
        User buyer = api.register();
        String first = api.order(buyer, product);
        assertThat(jdbc.queryForObject("SELECT price_snapshot FROM orders WHERE id=?::uuid", BigDecimal.class, first)).isEqualByComparingTo("88");
        assertThat(jdbc.queryForObject("SELECT currency FROM orders WHERE id=?::uuid", String.class, first)).isEqualTo("CNY");
        api.ok(api.transition(buyer, first, "CANCELLED"));
        api.ok(api.patch(seller, "/v1/products/" + product, Map.of("price", 66)));
        assertThat(jdbc.queryForObject("SELECT price_snapshot FROM orders WHERE id=?::uuid", BigDecimal.class, first)).as("改价不改写旧订单").isEqualByComparingTo("88");
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET price_snapshot = 1 WHERE id=?::uuid", first))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET price_snapshot = NULL, currency = NULL WHERE id=?::uuid", first))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        String second = api.order(api.register(), product);
        assertThat(jdbc.queryForObject("SELECT price_snapshot FROM orders WHERE id=?::uuid", BigDecimal.class, second)).isEqualByComparingTo("66");
    }

    @Test
    @DisplayName("2. 样本少于 8：不给区间、连样本数也不给；恰好 8：给出区间；固定说明文字；维度白名单")
    void minimumSample() throws Exception {
        School school = freshSchool();
        User viewer = viewer(school);
        for (int i = 1; i <= 7; i++) completed(school, "数码电子", "几乎全新", "SINGLE", new BigDecimal(i * 10), true);
        JsonNode few = guidance(viewer, "category=数码电子");
        assertThat(few.path("sufficient").asBoolean()).isFalse();
        assertThat(few.path("sampleCount").isNull()).isTrue();
        assertThat(few.has("median")).isFalse();
        assertThat(few.has("lowerQuartile")).isFalse();
        assertThat(few.path("minimumSample").asInt()).isEqualTo(8);
        assertThat(few.path("note").asText()).isEqualTo(NOTE);

        completed(school, "数码电子", "几乎全新", "SINGLE", new BigDecimal(80), true);
        JsonNode enough = guidance(viewer, "category=数码电子");
        assertThat(enough.path("sufficient").asBoolean()).isTrue();
        assertThat(enough.path("sampleCount").asInt()).isEqualTo(8);
        assertThat(enough.path("median").asLong()).isEqualTo(45);
        assertThat(enough.path("note").asText()).isEqualTo(NOTE);
        assertThat(fieldNames(enough)).containsExactlyInAnyOrder("basis", "minimumSample", "note", "sufficient", "sampleCount",
                "sampleCountIsLowerBound", "median", "lowerQuartile", "upperQuartile", "periodStart", "periodEnd");
        assertThat(enough.toString()).doesNotContain("AI").doesNotContain("官方").doesNotContain("保证成交");
    }

    @Test
    @DisplayName("3. 四分位数正确（percentile_cont）并按量级取整；时间只到月；样本数只给下界档位")
    void quartiles() throws Exception {
        School school = freshSchool();
        User viewer = viewer(school);
        for (int i = 1; i <= 10; i++) completed(school, "生活用品", "全新", "SINGLE", new BigDecimal(i * 10), true);
        JsonNode g = guidance(viewer, "category=生活用品");
        assertThat(g.path("median").asLong()).isEqualTo(55);
        assertThat(g.path("lowerQuartile").asLong()).as("32.5 → 33").isEqualTo(33);
        assertThat(g.path("upperQuartile").asLong()).as("77.5 → 78").isEqualTo(78);
        assertThat(g.path("periodStart").asText()).matches("\\d{4}-\\d{2}");
        assertThat(g.path("periodEnd").asText()).matches("\\d{4}-\\d{2}");
        assertThat(g.path("sampleCount").asInt()).isEqualTo(10);
        for (int i = 0; i < 4; i++) completed(school, "生活用品", "全新", "SINGLE", new BigDecimal(55), true);
        assertThat(guidance(viewer, "category=生活用品").path("sampleCount").asInt()).as("14 条仍显示下界 10").isEqualTo(10);

        School big = freshSchool();
        for (int i = 0; i < 8; i++) completed(big, "数码电子", "全新", "SINGLE", new BigDecimal("1234.56"), true);
        assertThat(guidance(viewer(big), "category=数码电子").path("median").asLong()).as("千元以上取到 10 元").isEqualTo(1230);
    }

    @Test
    @DisplayName("4. 口径：排除整套打包、未完成（取消 / 进行中）、没有快照的旧订单、其他学校；之后改商品标价不影响统计")
    void exclusions() throws Exception {
        School school = freshSchool();
        User viewer = viewer(school);
        List<UUID> products = new ArrayList<>();
        for (int i = 1; i <= 8; i++) products.add(completed(school, "运动户外", "全新", "SINGLE", new BigDecimal(i * 10), true));
        JsonNode baseline = guidance(viewer, "category=运动户外");
        assertThat(baseline.path("median").asLong()).isEqualTo(45);

        completed(school, "运动户外", "全新", "BUNDLE", new BigDecimal(9999), true);
        UUID cancelled = completed(school, "运动户外", "全新", "SINGLE", new BigDecimal(9999), true);
        jdbc.update("UPDATE orders SET status='CANCELLED' WHERE product_id=?", cancelled);
        UUID pending = completed(school, "运动户外", "全新", "SINGLE", new BigDecimal(9999), true);
        jdbc.update("UPDATE orders SET status='PENDING_MEETING' WHERE product_id=?", pending);
        completed(school, "运动户外", "全新", "SINGLE", new BigDecimal(9999), false);
        School other = freshSchool();
        for (int i = 0; i < 8; i++) completed(other, "运动户外", "全新", "SINGLE", new BigDecimal(9999), true);

        JsonNode after = guidance(viewer, "category=运动户外");
        assertThat(after.path("median").asLong()).isEqualTo(45);
        assertThat(after.path("upperQuartile").asLong()).isEqualTo(baseline.path("upperQuartile").asLong());
        assertThat(guidance(viewer(other), "category=运动户外").path("median").asLong()).as("学校隔离；9999 取到 10 元 → 10000").isEqualTo(10000);

        jdbc.update("UPDATE products SET price = 1 WHERE id = ANY(?::uuid[])", (Object) products.stream().map(UUID::toString).toArray(String[]::new));
        assertThat(guidance(viewer, "category=运动户外").path("median").asLong()).as("统计用成交价快照，不用当前标价").isEqualTo(45);
    }

    @Test
    @DisplayName("5. 维度：成色筛选；教材版本只用于教材书籍；未知参数（groupBy / sellerId / schoolId）、无效分类或成色 400")
    void dimensions() throws Exception {
        School school = freshSchool();
        User viewer = viewer(school);
        for (int i = 1; i <= 8; i++) completed(school, "服饰鞋包", "全新", "SINGLE", new BigDecimal(100 + i), true);
        for (int i = 1; i <= 8; i++) completed(school, "服饰鞋包", "明显使用痕迹", "SINGLE", new BigDecimal(i), true);
        assertThat(guidance(viewer, "category=服饰鞋包&condition=明显使用痕迹").path("median").asLong()).isEqualTo(5);
        assertThat(guidance(viewer, "category=服饰鞋包&condition=全新").path("median").asLong()).isEqualTo(105);

        for (String bad : List.of("category=服饰鞋包&groupBy=seller_id", "category=服饰鞋包&sellerId=x", "category=服饰鞋包&schoolId=pilot",
                "category=奢侈品", "", "category=服饰鞋包&condition=九成新", "category=服饰鞋包&textbookEditionId=demo-calculus-8")) {
            MvcResult r = api.get(viewer, "/v1/price-guidance?" + bad);
            assertThat(status(r)).as(bad).isEqualTo(400);
            assertThat(api.body(r).path("requestId").asText()).isNotBlank();
        }
        JsonNode textbook = guidance(viewer, "category=教材书籍&textbookEditionId=demo-calculus-8");
        assertThat(textbook.path("sufficient").asBoolean()).isFalse();
        assertThat(textbook.path("basis").path("textbookEditionId").asText()).isEqualTo("demo-calculus-8");
    }

    @Test
    @DisplayName("6. 隐私：只有聚合值，不含商品 id、标题、价格明细、买卖双方或宿舍楼；需要登录；按账号限流 429")
    void privacyAndRateLimit() throws Exception {
        School school = freshSchool();
        User viewer = viewer(school);
        List<UUID> products = new ArrayList<>();
        for (int i = 1; i <= 9; i++) products.add(completed(school, "其他", "全新", "SINGLE", new BigDecimal("12.34").multiply(new BigDecimal(i)), true));
        String body = api.get(viewer, "/v1/price-guidance?category=其他").getResponse().getContentAsString();
        for (UUID p : products) assertThat(body).doesNotContain(p.toString());
        assertThat(body).doesNotContain("价格参考样本").doesNotContain("12.34").doesNotContain("seller").doesNotContain("buyer")
                .doesNotContain("dorm").doesNotContain("title");
        assertThat(status(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/price-guidance?category=其他")).andReturn()))
                .isEqualTo(401);

        User heavy = viewer(school);
        MvcResult last = null;
        for (int i = 0; i < 13; i++) last = api.get(heavy, "/v1/price-guidance?category=其他");
        assertThat(status(last)).isEqualTo(429);
        assertThat(last.getResponse().getHeader("Retry-After")).matches("[1-9][0-9]*");
        assertThat(api.body(last).path("requestId").asText()).isNotBlank();
    }

    // ==================================================================
    // 5.7A 冻结价格统计维度（V8）
    // ==================================================================

    @Test
    @DisplayName("7. 下单时五个维度快照来自服务端商品记录；成交后改分类 / 成色 / 校区 / 教材版本，快照不变；直接 SQL 改写失败")
    void dimensionsFrozenAtOrder() throws Exception {
        User seller = api.register();
        Map<String, Object> book = single("教材书籍", "维度快照教材", 30);
        book.put("textbookEditionId", "demo-calculus-8");
        String product = api.ok(api.post(seller, "/v1/products", book)).path("id").asText();
        User buyer = api.register();
        String orderId = api.complete(seller, buyer, product,
                id -> jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, id));
        String dims = "SELECT school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot, textbook_edition_id_snapshot, price_snapshot FROM orders WHERE id=?::uuid";
        Map<String, Object> before = jdbc.queryForMap(dims, orderId);
        assertThat(before).containsEntry("school_id_snapshot", "pilot").containsEntry("category_snapshot", "教材书籍")
                .containsEntry("condition_snapshot", "几乎全新").containsEntry("listing_kind_snapshot", "SINGLE")
                .containsEntry("textbook_edition_id_snapshot", "demo-calculus-8");

        Map<String, Object> patch = new java.util.LinkedHashMap<>();
        patch.put("category", "生活用品");
        patch.put("condition", "明显使用痕迹");
        patch.put("campus", "西校区");
        patch.put("buildingId", null);
        patch.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        api.ok(api.patch(seller, "/v1/products/" + product, patch));
        assertThat(jdbc.queryForObject("SELECT category FROM products WHERE id=?::uuid", String.class, product)).isEqualTo("生活用品");
        assertThat(jdbc.queryForMap(dims, orderId)).as("成交后改商品不改变订单快照").isEqualTo(before);

        for (String sql : List.of("UPDATE orders SET school_id_snapshot='other' WHERE id=?::uuid",
                "UPDATE orders SET category_snapshot='其他' WHERE id=?::uuid",
                "UPDATE orders SET condition_snapshot='全新' WHERE id=?::uuid",
                "UPDATE orders SET listing_kind_snapshot='BUNDLE', textbook_edition_id_snapshot=NULL WHERE id=?::uuid",
                "UPDATE orders SET textbook_edition_id_snapshot=NULL WHERE id=?::uuid")) {
            assertThatThrownBy(() -> jdbc.update(sql, orderId)).as(sql).isInstanceOf(org.springframework.dao.DataAccessException.class);
        }
        assertThat(jdbc.queryForMap(dims, orderId)).isEqualTo(before);
        assertThat(status(api.post(api.register(), "/v1/orders", Map.of("productId", product, "categorySnapshot", "x")))).as("客户端不能提交快照").isEqualTo(400);
    }

    @Test
    @DisplayName("8. 商品修改前后价格参考完全一致：统计只读订单快照，不连接商品当前的分类、成色、校区或教材关联")
    void guidanceStableAcrossProductEdits() throws Exception {
        School school = freshSchool();
        School elsewhere = freshSchool();
        User viewer = viewer(school);
        List<UUID> products = new ArrayList<>();
        for (int i = 1; i <= 9; i++) products.add(completed(school, "运动户外", "几乎全新", "SINGLE", new BigDecimal(i * 11), true));
        JsonNode before = guidance(viewer, "category=运动户外&condition=几乎全新");
        assertThat(before.path("sufficient").asBoolean()).isTrue();

        String[] ids = products.stream().map(UUID::toString).toArray(String[]::new);
        // V10 起商品不能被搬到他校（products_same_school_guard）。这里在一个事务内临时停用该触发器，
        // 模拟历史数据里商品校区被改到别的学校，证明统计只读订单快照，与商品当前的学校无关
        transactions.executeWithoutResult(s -> {
            jdbc.execute("ALTER TABLE products DISABLE TRIGGER products_same_school_guard");
            jdbc.update("UPDATE products SET category='其他', condition='明显使用痕迹', campus=?, price=1 WHERE id = ANY(?::uuid[])", elsewhere.campus(), ids);
            jdbc.execute("ALTER TABLE products ENABLE TRIGGER products_same_school_guard");
        });
        JsonNode after = guidance(viewer, "category=运动户外&condition=几乎全新");
        assertThat(after).as("商品改分类 / 成色 / 校区 / 标价后统计完全一致").isEqualTo(before);
        assertThat(guidance(viewer, "category=其他").path("sufficient").asBoolean()).as("样本不会跟着商品移动到新分类").isFalse();
        assertThat(guidance(viewer(elsewhere), "category=运动户外").path("sufficient").asBoolean()).as("也不会移动到新校区的学校").isFalse();
    }

    @Test
    @DisplayName("9. 学校隔离用 school_id_snapshot：商品现在在别校的历史样本仍属原学校；快照是别校的样本不进入本校")
    void schoolIsolationUsesSnapshot() throws Exception {
        School school = freshSchool();
        School other = freshSchool();
        for (int i = 1; i <= 8; i++) seed(other.campus(), school.id(), "服饰鞋包", "全新", "SINGLE", null, new BigDecimal(40 + i), "COMPLETED", true, true);
        for (int i = 1; i <= 8; i++) seed(school.campus(), other.id(), "服饰鞋包", "全新", "SINGLE", null, new BigDecimal(900 + i), "COMPLETED", true, true);
        JsonNode mine = guidance(viewer(school), "category=服饰鞋包");
        assertThat(mine.path("sampleCount").asInt()).isEqualTo(8);
        assertThat(mine.path("median").asLong()).isEqualTo(45);
        assertThat(guidance(viewer(other), "category=服饰鞋包").path("median").asLong()).isEqualTo(905);
    }

    @Test
    @DisplayName("10. 教材版本统计用订单上的版本快照：商品之后解除或更换关联，样本仍归原版本")
    void textbookUsesSnapshot() throws Exception {
        School school = freshSchool();
        String edition = "pg-edition-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("INSERT INTO textbook_editions(id, school_id, no_isbn_fingerprint, title, authors, publisher, edition_label) "
                + "VALUES (?,?,?,'价格教材',ARRAY['a'],'p','第 1 版')", edition, school.id(), "c".repeat(48) + UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        for (int i = 1; i <= 8; i++) seed(school.campus(), school.id(), "教材书籍", "全新", "SINGLE", edition, new BigDecimal(20 + i), "COMPLETED", true, true);
        User viewer = viewer(school);
        JsonNode g = guidance(viewer, "category=教材书籍&textbookEditionId=" + edition);
        assertThat(g.path("sufficient").asBoolean()).as("商品表里没有任何关联，仍按订单快照统计").isTrue();
        assertThat(g.path("median").asLong()).isEqualTo(25);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_textbook_details WHERE textbook_edition_id=?", Integer.class, edition)).isZero();
    }

    @Test
    @DisplayName("11. 取消 / 过期 / 争议 / 进行中的订单不进入统计；V7～V8 之间的旧订单（有成交价、无维度快照）也不进入，且不能补写")
    void incompleteSnapshotsExcluded() throws Exception {
        School school = freshSchool();
        for (int i = 1; i <= 8; i++) completed(school, "数码电子", "全新", "SINGLE", new BigDecimal(100), true);
        for (String status : List.of("CANCELLED", "EXPIRED", "DISPUTED", "PENDING_MEETING", "BUYER_CONFIRMED")) {
            seed(school.campus(), school.id(), "数码电子", "全新", "SINGLE", null, new BigDecimal(9000), status, true, true);
        }
        UUID legacy = seed(school.campus(), school.id(), "数码电子", "全新", "SINGLE", null, new BigDecimal(9000), "COMPLETED", true, false);
        JsonNode g = guidance(viewer(school), "category=数码电子");
        assertThat(g.path("median").asLong()).isEqualTo(100);
        assertThat(g.path("upperQuartile").asLong()).isEqualTo(100);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET school_id_snapshot=?, category_snapshot='数码电子', condition_snapshot='全新', "
                + "listing_kind_snapshot='SINGLE' WHERE product_id=?", school.id(), legacy)).as("不能给旧订单补写维度")
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    // ------------------------------------------------------------------

    private School freshSchool() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String school = "pg-school-" + suffix;
        String campus = "价格校区-" + suffix;
        jdbc.update("INSERT INTO schools(id,name) VALUES (?,?)", school, "价格测试学校 " + suffix);
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES (?,?,?)", campus, school, campus);
        return new School(school, campus);
    }

    private User viewer(School school) throws Exception {
        User u = api.register();
        jdbc.update("UPDATE users SET campus=? WHERE id=?::uuid", school.campus(), u.id());
        return u;
    }

    /** 一笔已完成的历史订单：商品在该校区；snapshot=false 模拟 V7 之前的旧订单（没有成交价与维度快照）。 */
    private UUID completed(School school, String category, String condition, String kind, BigDecimal price, boolean snapshot) {
        return seed(school.campus(), school.id(), category, condition, kind, null, price, "COMPLETED", snapshot, snapshot);
    }

    /**
     * 直接写入一笔历史订单。productCampus 是商品<b>现在</b>所在的校区；dimSchool 等是订单上冻结的维度快照
     * （dimensions=false 模拟 V7～V8 之间下的单：有成交价快照、没有维度快照）。
     */
    private UUID seed(String productCampus, String dimSchool, String category, String condition, String kind, String edition,
                      BigDecimal price, String status, boolean priceSnapshot, boolean dimensions) {
        School owner = new School(dimSchool, productCampus);
        UUID seller = user(owner);
        UUID buyer = user(owner);
        UUID product = UUID.randomUUID();
        UUID order = UUID.randomUUID();
        Timestamp later = Timestamp.from(Instant.now().plusSeconds(86_400));
        transactions.executeWithoutResult(s -> {
            jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, listing_kind) "
                    + "VALUES (?,?,?,?,?,?,?,?,'已售出',?)", product, seller, "价格参考样本", "d", price, category, condition, productCampus, kind);
            if ("BUNDLE".equals(kind)) {
                for (int i = 0; i < 2; i++) {
                    jdbc.update("INSERT INTO bundle_items(product_id,item_code,name,category,condition,quantity,sort_order) VALUES (?,?,?,?,?,1,?)",
                            product, "I0" + (i + 1), "明细" + i, category, condition, i);
                }
            }
            jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, "
                    + "confirmation_code, idempotency_key, request_hash, expires_at, price_snapshot, currency, "
                    + "school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot, textbook_edition_id_snapshot) "
                    + "VALUES (?,?,?,?,?,?,'东校区-library',?,'13800000000','123456',?,'h',?,?,?,?,?,?,?,?)",
                    order, product, buyer, seller, price, status, later, "seed-" + order, later,
                    priceSnapshot ? price : null, priceSnapshot ? "CNY" : null,
                    dimensions ? dimSchool : null, dimensions ? category : null, dimensions ? condition : null,
                    dimensions ? kind : null, dimensions ? edition : null);
        });
        return product;
    }

    private UUID user(School school) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?,?,?,?,?)",
                id, "seed-" + id, "not-a-real-hash", "样本", school.campus());
        return id;
    }

    private JsonNode guidance(User viewer, String query) throws Exception {
        return api.ok(api.get(viewer, "/v1/price-guidance?" + query));
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) names.add(it.next());
        return names;
    }
}
