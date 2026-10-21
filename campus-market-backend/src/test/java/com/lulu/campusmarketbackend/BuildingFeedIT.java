package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import com.lulu.campusmarketbackend.support.StatementCounter;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 「只看本楼」四级自动降级与最近排序（1.3）。
 *
 * <p>每个用例使用<b>专属关键词</b>隔离自己的数据。keyword 在降级过程中必须原样保留，
 * 所以用它做隔离既干净，又顺带验证了「降级不丢筛选条件」这条核心约束。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BuildingFeedIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String PASSWORD = "test-password-2026";

    /** 买家宿舍楼：东校区 沁园 1号楼 (31.00000, 121.00000) */
    private static final String HOME = "east-qinyuan-1";
    /** 同园区：沁园 2号楼，北移约 100 米 */
    private static final String SAME_ZONE = "east-qinyuan-2";
    /** 同园区更远：沁园 3号楼，约 200 米 */
    private static final String SAME_ZONE_FAR = "east-qinyuan-3";
    /** 同校区不同园区：松园 4号楼，东移约 400 米 */
    private static final String OTHER_ZONE = "east-songyuan-4";
    /** 其他校区：西校区 竹园 1号楼 */
    private static final String OTHER_CAMPUS = "west-zhuyuan-1";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_feed")
            .withUsername("campus_feed").withPassword("campus_feed_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "building-feed-it-secret-0123456789ab");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private org.apache.ibatis.session.SqlSessionFactory sessions;

    /** 住在 HOME 的买家，所有范围判断都以他为视角。 */
    private String residentToken;
    /** 另一个不填宿舍楼的用户，用于发布商品，避免「自己的商品」影响可见性判断。 */
    private String sellerToken;

    @BeforeEach
    void setUp() throws Exception {
        residentToken = tokenOf(register(account("resident"), "东校区"));
        patchProfile(residentToken, Map.of("dormBuildingId", HOME));
        sellerToken = tokenOf(register(account("seller"), "东校区"));
    }

    // ------------------------------------------------------------------
    // 四级降级
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 本楼有结果时不降级")
    void noFallbackWhenBuildingHasResults() throws Exception {
        String tag = tag();
        publish(tag, "东校区", HOME);
        publish(tag, "东校区", OTHER_ZONE);

        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        assertThat(feed.path("effectiveScope").asText()).isEqualTo("BUILDING");
        assertThat(feed.path("fallbackApplied").asBoolean()).isFalse();
        assertThat(feed.path("fallbackReason").isNull()).isTrue();
        assertThat(feed.path("total").asLong()).as("只应看到本楼那一件").isEqualTo(1);
    }

    @Test
    @DisplayName("2. 本楼空、同园区有结果 → 降到 ZONE")
    void fallsBackToZone() throws Exception {
        String tag = tag();
        publish(tag, "东校区", SAME_ZONE);
        publish(tag, "东校区", OTHER_ZONE);

        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        assertThat(feed.path("effectiveScope").asText()).isEqualTo("ZONE");
        assertThat(feed.path("effectiveScopeLabel").asText()).isEqualTo("本园区");
        assertThat(feed.path("fallbackApplied").asBoolean()).isTrue();
        assertThat(feed.path("fallbackReason").asText()).isEqualTo("NO_RESULTS_IN_REQUESTED_SCOPE");
        assertThat(feed.path("total").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("3. 本楼与园区均空、校区有结果 → 降到 CAMPUS")
    void fallsBackToCampus() throws Exception {
        String tag = tag();
        publish(tag, "东校区", OTHER_ZONE);
        publish(tag, "西校区", OTHER_CAMPUS);

        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        assertThat(feed.path("effectiveScope").asText()).isEqualTo("CAMPUS");
        assertThat(feed.path("total").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("4. 校区也空、全校有结果 → 降到 SCHOOL")
    void fallsBackToSchool() throws Exception {
        String tag = tag();
        publish(tag, "西校区", OTHER_CAMPUS);

        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        assertThat(feed.path("effectiveScope").asText()).isEqualTo("SCHOOL");
        assertThat(feed.path("effectiveScopeLabel").asText()).isEqualTo("全校");
        assertThat(feed.path("total").asLong()).isEqualTo(1);
    }

    @Test
    @DisplayName("5. 全校都没有 → 真空态，而不是拿别的东西凑数")
    void trulyEmptyWhenNothingMatchesAnywhere() throws Exception {
        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag()));
        assertThat(feed.path("effectiveScope").asText()).isEqualTo("SCHOOL");
        assertThat(feed.path("fallbackApplied").asBoolean()).isTrue();
        assertThat(feed.path("fallbackReason").asText()).isEqualTo("NO_RESULTS_IN_ANY_SCOPE");
        assertThat(feed.path("total").asLong()).isZero();
        assertThat(feed.path("items")).isEmpty();
    }

    @Test
    @DisplayName("6. 降级只放宽地理范围：分类 / 关键词 / 价格 / 成色逐条保留")
    void fallbackPreservesEveryFilter() throws Exception {
        String tag = tag();
        // 本楼有商品，但不是用户要的分类；同园区才有匹配的分类
        publish(tag, "东校区", HOME, "教材书籍", 50, "全新");
        publish(tag, "东校区", SAME_ZONE, "数码电子", 50, "全新");
        // 同园区还有同分类但价格超出区间的，不应被算进来
        publish(tag, "东校区", SAME_ZONE_FAR, "数码电子", 9000, "全新");

        JsonNode feed = feed(residentToken, Map.of(
                "scope", "BUILDING", "keyword", tag, "category", "数码电子",
                "minPrice", "10", "maxPrice", "100", "condition", "全新"));

        assertThat(feed.path("effectiveScope").asText())
                .as("本楼没有「数码」，应降到园区继续找「数码」").isEqualTo("ZONE");
        assertThat(feed.path("total").asLong()).isEqualTo(1);
        assertThat(feed.path("items").get(0).path("category").asText()).isEqualTo("数码电子");
        assertThat(feed.path("items").get(0).path("price").asDouble()).isEqualTo(50.0);
    }

    @Test
    @DisplayName("7. 非本楼模式（CAMPUS / SCHOOL）结果为空时绝不自动扩大范围")
    void plainBrowsingNeverExpandsScope() throws Exception {
        String tag = tag();
        publish(tag, "西校区", OTHER_CAMPUS);

        // 用户明确要求本校区：东校区没有就是没有，不能把西校区的塞过来
        JsonNode campusScoped = feed(residentToken, Map.of("scope", "CAMPUS", "keyword", tag));
        assertThat(campusScoped.path("effectiveScope").asText()).isEqualTo("CAMPUS");
        assertThat(campusScoped.path("fallbackApplied").asBoolean()).isFalse();
        assertThat(campusScoped.path("total").asLong()).isZero();
    }

    // ------------------------------------------------------------------
    // 未登录 / 未配置宿舍楼 / 楼栋停用
    // ------------------------------------------------------------------

    @Test
    @DisplayName("8. 未登录请求本楼 → 401，且不返回任何商品")
    void anonymousCannotRequestBuildingScope() throws Exception {
        MvcResult result = mockMvc.perform(get("/v1/products/feed").param("scope", "BUILDING")).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(401);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("\"items\"");
    }

    @Test
    @DisplayName("9. 已登录但未设置宿舍楼 → 409，不用全校结果冒充本楼")
    void userWithoutDormBuildingGets409() throws Exception {
        MvcResult result = mockMvc.perform(get("/v1/products/feed")
                .param("scope", "BUILDING")
                .header("Authorization", "Bearer " + sellerToken)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(409);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("\"items\"");
    }

    @Test
    @DisplayName("10. 宿舍楼被停用 → 409 要求重新选择，而不是静默退回校区")
    void inactiveDormBuildingIsRejected() throws Exception {
        jdbc.update("UPDATE buildings SET active=false WHERE id=?", HOME);
        try {
            assertThat(mockMvc.perform(get("/v1/products/feed")
                    .param("scope", "BUILDING")
                    .header("Authorization", "Bearer " + residentToken)).andReturn()
                    .getResponse().getStatus()).isEqualTo(409);
        } finally {
            jdbc.update("UPDATE buildings SET active=true WHERE id=?", HOME);
        }
    }

    @Test
    @DisplayName("11. 停用楼栋不参与同园区范围")
    void inactiveBuildingsDoNotJoinZoneScope() throws Exception {
        String tag = tag();
        publish(tag, "东校区", SAME_ZONE);
        publish(tag, "东校区", OTHER_ZONE);

        jdbc.update("UPDATE buildings SET active=false WHERE id=?", SAME_ZONE);
        try {
            JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
            assertThat(feed.path("effectiveScope").asText())
                    .as("园区里唯一的商品在停用楼栋，应继续降到校区").isEqualTo("CAMPUS");
        } finally {
            jdbc.update("UPDATE buildings SET active=true WHERE id=?", SAME_ZONE);
        }
    }

    // ------------------------------------------------------------------
    // 最近排序
    // ------------------------------------------------------------------

    @Test
    @DisplayName("12. nearest：同楼栋第一，其次按距离，无楼栋商品排最后")
    void nearestOrdersByDistanceWithBuildinglessLast() throws Exception {
        String tag = tag();
        // 故意按「最远 → 最近」的顺序发布，确保排序不是靠 created_at 蒙对的
        String none = publish(tag, "东校区", null);
        String far = publish(tag, "东校区", OTHER_ZONE);
        String near = publish(tag, "东校区", SAME_ZONE);
        String home = publish(tag, "东校区", HOME);

        JsonNode items = feed(residentToken,
                Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", tag)).path("items");

        assertThat(ids(items)).containsExactly(home, near, far, none);
        assertThat(items.get(0).path("sameBuilding").asBoolean()).isTrue();
        assertThat(items.get(1).path("sameBuilding").asBoolean()).isFalse();
        assertThat(items.get(3).path("buildingId").isNull()).isTrue();
    }

    @Test
    @DisplayName("13. 距离与步行分钟：约 100 米 ≈ 2 分钟，约 400 米 ≈ 5 分钟；同楼栋不给假的 0 分钟")
    void distanceAndWalkMinutesAreReasonable() throws Exception {
        String tag = tag();
        publish(tag, "东校区", HOME);
        publish(tag, "东校区", SAME_ZONE);
        publish(tag, "东校区", OTHER_ZONE);

        JsonNode items = feed(residentToken,
                Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", tag)).path("items");

        JsonNode same = items.get(0);
        assertThat(same.path("sameBuilding").asBoolean()).isTrue();
        assertThat(same.path("approximateDistanceMeters").isNull())
                .as("同楼栋不展示距离，更不展示 0 分钟导航").isTrue();
        assertThat(same.path("approximateWalkMinutes").isNull()).isTrue();

        JsonNode near = items.get(1);
        assertThat(near.path("approximateDistanceMeters").asLong()).isBetween(90L, 110L);
        assertThat(near.path("approximateWalkMinutes").asLong()).isEqualTo(2);

        JsonNode far = items.get(2);
        assertThat(far.path("approximateDistanceMeters").asLong()).isBetween(380L, 420L);
        assertThat(far.path("approximateWalkMinutes").asLong()).isEqualTo(5);
    }

    @Test
    @DisplayName("14. tie-break 稳定：同一查询重复请求顺序完全一致")
    void orderingIsStableAcrossRepeatedRequests() throws Exception {
        String tag = tag();
        // 三件商品都在同一栋楼、同一时刻附近发布，距离与时间都无法区分，只能靠 id 收敛
        for (int i = 0; i < 3; i++) publish(tag, "东校区", SAME_ZONE);

        List<String> first = ids(feed(residentToken,
                Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", tag)).path("items"));
        for (int i = 0; i < 3; i++) {
            assertThat(ids(feed(residentToken,
                    Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", tag)).path("items")))
                    .as("第 %d 次重复请求顺序应完全一致", i + 1).isEqualTo(first);
        }
    }

    @Test
    @DisplayName("15. 无宿舍楼的用户请求 nearest → 409，不退化成按时间排序冒充「最近」")
    void nearestRequiresDormBuilding() throws Exception {
        assertThat(mockMvc.perform(get("/v1/products/feed")
                .param("sort", "nearest").param("scope", "SCHOOL")
                .header("Authorization", "Bearer " + sellerToken)).andReturn()
                .getResponse().getStatus()).isEqualTo(409);
    }

    // ------------------------------------------------------------------
    // 分页
    // ------------------------------------------------------------------

    @Test
    @DisplayName("16. 范围选择发生在分页之前：第二页不会触发错误降级")
    void scopeIsChosenBeforePaging() throws Exception {
        String tag = tag();
        // 本楼只有 2 件；园区另有 5 件。pageSize=2 时第二页在 BUILDING 范围内为空，
        // 但范围已按总数选定为 BUILDING，绝不能因为「这一页空」就降级到 ZONE。
        for (int i = 0; i < 2; i++) publish(tag, "东校区", HOME);
        for (int i = 0; i < 5; i++) publish(tag, "东校区", SAME_ZONE);

        JsonNode page1 = feed(residentToken,
                Map.of("scope", "BUILDING", "keyword", tag, "pageSize", "2", "page", "1"));
        assertThat(page1.path("effectiveScope").asText()).isEqualTo("BUILDING");
        assertThat(page1.path("total").asLong()).isEqualTo(2);
        assertThat(page1.path("items")).hasSize(2);

        JsonNode page2 = feed(residentToken,
                Map.of("scope", "BUILDING", "keyword", tag, "pageSize", "2", "page", "2"));
        assertThat(page2.path("effectiveScope").asText())
                .as("第二页必须仍是 BUILDING").isEqualTo("BUILDING");
        assertThat(page2.path("fallbackApplied").asBoolean()).isFalse();
        assertThat(page2.path("total").asLong()).isEqualTo(2);
        assertThat(page2.path("items")).isEmpty();
    }

    @Test
    @DisplayName("17. 分页不重不漏，且跨页顺序与单页一致")
    void pagingIsConsistentWithSinglePage() throws Exception {
        String tag = tag();
        publish(tag, "东校区", HOME);
        publish(tag, "东校区", SAME_ZONE);
        publish(tag, "东校区", SAME_ZONE_FAR);
        publish(tag, "东校区", OTHER_ZONE);

        List<String> all = ids(feed(residentToken,
                Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", tag, "pageSize", "10")).path("items"));
        List<String> paged = new ArrayList<>();
        for (int page = 1; page <= 2; page++) {
            paged.addAll(ids(feed(residentToken, Map.of("scope", "CAMPUS", "sort", "nearest",
                    "keyword", tag, "pageSize", "2", "page", String.valueOf(page))).path("items")));
        }
        assertThat(paged).isEqualTo(all);
        assertThat(paged).doesNotHaveDuplicates().hasSize(4);
    }

    // ------------------------------------------------------------------
    // 兼容与元数据
    // ------------------------------------------------------------------

    @Test
    @DisplayName("18. 旧商品（无楼栋）仍能出现在 CAMPUS / SCHOOL 范围")
    void productsWithoutBuildingRemainVisible() throws Exception {
        String tag = tag();
        String legacy = publish(tag, "东校区", null);

        assertThat(ids(feed(residentToken, Map.of("scope", "CAMPUS", "keyword", tag)).path("items")))
                .contains(legacy);
        assertThat(ids(feed(residentToken, Map.of("scope", "SCHOOL", "keyword", tag)).path("items")))
                .contains(legacy);
        // 但它不属于任何楼栋，本楼范围里不该出现
        JsonNode building = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        assertThat(building.path("effectiveScope").asText()).isEqualTo("CAMPUS");
    }

    @Test
    @DisplayName("19. 元数据完整：四个 scope 字段与分页信息都存在且自洽")
    void metadataIsComplete() throws Exception {
        String tag = tag();
        publish(tag, "东校区", HOME);

        JsonNode feed = feed(residentToken, Map.of("scope", "BUILDING", "keyword", tag));
        List<String> fields = new ArrayList<>();
        feed.fieldNames().forEachRemaining(fields::add);
        assertThat(fields).contains("requestedScope", "effectiveScope", "effectiveScopeLabel",
                "fallbackApplied", "fallbackReason", "items", "total", "page", "pageSize");
        assertThat(feed.path("requestedScope").asText()).isEqualTo("BUILDING");
        assertThat(feed.path("page").asInt()).isEqualTo(1);
        assertThat(feed.path("items").size()).isLessThanOrEqualTo(feed.path("pageSize").asInt());

        // 旧的 /v1/products 未被破坏
        JsonNode legacy = data(mockMvc.perform(get("/v1/products").param("campus", "东校区").header("Authorization", "Bearer " + residentToken)).andReturn());
        assertThat(legacy.has("items")).isTrue();
        assertThat(legacy.has("effectiveScope")).as("旧端点不应长出新字段").isFalse();
    }

    @Test
    @DisplayName("20. 无 N+1：一次 feed 请求的 SQL 条数与结果条数无关")
    void feedDoesNotIssuePerRowQueries() throws Exception {
        StatementCounter counter = StatementCounter.install(sessions);
        String few = tag(), many = tag();
        for (int i = 0; i < 2; i++) publish(few, "东校区", i % 2 == 0 ? HOME : SAME_ZONE);
        for (int i = 0; i < 12; i++) publish(many, "东校区", i % 2 == 0 ? HOME : SAME_ZONE);

        long[] counts = new long[2];
        String[] tags = {few, many};
        for (int i = 0; i < 2; i++) {
            String t = tags[i];
            counts[i] = counter.during(() -> {
                try {
                    feed(residentToken, Map.of("scope", "CAMPUS", "sort", "nearest", "keyword", t, "pageSize", "20"));
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            });
        }
        // 改造说明：此前用 pg_stat_database 的事务计数近似，那组计数异步刷新，
        // 读到的增量经常是 0，断言形同虚设。现改为在 MyBatis 层精确计数。
        assertThat(counts[0]).as("计数器必须真的计到了语句").isPositive();
        assertThat(counts[1]).as("2 条与 12 条结果的语句数必须相同").isEqualTo(counts[0]);
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    /** 每个用例专属的关键词，用来把自己的数据与其他用例隔离开。 */
    private static String tag() {
        return "tag" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private static String account(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "");
    }

    private JsonNode data(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode feed(String token, Map<String, String> params) throws Exception {
        MockHttpServletRequestBuilder request = get("/v1/products/feed");
        params.forEach(request::param);
        if (token != null) request.header("Authorization", "Bearer " + token);
        MvcResult result = mockMvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("feed 请求应成功：%s", result.getResponse().getContentAsString()).isEqualTo(200);
        return data(result);
    }

    private List<String> ids(JsonNode items) {
        List<String> ids = new ArrayList<>();
        items.forEach(node -> ids.add(node.path("id").asText()));
        return ids;
    }

    private MvcResult register(String account, String campus) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", PASSWORD);
        body.put("nickname", "楼栋 feed");
        body.put("campus", campus);
        body.put("contact", "13800000000");
        return mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private String tokenOf(MvcResult registered) throws Exception {
        return data(registered).path("accessToken").asText();
    }

    private void patchProfile(String token, Map<String, Object> body) throws Exception {
        MvcResult result = mockMvc.perform(patch("/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
    }

    private String publish(String tag, String campus, String buildingId) throws Exception {
        return publish(tag, campus, buildingId, "生活用品", 30, "全新");
    }

    private String publish(String tag, String campus, String buildingId,
                           String category, int price, String condition) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", tag + " 商品");
        body.put("description", "楼栋 feed 用例数据 " + tag);
        body.put("price", price);
        body.put("category", category);
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure(category));
        body.put("condition", condition);
        body.put("campus", campus);
        body.put("images", List.of("https://example.invalid/a.png"));
        body.put("contact", "13800000000");
        body.put("buildingId", buildingId);
        MvcResult result = mockMvc.perform(post("/v1/products")
                .header("Authorization", "Bearer " + sellerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("发布失败：%s", result.getResponse().getContentAsString()).isEqualTo(200);
        return data(result).path("id").asText();
    }
}
