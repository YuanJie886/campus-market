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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.bundle;
import static com.lulu.campusmarketbackend.support.SupplyApi.bundleItems;
import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 5.1C / 5.4：整套打包商品。一个商品主体 + 2～30 条明细；仍然只生成一个订单、一份验货记录；
 * 明细不能单独下单，需求雷达只按整套匹配。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BundleListingIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_bundle")
            .withUsername("campus_bundle").withPassword("campus_bundle_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "bundle-listing-it-secret-0123456789ab");
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
    @DisplayName("1. 明细数量：1 条 400、2 条与 30 条成功、31 条 400；分类 / 成色 / 数量 / 重复编码 / 未知字段 / 尖括号 400")
    void itemRules() throws Exception {
        User seller = api.register();
        assertThat(status(api.post(seller, "/v1/products", bundle("一条明细", 50, 1)))).isEqualTo(400);
        assertThat(status(api.post(seller, "/v1/products", bundle("两条明细", 50, 2)))).isEqualTo(200);
        assertThat(status(api.post(seller, "/v1/products", bundle("三十条明细", 300, 30)))).isEqualTo(200);
        assertThat(status(api.post(seller, "/v1/products", bundle("三十一条", 300, 31)))).isEqualTo(400);

        for (Map.Entry<String, Object> bad : List.<Map.Entry<String, Object>>of(
                Map.entry("category", "奢侈品"), Map.entry("condition", "九成新"), Map.entry("quantity", 0),
                Map.entry("quantity", 100), Map.entry("quantity", 1.5), Map.entry("name", ""), Map.entry("name", "<b>x</b>"),
                Map.entry("sellerId", "evil"), Map.entry("productId", "evil"))) {
            Map<String, Object> b = bundle("坏明细 " + bad.getKey(), 50, 3);
            @SuppressWarnings("unchecked") List<Map<String, Object>> items = (List<Map<String, Object>>) b.get("bundleItems");
            items.get(1).put(bad.getKey(), bad.getValue());
            assertThat(status(api.post(seller, "/v1/products", b))).as(bad.toString()).isEqualTo(400);
        }
        Map<String, Object> dup = bundle("重复编码", 50, 3);
        @SuppressWarnings("unchecked") List<Map<String, Object>> items = (List<Map<String, Object>>) dup.get("bundleItems");
        items.get(0).put("itemCode", "LAMP");
        items.get(2).put("itemCode", "LAMP");
        assertThat(status(api.post(seller, "/v1/products", dup))).isEqualTo(400);

        Map<String, Object> withInspection = bundle("打包带商品级验货", 50, 2);
        withInspection.put("inspection", List.of());
        assertThat(status(api.post(seller, "/v1/products", withInspection))).isEqualTo(400);
        Map<String, Object> withTextbook = bundle("打包带教材版本", 50, 2);
        withTextbook.put("textbookEditionId", "demo-calculus-8");
        assertThat(status(api.post(seller, "/v1/products", withTextbook))).isEqualTo(400);
        Map<String, Object> singleWithItems = single("生活用品", "单件带明细", 10);
        singleWithItems.put("bundleItems", bundleItems(2));
        assertThat(status(api.post(seller, "/v1/products", singleWithItems))).isEqualTo(400);
        Map<String, Object> badKind = single("生活用品", "未知形态", 10);
        badKind.put("listingKind", "PALLET");
        assertThat(status(api.post(seller, "/v1/products", badKind))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE seller_id=?::uuid", Integer.class, seller.id())).isEqualTo(2);
    }

    @Test
    @DisplayName("2. 详情带完整明细（按顺序）；列表卡片同一次请求带摘要（明细条数 / 总件数 / 分类数）；单件商品没有摘要")
    void projection() throws Exception {
        User seller = api.register();
        String title = "毕业整套 " + UUID.randomUUID().toString().substring(0, 6);
        String id = api.ok(api.post(seller, "/v1/products", bundle(title, 120, 5))).path("id").asText();
        User viewer = api.register();
        JsonNode detail = api.ok(api.get(viewer, "/v1/products/" + id));
        assertThat(detail.path("listingKind").asText()).isEqualTo("BUNDLE");
        JsonNode items = detail.path("bundleItems");
        assertThat(items).hasSize(5);
        assertThat(items.get(0).path("name").asText()).isEqualTo("明细1");
        assertThat(items.get(4).path("itemCode").asText()).isEqualTo("I05");
        assertThat(detail.path("bundle").path("itemCount").asInt()).isEqualTo(5);
        assertThat(detail.path("bundle").path("totalQuantity").asInt()).isEqualTo(1 + 2 + 3 + 1 + 2);
        assertThat(detail.path("bundle").path("categoryCount").asInt()).isEqualTo(5);

        JsonNode card = null;
        for (JsonNode p : api.ok(api.get(viewer, "/v1/products?keyword=" + title)).path("items")) if (id.equals(p.path("id").asText())) card = p;
        assertThat(card).isNotNull();
        assertThat(card.path("listingKind").asText()).isEqualTo("BUNDLE");
        assertThat(card.path("bundle").path("itemCount").asInt()).isEqualTo(5);

        String plain = api.ok(api.post(seller, "/v1/products", single("生活用品", "普通单件", 10))).path("id").asText();
        JsonNode plainDetail = api.ok(api.get(viewer, "/v1/products/" + plain));
        assertThat(plainDetail.path("listingKind").asText()).isEqualTo("SINGLE");
        assertThat(plainDetail.path("bundle").isNull()).isTrue();
    }

    @Test
    @DisplayName("3. 编辑：明细整体替换；少于 2 条 400 且原明细不变；不能在单件与打包之间切换（接口 400、数据库触发器同样拒绝）")
    void editing() throws Exception {
        User seller = api.register();
        String id = api.ok(api.post(seller, "/v1/products", bundle("会编辑的整套", 80, 4))).path("id").asText();
        assertThat(status(api.patch(seller, "/v1/products/" + id, Map.of("bundleItems", bundleItems(3))))).isEqualTo(200);
        assertThat(count("SELECT count(*) FROM bundle_items WHERE product_id=?::uuid", id)).isEqualTo(3);
        assertThat(status(api.patch(seller, "/v1/products/" + id, Map.of("bundleItems", bundleItems(1))))).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM bundle_items WHERE product_id=?::uuid", id)).isEqualTo(3);
        assertThat(status(api.patch(seller, "/v1/products/" + id, Map.of("listingKind", "SINGLE")))).isEqualTo(400);
        assertThat(status(api.patch(api.register(), "/v1/products/" + id, Map.of("bundleItems", bundleItems(2))))).as("他人不能改").isIn(403, 404);
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET listing_kind='SINGLE' WHERE id=?::uuid", id))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM bundle_items WHERE product_id=?::uuid", id))
                .as("提交时少于 2 条被延迟约束拒绝").isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThat(count("SELECT count(*) FROM bundle_items WHERE product_id=?::uuid", id)).isEqualTo(3);
    }

    @Test
    @DisplayName("4. 只生成一个订单：下单后整套进入预约中，第二个买家 409；明细不是商品，不能单独下单")
    void singleOrder() throws Exception {
        User seller = api.register();
        String id = api.ok(api.post(seller, "/v1/products", bundle("整套只能一单", 99, 6))).path("id").asText();
        User buyer = api.register();
        String orderId = api.order(buyer, id);
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, id)).isEqualTo("预约中");

        Map<String, Object> second = new LinkedHashMap<>();
        second.put("productId", id);
        second.put("meetingPointId", "东校区-library");
        second.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        second.put("contact", "13800000000");
        second.put("idempotencyKey", UUID.randomUUID().toString());
        assertThat(status(api.post(api.register(), "/v1/orders", second))).isEqualTo(409);
        second.put("productId", "I01");
        second.put("idempotencyKey", UUID.randomUUID().toString());
        assertThat(status(api.post(api.register(), "/v1/orders", second))).as("明细编码不是商品").isIn(400, 404);
        assertThat(count("SELECT count(*) FROM orders WHERE product_id=?::uuid", id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT price_snapshot FROM orders WHERE id=?::uuid", java.math.BigDecimal.class, orderId))
                .isEqualByComparingTo("99");
    }

    @Test
    @DisplayName("5. 验货：一份订单验货记录，每条明细一条基础核对（含分类模板的核对要点）；全部一致 → 确认 → 完成，整套已售出")
    void inspectionAndCompletion() throws Exception {
        User seller = api.register();
        String id = api.ok(api.post(seller, "/v1/products", bundle("整套验货完成", 150, 4))).path("id").asText();
        User buyer = api.register();
        String orderId = api.order(buyer, id);
        api.ok(api.transition(seller, orderId, "PENDING_MEETING"));
        JsonNode inspection = api.flow(buyer, orderId).path("inspection");
        assertThat(count("SELECT count(*) FROM order_inspections WHERE order_id=?::uuid", orderId)).isEqualTo(1);
        assertThat(inspection.path("items")).hasSize(4);
        JsonNode first = inspection.path("items").get(0);
        assertThat(first.path("code").asText()).isEqualTo("B01_I01");
        assertThat(first.path("label").asText()).contains("明细1");
        assertThat(first.path("description").asText()).contains("生活用品").contains("轻微使用痕迹");
        assertThat(inspection.path("items").get(2).path("description").asText()).as("数码电子带分类模板的核对要点").contains("核对要点");

        api.ok(api.submitAll(buyer, orderId, "MATCH"));
        api.ok(api.transition(buyer, orderId, "BUYER_CONFIRMED"));
        String code = jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, orderId);
        api.ok(api.post(seller, "/v1/orders/" + orderId + "/transitions", Map.of("to", "COMPLETED", "confirmationCode", code)));
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, id)).isEqualTo("已售出");
        assertThat(count("SELECT count(*) FROM bundle_items WHERE product_id=?::uuid", id)).as("明细随整套保留").isEqualTo(4);
    }

    @Test
    @DisplayName("6. 任一明细不一致 → 订单 DISPUTED，确认被拦；只能取消，整套回到在售")
    void mismatchDisputes() throws Exception {
        User seller = api.register();
        String id = api.ok(api.post(seller, "/v1/products", bundle("整套有一件不符", 150, 5))).path("id").asText();
        User buyer = api.register();
        String orderId = api.order(buyer, id);
        api.ok(api.transition(seller, orderId, "PENDING_MEETING"));
        List<Map<String, Object>> items = new ArrayList<>();
        for (JsonNode item : api.flow(buyer, orderId).path("inspection").path("items")) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("itemCode", item.path("code").asText());
            row.put("result", items.size() == 3 ? "MISMATCH" : "MATCH");
            if (items.size() == 3) row.put("note", "第 4 件与描述不符");
            items.add(row);
        }
        api.ok(api.submit(buyer, orderId, items));
        assertThat(jdbc.queryForObject("SELECT status FROM orders WHERE id=?::uuid", String.class, orderId)).isEqualTo("DISPUTED");
        assertThat(api.flow(buyer, orderId).path("buyerConfirmBlockReason").asText()).isEqualTo("INSPECTION_MISMATCH");
        assertThat(status(api.transition(buyer, orderId, "BUYER_CONFIRMED"))).isEqualTo(409);
        api.ok(api.transition(buyer, orderId, "CANCELLED"));
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, id)).isEqualTo("在售");
    }

    @Test
    @DisplayName("7. 需求雷达只按整套匹配：只出现在明细名称里的关键词不命中；标题里的关键词命中整套一次")
    void radarMatchesWholeBundle() throws Exception {
        String tag = "雷达" + UUID.randomUUID().toString().substring(0, 6);
        User itemWatcher = api.register();
        api.ok(api.post(itemWatcher, "/v1/demand-subscriptions", Map.of("keyword", "明细3" + tag, "geoScope", "SCHOOL")));
        User titleWatcher = api.register();
        api.ok(api.post(titleWatcher, "/v1/demand-subscriptions", Map.of("keyword", tag, "geoScope", "SCHOOL")));
        User seller = api.register();
        Map<String, Object> b = bundle("宿舍整套 " + tag, 200, 4);
        @SuppressWarnings("unchecked") List<Map<String, Object>> items = (List<Map<String, Object>>) b.get("bundleItems");
        items.get(2).put("name", "明细3" + tag);
        String id = api.ok(api.post(seller, "/v1/products", b)).path("id").asText();
        assertThat(count("SELECT count(*) FROM demand_matches m JOIN demand_subscriptions s ON s.id=m.subscription_id "
                + "WHERE m.product_id=?::uuid AND s.user_id=?::uuid", id, titleWatcher.id())).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM demand_matches m JOIN demand_subscriptions s ON s.id=m.subscription_id "
                + "WHERE m.product_id=?::uuid AND s.user_id=?::uuid", id, itemWatcher.id())).as("明细不单独匹配").isZero();
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }
}
