package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 楼栋查询、宿舍楼资料与商品取货楼栋（1.2）。
 *
 * <p>楼栋这一层带来的最大风险是隐私：宿舍楼比校区精确得多，一旦混进任何一处
 * 公共投影，别人就能从一条留言或一件商品推出某个同学住哪。本类把
 * 「只出现在本人 /auth/me」这条边界反复钉死。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BuildingMarketIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String PASSWORD = "test-password-2026";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_bm")
            .withUsername("campus_bm").withPassword("campus_bm_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "building-market-it-secret-0123456789");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;

    // ------------------------------------------------------------------
    // 楼栋查询
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 按校区查询楼栋：未登录可读，按园区/序号/楼名排序，且不含任何住户信息")
    void listBuildingsByCampus() throws Exception {
        JsonNode items = data(mockMvc.perform(get("/v1/buildings").param("campus", "东校区")).andReturn());

        assertThat(items.isArray()).isTrue();
        assertThat(items.size()).as("东校区演示楼栋").isEqualTo(5);

        // 排序契约：zone → sort_order → name → id，文本按 Unicode 码点比较（COLLATE "C"）。
        // 「松」U+677E 小于「沁」U+6C81，因此松园在前——这个顺序与数据库 locale 无关。
        assertThat(names(items)).containsExactly("4号楼", "5号楼", "1号楼", "2号楼", "3号楼");
        List<String> ids = new java.util.ArrayList<>();
        items.forEach(node -> ids.add(node.path("id").asText()));
        assertThat(ids).containsExactly(
                "east-songyuan-4", "east-songyuan-5", "east-qinyuan-1", "east-qinyuan-2", "east-qinyuan-3");

        JsonNode first = items.get(0);
        assertThat(first.path("campusId").asText()).isEqualTo("东校区");
        assertThat(first.path("zone").asText()).isEqualTo("松园");
        assertThat(first.path("latitude").isNumber()).isTrue();
        assertThat(first.path("longitude").isNumber()).isTrue();

        // 公共参考数据：不得出现住户数量、用户 id 之类的字段
        List<String> fields = new java.util.ArrayList<>();
        first.fieldNames().forEachRemaining(fields::add);
        assertThat(fields).containsExactlyInAnyOrder("id", "campusId", "zone", "name", "latitude", "longitude");
    }

    @Test
    @DisplayName("1b. 园区内 sort_order 相同、名称相同时按 id 收敛，顺序稳定")
    void orderingIsTotalEvenWithTies() throws Exception {
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name,sort_order) VALUES "
                + "('tie-b','北校区','并列园','并列楼B',9),('tie-a','北校区','并列园','并列楼A',9)");
        try {
            for (int i = 0; i < 3; i++) {
                JsonNode items = data(mockMvc.perform(
                        get("/v1/buildings").param("campus", "北校区").param("zone", "并列园")).andReturn());
                assertThat(names(items)).containsExactly("并列楼A", "并列楼B");
            }
        } finally {
            jdbc.update("DELETE FROM buildings WHERE id IN ('tie-a','tie-b')");
        }
    }

    @Test
    @DisplayName("2. zone 过滤只返回该园区")
    void filterByZone() throws Exception {
        JsonNode items = data(mockMvc.perform(
                get("/v1/buildings").param("campus", "东校区").param("zone", "松园")).andReturn());
        assertThat(names(items)).containsExactly("4号楼", "5号楼");
        assertThat(items).allSatisfy(node -> assertThat(node.path("zone").asText()).isEqualTo("松园"));
    }

    @Test
    @DisplayName("3. 停用楼栋不出现在列表中；无效校区返回 400")
    void inactiveBuildingsAreHidden() throws Exception {
        jdbc.update("UPDATE buildings SET active=false WHERE id='east-songyuan-5'");
        try {
            assertThat(names(data(mockMvc.perform(
                    get("/v1/buildings").param("campus", "东校区")).andReturn())))
                    .doesNotContain("5号楼");
        } finally {
            jdbc.update("UPDATE buildings SET active=true WHERE id='east-songyuan-5'");
        }

        assertThat(mockMvc.perform(get("/v1/buildings").param("campus", "不存在校区")).andReturn()
                .getResponse().getStatus()).isEqualTo(400);
    }

    // ------------------------------------------------------------------
    // 个人宿舍楼
    // ------------------------------------------------------------------

    @Test
    @DisplayName("4. 设置同校区楼栋成功，并出现在本人 /auth/me")
    void setDormBuildingInSameCampus() throws Exception {
        String token = tokenOf(register(account("dorm"), "东校区"));

        JsonNode updated = data(patchProfile(token, Map.of("dormBuildingId", "east-qinyuan-2")));
        assertThat(updated.path("dormBuildingId").asText()).isEqualTo("east-qinyuan-2");

        JsonNode me = data(mockMvc.perform(get("/v1/auth/me").header("Authorization", "Bearer " + token)).andReturn());
        assertThat(me.path("dormBuildingId").asText()).isEqualTo("east-qinyuan-2");
    }

    @Test
    @DisplayName("5. 跨校区楼栋被拒绝，且不落库")
    void crossCampusDormBuildingIsRejected() throws Exception {
        String token = tokenOf(register(account("cross"), "东校区"));

        MvcResult result = patchProfile(token, Map.of("dormBuildingId", "west-zhuyuan-1"));
        assertThat(result.getResponse().getStatus()).isEqualTo(400);

        JsonNode me = data(mockMvc.perform(get("/v1/auth/me").header("Authorization", "Bearer " + token)).andReturn());
        assertThat(me.path("dormBuildingId").isNull()).as("失败的请求不得写入任何值").isTrue();
    }

    @Test
    @DisplayName("6. 停用楼栋 400，不存在楼栋 404")
    void inactiveAndMissingBuildingsAreRejected() throws Exception {
        String token = tokenOf(register(account("bad"), "东校区"));

        jdbc.update("UPDATE buildings SET active=false WHERE id='east-qinyuan-3'");
        try {
            assertThat(patchProfile(token, Map.of("dormBuildingId", "east-qinyuan-3"))
                    .getResponse().getStatus()).as("停用楼栋是合法资源但非法输入 → 400").isEqualTo(400);
        } finally {
            jdbc.update("UPDATE buildings SET active=true WHERE id='east-qinyuan-3'");
        }

        assertThat(patchProfile(token, Map.of("dormBuildingId", "no-such-building"))
                .getResponse().getStatus()).as("不存在的楼栋 → 404").isEqualTo(404);
    }

    @Test
    @DisplayName("7. 显式清空宿舍楼成功")
    void dormBuildingCanBeCleared() throws Exception {
        String token = tokenOf(register(account("clear"), "东校区"));
        patchProfile(token, Map.of("dormBuildingId", "east-qinyuan-1"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("dormBuildingId", null);
        JsonNode cleared = data(patchProfile(token, body));
        assertThat(cleared.path("dormBuildingId").isNull()).as("用户有权收回这条信息").isTrue();
    }

    @Test
    @DisplayName("8. 同时修改 campus 与 dormBuildingId 时按新校区校验")
    void campusAndDormChangeTogetherUsesNewCampus() throws Exception {
        String token = tokenOf(register(account("move"), "东校区"));
        patchProfile(token, Map.of("dormBuildingId", "east-qinyuan-1"));

        Map<String, Object> move = new LinkedHashMap<>();
        move.put("campus", "西校区");
        move.put("dormBuildingId", "west-meiyuan-3");
        JsonNode moved = data(patchProfile(token, move));
        assertThat(moved.path("campus").asText()).isEqualTo("西校区");
        assertThat(moved.path("dormBuildingId").asText()).isEqualTo("west-meiyuan-3");

        // 反过来：搬到西校区却选东校区楼栋，必须被拒
        Map<String, Object> wrong = new LinkedHashMap<>();
        wrong.put("campus", "南校区");
        wrong.put("dormBuildingId", "west-meiyuan-3");
        assertThat(patchProfile(token, wrong).getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    @DisplayName("9. 公共用户投影绝不泄露 dormBuildingId（/users/{id}、商品卖家、评论）")
    void publicProjectionsNeverLeakDormBuilding() throws Exception {
        String account = account("privacy");
        MvcResult registered = register(account, "东校区");
        String token = tokenOf(registered);
        String userId = data(registered).path("user").path("id").asText();
        patchProfile(token, Map.of("dormBuildingId", "east-qinyuan-1"));

        // 公共用户接口
        MvcResult publicUser = mockMvc.perform(get("/v1/users/" + userId).header("Authorization", "Bearer " + viewerToken())).andReturn();
        assertThat(publicUser.getResponse().getContentAsString())
                .as("公共用户投影不得包含宿舍楼").doesNotContain("dormBuildingId")
                .doesNotContain("east-qinyuan-1");

        // 商品详情里的卖家信息
        String productId = createProduct(token, "东校区", "east-qinyuan-1").path("id").asText();
        MvcResult product = mockMvc.perform(get("/v1/products/" + productId).header("Authorization", "Bearer " + viewerToken())).andReturn();
        assertThat(product.getResponse().getContentAsString()).doesNotContain("dormBuildingId");

        // 评论
        mockMvc.perform(post("/v1/products/" + productId + "/comments")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"楼栋隐私测试\",\"parentId\":null}")).andReturn();
        MvcResult comments = mockMvc.perform(get("/v1/products/" + productId + "/comments").header("Authorization", "Bearer " + viewerToken())).andReturn();
        assertThat(comments.getResponse().getContentAsString()).doesNotContain("dormBuildingId");
    }

    @Test
    @DisplayName("10. 不存在房间号 / 楼层 / 床位这类字段，且它们会被白名单拒绝")
    void noRoomLevelFieldsExist() throws Exception {
        String token = tokenOf(register(account("room"), "东校区"));
        for (String field : List.of("roomNumber", "floor", "bed", "dormRoom")) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put(field, "301");
            assertThat(patchProfile(token, body).getResponse().getStatus())
                    .as("%s 必须被未知字段白名单拒绝", field).isEqualTo(400);
        }
        // 数据库里也不应存在这类列
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns "
                        + "WHERE table_schema='public' AND table_name IN ('users','buildings','products')",
                String.class);
        assertThat(columns).noneSatisfy(column ->
                assertThat(column).containsAnyOf("room", "floor", "bed"));
    }

    // ------------------------------------------------------------------
    // 商品取货楼栋
    // ------------------------------------------------------------------

    @Test
    @DisplayName("11. 商品可关联取货楼栋，列表与详情都带 buildingId/buildingName/buildingZone")
    void productCarriesBuildingProjection() throws Exception {
        String token = tokenOf(register(account("pb"), "东校区"));
        JsonNode created = createProduct(token, "东校区", "east-songyuan-4");

        assertThat(created.path("buildingId").asText()).isEqualTo("east-songyuan-4");
        assertThat(created.path("buildingName").asText()).isEqualTo("4号楼");
        assertThat(created.path("buildingZone").asText()).isEqualTo("松园");

        JsonNode detail = data(mockMvc.perform(get("/v1/products/" + created.path("id").asText()).header("Authorization", "Bearer " + viewerToken())).andReturn());
        assertThat(detail.path("buildingName").asText()).isEqualTo("4号楼");

        JsonNode list = data(mockMvc.perform(get("/v1/products").param("campus", "东校区").header("Authorization", "Bearer " + viewerToken())).andReturn()).path("items");
        JsonNode mine = findById(list, created.path("id").asText());
        assertThat(mine.path("buildingZone").asText()).isEqualTo("松园");
    }

    @Test
    @DisplayName("12. 商品跨校区楼栋拒绝；不存在楼栋 404")
    void productBuildingMustMatchCampus() throws Exception {
        String token = tokenOf(register(account("pbad"), "东校区"));
        assertThat(createProductRaw(token, "东校区", "west-zhuyuan-1").getResponse().getStatus())
                .as("跨校区楼栋 → 400").isEqualTo(400);
        assertThat(createProductRaw(token, "东校区", "no-such-building").getResponse().getStatus())
                .as("不存在楼栋 → 404").isEqualTo(404);
    }

    @Test
    @DisplayName("13. 不指定楼栋是合法选择；旧商品 buildingId=null 仍可正常读取")
    void productWithoutBuildingIsValid() throws Exception {
        String token = tokenOf(register(account("pnull"), "东校区"));
        JsonNode created = createProduct(token, "东校区", null);
        assertThat(created.path("buildingId").isNull()).isTrue();
        assertThat(created.path("buildingName").isNull()).isTrue();

        JsonNode detail = data(mockMvc.perform(get("/v1/products/" + created.path("id").asText()).header("Authorization", "Bearer " + viewerToken())).andReturn());
        assertThat(detail.path("campus").asText()).as("没有楼栋时仍有校区可显示").isEqualTo("东校区");
        assertThat(detail.path("buildingId").isNull()).isTrue();
    }

    @Test
    @DisplayName("14. 更新楼栋成功，也可显式清空")
    void productBuildingCanBeUpdatedAndCleared() throws Exception {
        String token = tokenOf(register(account("pupd"), "东校区"));
        String id = createProduct(token, "东校区", "east-qinyuan-1").path("id").asText();

        JsonNode moved = data(patchProduct(token, id, Map.of("buildingId", "east-qinyuan-3")));
        assertThat(moved.path("buildingId").asText()).isEqualTo("east-qinyuan-3");

        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("buildingId", null);
        assertThat(data(patchProduct(token, id, clear)).path("buildingId").isNull()).isTrue();
    }

    @Test
    @DisplayName("15. 切换校区的语义固定：原楼栋不属于新校区且未同时给 buildingId → 400")
    void campusSwitchRequiresExplicitBuildingDecision() throws Exception {
        String token = tokenOf(register(account("pswitch"), "东校区"));
        String id = createProduct(token, "东校区", "east-qinyuan-1").path("id").asText();

        // 只改校区：必须显式表态
        MvcResult rejected = patchProduct(token, id, Map.of("campus", "西校区"));
        assertThat(rejected.getResponse().getStatus()).isEqualTo(400);
        assertThat(data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("campus").asText())
                .as("被拒绝的请求不得改动校区").isEqualTo("东校区");

        // 同时给新校区的楼栋：通过
        Map<String, Object> both = new LinkedHashMap<>();
        both.put("campus", "西校区");
        both.put("buildingId", "west-zhuyuan-2");
        JsonNode moved = data(patchProduct(token, id, both));
        assertThat(moved.path("campus").asText()).isEqualTo("西校区");
        assertThat(moved.path("buildingId").asText()).isEqualTo("west-zhuyuan-2");

        // 同时显式清空楼栋：也通过
        Map<String, Object> cleared = new LinkedHashMap<>();
        cleared.put("campus", "南校区");
        cleared.put("buildingId", null);
        JsonNode south = data(patchProduct(token, id, cleared));
        assertThat(south.path("campus").asText()).isEqualTo("南校区");
        assertThat(south.path("buildingId").isNull()).isTrue();

        // 原本就没有楼栋的商品，改校区不受影响
        String plain = createProduct(token, "东校区", null).path("id").asText();
        assertThat(patchProduct(token, plain, Map.of("campus", "北校区")).getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("16. 未知字段无副作用：buildingId 拼错时整个请求被拒，不部分生效")
    void unknownFieldsHaveNoSideEffect() throws Exception {
        String token = tokenOf(register(account("punk"), "东校区"));
        String id = createProduct(token, "东校区", "east-qinyuan-1").path("id").asText();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "改了标题");
        body.put("building_id", "east-qinyuan-2");   // 蛇形拼写：未知字段
        assertThat(patchProduct(token, id, body).getResponse().getStatus()).isEqualTo(400);

        JsonNode after = data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn());
        assertThat(after.path("title").asText()).as("标题不得被部分应用").isNotEqualTo("改了标题");
        assertThat(after.path("buildingId").asText()).isEqualTo("east-qinyuan-1");
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    /** 6.1A：商品与他人资料都需要登录；用一位同校的查看者读取 */
    private String viewer;
    private String viewerToken() throws Exception {
        if (viewer == null) viewer = tokenOf(register(account("viewer"), "东校区"));
        return viewer;
    }

    private static String account(String prefix) {
        return prefix + UUID.randomUUID().toString().replace("-", "");
    }

    private JsonNode data(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private List<String> names(JsonNode items) {
        List<String> names = new java.util.ArrayList<>();
        items.forEach(node -> names.add(node.path("name").asText()));
        return names;
    }

    private JsonNode findById(JsonNode items, String id) {
        for (JsonNode node : items) if (id.equals(node.path("id").asText())) return node;
        throw new AssertionError("列表中未找到商品 " + id);
    }

    private MvcResult register(String account, String campus) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", PASSWORD);
        body.put("nickname", "楼栋测试");
        body.put("campus", campus);
        body.put("contact", "13800000000");
        return mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private String tokenOf(MvcResult registered) throws Exception {
        return data(registered).path("accessToken").asText();
    }

    private MvcResult patchProfile(String token, Map<String, Object> body) throws Exception {
        return mockMvc.perform(patch("/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private MvcResult patchProduct(String token, String id, Map<String, Object> body) throws Exception {
        return mockMvc.perform(patch("/v1/products/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }

    private JsonNode createProduct(String token, String campus, String buildingId) throws Exception {
        MvcResult result = createProductRaw(token, campus, buildingId);
        assertThat(result.getResponse().getStatus()).as("发布商品应成功").isEqualTo(200);
        return data(result);
    }

    private MvcResult createProductRaw(String token, String campus, String buildingId) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "楼栋集市测试商品");
        body.put("description", "用于验证取货楼栋");
        body.put("price", 10);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "全新");
        body.put("campus", campus);
        body.put("images", List.of("https://example.invalid/a.png"));
        body.put("contact", "13800000000");
        body.put("buildingId", buildingId);
        return mockMvc.perform(post("/v1/products")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
    }
}
