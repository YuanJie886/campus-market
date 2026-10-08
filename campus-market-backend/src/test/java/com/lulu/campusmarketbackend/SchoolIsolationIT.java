package com.lulu.campusmarketbackend;

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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 模块 6.1A：「PUBLIC」表示当前学校公开。两所学校（试点学校 pilot 与湖畔学校）上的 HTTP 行为测试：
 * 未登录不能读取商品；列表 / 搜索计数 / feed / 详情 / 评论 / 收藏 / 会话 / 下单 / 公开资料 / 需求匹配都不跨校；
 * 客户端提交的 schoolId 一律 400；写入（发布、改校区、改资料、草稿）不能跨校；数据库触发器兜底。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SchoolIsolationIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_school").withUsername("campus_school").withPassword("campus_school_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "school-isolation-it-secret-0123456789");
    }

    private static final String LAKE = "湖畔校区";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
        // 第二所学校：多校部署时只需要在 campuses 表里登记校区，注册接口按数据库校验
        jdbc.update("INSERT INTO schools(id,name) VALUES ('lake','湖畔学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES (?, 'lake', ?) ON CONFLICT DO NOTHING", LAKE, LAKE);
        jdbc.update("INSERT INTO meeting_points(id,campus_id,name) VALUES ('湖畔校区-gate', ?, '湖畔南门') ON CONFLICT DO NOTHING", LAKE);
    }

    private String tag() {
        return "隔离" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String publish(User seller, String campus, String title) throws Exception {
        Map<String, Object> b = SupplyApi.single("生活用品", title, 30);
        b.put("campus", campus);
        return api.ok(api.post(seller, "/v1/products", b)).path("id").asText();
    }

    private static List<String> ids(JsonNode items) {
        List<String> result = new ArrayList<>();
        for (JsonNode item : items) result.add(item.path("id").asText());
        return result;
    }

    @Test
    @DisplayName("1. 未登录：商品列表 / feed / 详情 / 评论 / 浏览计数 / 他人资料 / 公共履历一律 401，响应里没有任何商品内容")
    void anonymousCannotReadProducts() throws Exception {
        User seller = api.register();
        String title = tag();
        String id = publish(seller, "东校区", title);
        for (MvcResult r : List.of(
                mockMvc.perform(get("/v1/products")).andReturn(),
                mockMvc.perform(get("/v1/products").param("keyword", title)).andReturn(),
                mockMvc.perform(get("/v1/products/feed")).andReturn(),
                mockMvc.perform(get("/v1/products/" + id)).andReturn(),
                mockMvc.perform(get("/v1/products/" + id + "/comments")).andReturn(),
                mockMvc.perform(post("/v1/products/" + id + "/view")).andReturn(),
                mockMvc.perform(get("/v1/users/" + seller.id())).andReturn(),
                mockMvc.perform(get("/v1/users/" + seller.id() + "/trade-summary")).andReturn())) {
            assertThat(status(r)).as(r.getRequest().getRequestURI()).isEqualTo(401);
            assertThat(r.getResponse().getContentAsString()).doesNotContain(title);
        }
        // 非用户数据（楼栋、面交点、验货模板）保持公开
        assertThat(status(mockMvc.perform(get("/v1/buildings").param("campus", "东校区")).andReturn())).isEqualTo(200);
        assertThat(status(mockMvc.perform(get("/v1/meeting-points")).andReturn())).isEqualTo(200);
    }

    @Test
    @DisplayName("2. 列表、搜索总数与 feed 只含本校商品；他校校区作筛选条件、以及任何 schoolId 参数都是 400")
    void listsAreSchoolScoped() throws Exception {
        User pilotSeller = api.register(), lakeSeller = api.register(LAKE);
        User pilot = api.register(), lake = api.register(LAKE);
        String t = tag();
        String a = publish(pilotSeller, "东校区", t + " 试点");
        String b = publish(lakeSeller, LAKE, t + " 湖畔");

        JsonNode pilotList = api.ok(api.get(pilot, "/v1/products?keyword=" + t));
        assertThat(ids(pilotList.path("items"))).containsExactly(a);
        assertThat(pilotList.path("total").asLong()).as("搜索总数不包含他校").isEqualTo(1);
        JsonNode lakeList = api.ok(api.get(lake, "/v1/products?keyword=" + t));
        assertThat(ids(lakeList.path("items"))).containsExactly(b);
        assertThat(lakeList.path("total").asLong()).isEqualTo(1);

        JsonNode pilotFeed = api.ok(api.get(pilot, "/v1/products/feed?scope=SCHOOL&keyword=" + t));
        assertThat(ids(pilotFeed.path("items"))).containsExactly(a);
        assertThat(pilotFeed.path("total").asLong()).isEqualTo(1);
        JsonNode lakeFeed = api.ok(api.get(lake, "/v1/products/feed?scope=SCHOOL&keyword=" + t));
        assertThat(ids(lakeFeed.path("items"))).containsExactly(b);

        assertThat(status(api.get(pilot, "/v1/products?campus=" + LAKE))).isEqualTo(400);
        for (String key : List.of("schoolId", "school", "school_id")) {
            assertThat(status(api.get(pilot, "/v1/products?" + key + "=lake"))).as(key).isEqualTo(400);
            assertThat(status(api.get(pilot, "/v1/products/feed?" + key + "=lake"))).as(key).isEqualTo(400);
        }
        // 同校行为不变：卖家本人与同校用户照常看到
        assertThat(api.ok(api.get(pilotSeller, "/v1/products?keyword=" + t)).path("total").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("3. 他校商品直接 ID 访问与不存在相同（404、同一句话）：详情 / 评论 / 浏览 / 收藏 / 会话 / 下单 / 卖家资料 / 公共履历")
    void directAccessIs404() throws Exception {
        User pilotSeller = api.register(), lake = api.register(LAKE);
        String title = tag();
        String a = publish(pilotSeller, "东校区", title);
        String missing = UUID.randomUUID().toString();

        MvcResult detail = api.get(lake, "/v1/products/" + a);
        assertThat(status(detail)).isEqualTo(404);
        assertThat(api.body(detail).path("message").asText()).isEqualTo(api.body(api.get(lake, "/v1/products/" + missing)).path("message").asText());
        assertThat(detail.getResponse().getContentAsString()).doesNotContain(title);
        assertThat(status(api.get(lake, "/v1/products/" + a + "/comments"))).isEqualTo(404);
        assertThat(status(api.post(lake, "/v1/products/" + a + "/comments", Map.of("content", "跨校留言")))).isEqualTo(404);
        assertThat(status(api.post(lake, "/v1/products/" + a + "/view", Map.of()))).isEqualTo(404);
        assertThat(status(api.put(lake, "/v1/products/" + a + "/favorite", Map.of()))).isEqualTo(404);
        assertThat(api.ok(api.get(lake, "/v1/favorites"))).isEmpty();
        assertThat(status(api.post(lake, "/v1/conversations", Map.of("productId", a)))).isEqualTo(404);

        Map<String, Object> order = new LinkedHashMap<>();
        order.put("productId", a);
        order.put("meetingPointId", "东校区-library");
        order.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS).toString());
        order.put("contact", "13800000000");
        order.put("idempotencyKey", UUID.randomUUID().toString());
        assertThat(status(api.post(lake, "/v1/orders", order))).as("他校 PUBLIC 商品也不能下单").isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id=?::uuid", Long.class, a)).isZero();

        assertThat(status(api.get(lake, "/v1/users/" + pilotSeller.id()))).isEqualTo(404);
        assertThat(status(api.get(lake, "/v1/users/" + pilotSeller.id() + "/trade-summary"))).isEqualTo(404);
        User sameSchool = api.register();
        assertThat(status(api.get(sameSchool, "/v1/users/" + pilotSeller.id()))).isEqualTo(200);
        assertThat(status(api.get(sameSchool, "/v1/users/" + pilotSeller.id() + "/trade-summary"))).isEqualTo(200);
    }

    @Test
    @DisplayName("4. 写入不能跨校：发布到他校校区、把商品改到他校校区、把资料改到他校校区、草稿写他校校区都被拒绝")
    void writesStayInSchool() throws Exception {
        User pilot = api.register(), lake = api.register(LAKE);
        Map<String, Object> foreign = SupplyApi.single("生活用品", tag(), 30);
        foreign.put("campus", "东校区");
        assertThat(status(api.post(lake, "/v1/products", foreign))).isEqualTo(400);
        String mine = publish(pilot, "东校区", tag());
        Map<String, Object> move = new LinkedHashMap<>();
        move.put("campus", LAKE);
        move.put("buildingId", null);
        assertThat(status(api.patch(pilot, "/v1/products/" + mine, move))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT campus FROM products WHERE id=?::uuid", String.class, mine)).isEqualTo("东校区");
        assertThat(status(api.patch(pilot, "/v1/auth/me", Map.of("campus", LAKE)))).isEqualTo(400);
        assertThat(status(api.patch(pilot, "/v1/auth/me", Map.of("campus", "西校区")))).as("本校校区之间可以切换").isEqualTo(200);
        Map<String, Object> draft = SupplyApi.single("生活用品", tag(), 30);
        draft.put("campus", LAKE);
        String draftId = api.createDraft(pilot, "SINGLE", draft).path("id").asText();
        MvcResult ready = api.saveDraft(pilot, draftId, 1, draft, "READY");
        assertThat(status(ready)).isEqualTo(400);
        assertThat(api.body(ready).path("data").path("code").asText()).isEqualTo("INVALID_FIELD");
        // 注册时的校区按数据库校验：不存在的校区 400
        Map<String, Object> reg = new LinkedHashMap<>();
        reg.put("account", "iso" + UUID.randomUUID().toString().replace("-", ""));
        reg.put("password", "test-password-2026");
        reg.put("nickname", "隔离");
        reg.put("campus", "不存在的校区");
        assertThat(status(api.post(null, "/v1/auth/register", reg))).isEqualTo(400);
    }

    @Test
    @DisplayName("5. 需求雷达不跨校：他校订阅收不到本校新商品，收件箱与未读数都是 0")
    void demandRadarDoesNotCrossSchools() throws Exception {
        User pilotSeller = api.register(), lake = api.register(LAKE), pilot = api.register();
        String keyword = "隔离雷达" + UUID.randomUUID().toString().substring(0, 6);
        api.ok(api.post(lake, "/v1/demand-subscriptions", Map.of("keyword", keyword)));
        api.ok(api.post(pilot, "/v1/demand-subscriptions", Map.of("keyword", keyword)));
        publish(pilotSeller, "东校区", keyword + " 台灯");
        assertThat(api.ok(api.get(lake, "/v1/demand-matches")).path("total").asLong()).isZero();
        assertThat(api.ok(api.get(lake, "/v1/demand-matches/unread-count")).path("count").asLong()).isZero();
        assertThat(api.ok(api.get(pilot, "/v1/demand-matches")).path("total").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("6. 数据库兜底：商品校区必须与卖家同校、新订单买家必须与商品同校（绕过接口直接写库也会失败）")
    void databaseGuards() throws Exception {
        User pilot = api.register(), lake = api.register(LAKE);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status) "
                + "VALUES (gen_random_uuid(), ?::uuid, 't', 'd', 1, '其他', '全新', ?, '在售')", pilot.id(), LAKE))
                .isInstanceOf(DataAccessException.class);
        String mine = publish(pilot, "东校区", tag());
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET campus=? WHERE id=?::uuid", LAKE, mine)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, "
                + "confirmation_code, idempotency_key, request_hash, expires_at) VALUES (gen_random_uuid(), ?::uuid, ?::uuid, ?::uuid, 1, 'PENDING_SELLER_CONFIRM', "
                + "'东校区-library', now() + interval '1 day', 'c', '123456', 'k', 'h', now() + interval '2 days')", mine, lake.id(), pilot.id()))
                .isInstanceOf(DataAccessException.class);
    }
}
