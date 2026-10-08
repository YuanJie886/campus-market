package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.InspectionFixtures;
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

import java.math.BigDecimal;
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
 * 商品结构化验货声明（3.2）。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProductInspectionIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_pi")
            .withUsername("campus_pi").withPassword("campus_pi_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "product-inspection-it-secret-012345678");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcTemplate jdbc;

    // ------------------------------------------------------------------
    // 模板查询
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 模板查询：只返回当前版本的公开字段，不返回数据库内部字段")
    void templateQuery() throws Exception {
        JsonNode template = data(mockMvc.perform(get("/v1/inspection-templates").param("category", "数码电子")).andReturn());
        assertThat(template.path("version").asInt()).isEqualTo(1);
        assertThat(template.path("items")).hasSize(8);
        assertThat(fields(template)).containsExactlyInAnyOrder("category", "version", "title", "items");
        assertThat(fields(template.path("items").get(0))).containsExactlyInAnyOrder("code", "label", "description", "required");
        assertThat(template.path("items").get(0).path("code").asText()).isEqualTo("POWER_ON");
    }

    @Test
    @DisplayName("2. 「其他」没有模板（data=null）；无效分类 400")
    void unsupportedCategory() throws Exception {
        MvcResult other = mockMvc.perform(get("/v1/inspection-templates").param("category", "其他")).andReturn();
        assertThat(other.getResponse().getStatus()).isEqualTo(200);
        assertThat(data(other).isNull()).isTrue();
        assertThat(mockMvc.perform(get("/v1/inspection-templates").param("category", "不存在")).andReturn()
                .getResponse().getStatus()).isEqualTo(400);
    }

    // ------------------------------------------------------------------
    // 发布
    // ------------------------------------------------------------------

    @Test
    @DisplayName("3. 受支持分类完整提交：详情逐项展示卖家声明，含「存在问题」的说明")
    void completeDisclosure() throws Exception {
        String token = register();
        List<Map<String, Object>> items = InspectionFixtures.fullDisclosure("数码电子");
        items.get(1).put("condition", "DEFECT");
        items.get(1).put("note", "左上角一处坏点");
        items.get(2).put("condition", "NOT_TESTED");
        String id = publishOk(token, "数码电子", items);

        JsonNode inspection = data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection");
        assertThat(inspection.path("title").asText()).isEqualTo("数码电子验货清单");
        assertThat(inspection.path("version").asInt()).isEqualTo(1);
        JsonNode screen = find(inspection.path("items"), "SCREEN");
        assertThat(screen.path("condition").asText()).isEqualTo("DEFECT");
        assertThat(screen.path("note").asText()).isEqualTo("左上角一处坏点");
        assertThat(find(inspection.path("items"), "BATTERY").path("condition").asText()).isEqualTo("NOT_TESTED");
    }

    @Test
    @DisplayName("4. 缺必填项 400，且商品不落库；服务端不会替卖家默认「正常」")
    void missingRequiredItemIsRejected() throws Exception {
        String token = register();
        String title = tag();
        List<Map<String, Object>> items = InspectionFixtures.fullDisclosure("数码电子");
        items.removeIf(i -> "SCREEN".equals(i.get("itemCode")));
        assertThat(status(publish(token, title, "数码电子", items))).isEqualTo(400);

        // 条目存在但没给状态，也不能被默认成 NORMAL
        List<Map<String, Object>> blank = InspectionFixtures.fullDisclosure("数码电子");
        blank.get(0).remove("condition");
        assertThat(status(publish(token, title, "数码电子", blank))).isEqualTo(400);

        // 完全不提交清单
        assertThat(status(publish(token, title, "数码电子", null))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title=?", Integer.class, title)).isZero();
    }

    @Test
    @DisplayName("5. 未知条目、重复条目、未知状态、超长说明、HTML 说明一律 400")
    void invalidItemsAreRejected() throws Exception {
        String token = register();
        List<List<Map<String, Object>>> bad = new ArrayList<>();

        List<Map<String, Object>> unknown = InspectionFixtures.fullDisclosure("数码电子");
        unknown.add(item("PAGES_COMPLETE", "NORMAL", null));
        bad.add(unknown);

        List<Map<String, Object>> duplicate = InspectionFixtures.fullDisclosure("数码电子");
        duplicate.add(item("SCREEN", "NORMAL", null));
        bad.add(duplicate);

        List<Map<String, Object>> badCondition = InspectionFixtures.fullDisclosure("数码电子");
        badCondition.get(0).put("condition", "GOOD");
        bad.add(badCondition);

        List<Map<String, Object>> longNote = InspectionFixtures.fullDisclosure("数码电子");
        longNote.get(0).put("note", "长".repeat(201));
        bad.add(longNote);

        List<Map<String, Object>> html = InspectionFixtures.fullDisclosure("数码电子");
        html.get(0).put("note", "<img src=x onerror=alert(1)>");
        bad.add(html);

        for (List<Map<String, Object>> items : bad) {
            assertThat(status(publish(token, tag(), "数码电子", items))).isEqualTo(400);
        }
    }

    @Test
    @DisplayName("6. 可选条目可以不声明，详情中显示为「未声明」(null)")
    void optionalItemsMayBeOmitted() throws Exception {
        String token = register();
        List<Map<String, Object>> items = InspectionFixtures.fullDisclosure("数码电子");
        items.removeIf(i -> "ACCESSORIES".equals(i.get("itemCode")));   // 可选项
        String id = publishOk(token, "数码电子", items);
        JsonNode accessories = find(data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn())
                .path("inspection").path("items"), "ACCESSORIES");
        assertThat(accessories.path("condition").isNull()).isTrue();
    }

    @Test
    @DisplayName("7. 不支持的分类：无清单可发布；提交清单反而 400")
    void unsupportedCategoryPublishing() throws Exception {
        String token = register();
        String id = publishOk(token, "其他", null);
        assertThat(data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection").isNull()).isTrue();
        assertThat(status(publish(token, tag(), "其他", InspectionFixtures.fullDisclosure("数码电子")))).isEqualTo(400);
    }

    // ------------------------------------------------------------------
    // 编辑
    // ------------------------------------------------------------------

    @Test
    @DisplayName("8. 切换分类：必须按新分类重新声明，旧分类的声明不会被沿用")
    void categorySwitch() throws Exception {
        String token = register();
        String id = publishOk(token, "数码电子", InspectionFixtures.fullDisclosure("数码电子"));

        assertThat(status(patchProduct(token, id, Map.of("category", "教材书籍"))))
                .as("换分类却不重新声明").isEqualTo(400);
        assertThat(status(patchProduct(token, id, Map.of("category", "教材书籍",
                "inspection", InspectionFixtures.fullDisclosure("数码电子"))))).as("用旧分类的条目").isEqualTo(400);

        assertThat(status(patchProduct(token, id, Map.of("category", "教材书籍",
                "inspection", InspectionFixtures.fullDisclosure("教材书籍"))))).isEqualTo(200);
        JsonNode inspection = data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection");
        assertThat(inspection.path("title").asText()).isEqualTo("教材书籍验货清单");
        assertThat(codes(inspection.path("items"))).doesNotContain("SCREEN", "POWER_ON");

        // 切到不支持的分类：声明被清空
        assertThat(status(patchProduct(token, id, Map.of("category", "其他")))).isEqualTo(200);
        assertThat(data(mockMvc.perform(get("/v1/products/" + id).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection").isNull()).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_inspection_disclosures WHERE product_id=?::uuid",
                Integer.class, id)).isZero();
    }

    @Test
    @DisplayName("9. 分类不变：提交清单则整体替换，不提交则保留")
    void sameCategoryEdits() throws Exception {
        String token = register();
        String id = publishOk(token, "生活用品", InspectionFixtures.fullDisclosure("生活用品"));

        assertThat(status(patchProduct(token, id, Map.of("title", "只改标题")))).isEqualTo(200);
        assertThat(find(inspectionItems(id), "CLEAN").path("condition").asText()).isEqualTo("NORMAL");

        assertThat(status(patchProduct(token, id, Map.of("inspection",
                InspectionFixtures.disclosure("生活用品", "DEFECT"))))).isEqualTo(200);
        assertThat(find(inspectionItems(id), "CLEAN").path("condition").asText()).isEqualTo("DEFECT");
    }

    @Test
    @DisplayName("10. 旧商品（V5 前发布、无声明）照常展示与编辑，不被猜成「全部正常」")
    void legacyProductCompatibility() throws Exception {
        String token = register();
        String sellerId = me(token);
        UUID legacy = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) VALUES (?,?::uuid,?,?,?,?,?,?)",
                legacy, sellerId, "旧商品", "d", BigDecimal.TEN, "数码电子", "全新", "东校区");

        assertThat(data(mockMvc.perform(get("/v1/products/" + legacy).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection").isNull()).isTrue();
        assertThat(status(patchProduct(token, legacy.toString(), Map.of("title", "旧商品改名")))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_inspection_disclosures WHERE product_id=?",
                Integer.class, legacy)).as("编辑不会顺手补一份伪造的声明").isZero();
    }

    @Test
    @DisplayName("11. 服务端字段一律拒绝：顶层与条目内的 sellerId/productId/templateVersion 等；错误带 requestId 且不回显值")
    void serverFieldsAreRejected() throws Exception {
        String token = register();
        for (String field : List.of("sellerId", "productId", "templateVersion", "inspectionStatus",
                "checkedAt", "buyerResult", "orderId")) {
            Map<String, Object> body = productBody(tag(), "其他", null);
            body.put(field, "injected-value-xyz");
            MvcResult r = mockMvc.perform(post("/v1/products").header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body))).andReturn();
            assertThat(status(r)).as(field).isEqualTo(400);
            assertThat(r.getResponse().getContentAsString()).doesNotContain("injected-value-xyz");
            assertThat(objectMapper.readTree(r.getResponse().getContentAsString()).path("requestId").asText()).isNotBlank();
        }
        for (String field : List.of("templateVersion", "productId", "sellerId", "buyerResult", "checkedAt")) {
            List<Map<String, Object>> items = InspectionFixtures.fullDisclosure("数码电子");
            items.get(0).put(field, "injected-value-xyz");
            MvcResult r = publish(token, tag(), "数码电子", items);
            assertThat(status(r)).as("条目内 %s", field).isEqualTo(400);
            assertThat(r.getResponse().getContentAsString()).doesNotContain("injected-value-xyz");
        }
    }

    // ==================================================================

    private static String tag() { return "pi" + UUID.randomUUID().toString().replace("-", "").substring(0, 10); }

    private static Map<String, Object> item(String code, String condition, String note) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("itemCode", code);
        m.put("condition", condition);
        if (note != null) m.put("note", note);
        return m;
    }

    private JsonNode data(MvcResult r) throws Exception {
        return objectMapper.readTree(r.getResponse().getContentAsString()).path("data");
    }

    private static int status(MvcResult r) { return r.getResponse().getStatus(); }

    private static List<String> fields(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private static JsonNode find(JsonNode items, String code) {
        for (JsonNode item : items) if (code.equals(item.path("code").asText())) return item;
        throw new AssertionError("缺少条目 " + code);
    }

    private static List<String> codes(JsonNode items) {
        List<String> codes = new ArrayList<>();
        items.forEach(i -> codes.add(i.path("code").asText()));
        return codes;
    }

    private JsonNode inspectionItems(String productId) throws Exception {
        return data(mockMvc.perform(get("/v1/products/" + productId).header("Authorization", "Bearer " + viewerToken())).andReturn()).path("inspection").path("items");
    }

    /** 6.1A：商品读取需要登录；用一位同校的查看者读取详情 */
    private String viewer;
    private String viewerToken() throws Exception {
        if (viewer == null) viewer = register();
        return viewer;
    }

    private String register() throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "pi" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "声明");
        b.put("campus", "东校区");
        b.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(b))).andReturn();
        return data(r).path("accessToken").asText();
    }

    private String me(String token) throws Exception {
        return data(mockMvc.perform(get("/v1/auth/me").header("Authorization", "Bearer " + token)).andReturn())
                .path("id").asText();
    }

    private Map<String, Object> productBody(String title, String category, List<Map<String, Object>> inspection) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", title);
        b.put("description", "声明测试");
        b.put("price", 10);
        b.put("category", category);
        b.put("condition", "全新");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        if (inspection != null) b.put("inspection", inspection);
        return b;
    }

    private MvcResult publish(String token, String title, String category, List<Map<String, Object>> inspection) throws Exception {
        return mockMvc.perform(post("/v1/products").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(productBody(title, category, inspection)))).andReturn();
    }

    private String publishOk(String token, String category, List<Map<String, Object>> inspection) throws Exception {
        MvcResult r = publish(token, tag(), category, inspection);
        assertThat(status(r)).as("发布失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r).path("id").asText();
    }

    private MvcResult patchProduct(String token, String id, Map<String, Object> body) throws Exception {
        return mockMvc.perform(patch("/v1/products/" + id).header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body))).andReturn();
    }
}
