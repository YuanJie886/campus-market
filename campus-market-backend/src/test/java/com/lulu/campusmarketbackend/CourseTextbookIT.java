package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.demand.DemandFingerprint;
import com.lulu.campusmarketbackend.support.InspectionFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 模块 4：课程教材图谱的查询、学校隔离、商品关联、精确版本需求雷达与教材建议。
 * 全部在真实 PostgreSQL 16 上运行；演示目录来自 V6 迁移。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        // 每日建议上限压到 3，便于验证限流与「重复提交不计数」
        "campus-market.rate-limit.textbook-suggestion.limit=3",
        "campus-market.rate-limit.textbook-suggestion.window-seconds=86400",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CourseTextbookIT {

    private static final String PASSWORD = "test-password-2026";
    private static final String CALCULUS = "demo-calculus-1";
    private static final String CALCULUS_2026 = "demo-calculus-1-2026a";
    private static final String CALCULUS_8 = "demo-calculus-8";
    private static final String CALCULUS_7 = "demo-calculus-7";
    /** 4.8 之前演示第 8 版用的是 979-0（乐谱号 ISMN）号段；V7 起演示教材一律「无 ISBN」。 */
    private static final String FORMER_DEMO_ISMN = "9790000001022";
    /** 测试自己插入的本校教材版本（非演示数据），用于 ISBN 精确查询。 */
    private static final String TEST_ISBN_EDITION = "isbn10-book";
    private static final String TEST_ISBN = "9780804429573";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_textbook")
            .withUsername("campus_tb").withPassword("campus_tb_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "course-textbook-it-secret-0123456789ab");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    // ==================================================================
    // 4.3 课程与教材查询
    // ==================================================================

    @Nested
    @DisplayName("4.3 课程与教材查询")
    class Queries {

        @Test
        @DisplayName("1. 课程列表：需要登录；名称子串 / 课程代码前缀 / 学期 / 校区筛选 / 分页；% 是字面字符；非法学期 400 带 requestId")
        void courseSearch() throws Exception {
            assertThat(status(mockMvc.perform(get("/v1/courses")).andReturn())).isEqualTo(401);
            User u = register();
            JsonNode all = data(perform(get("/v1/courses"), u));
            assertThat(all.path("total").asLong()).isEqualTo(5);
            for (JsonNode c : all.path("items")) assertThat(c.path("isDemo").asBoolean()).as("演示目录如实标记").isTrue();

            assertThat(ids(data(perform(get("/v1/courses?q=线性"), u)))).containsExactly("demo-linear-algebra");
            assertThat(ids(data(perform(get("/v1/courses?q=demo-ma"), u)))).containsExactlyInAnyOrder(CALCULUS, "demo-linear-algebra");
            assertThat(ids(data(perform(get("/v1/courses?term=SPRING"), u)))).containsExactly(CALCULUS);
            assertThat(ids(data(perform(get("/v1/courses?campus=西校区"), u)))).containsExactly("demo-linear-algebra");
            assertThat(data(perform(get("/v1/courses?q=%25"), u)).path("total").asLong()).as("% 不是通配符").isZero();
            JsonNode paged = data(perform(get("/v1/courses?page=2&pageSize=2"), u));
            assertThat(paged.path("items")).hasSize(2);
            assertThat(paged.path("total").asLong()).isEqualTo(5);

            MvcResult bad = perform(get("/v1/courses?term=FALL"), u);
            assertThat(status(bad)).isEqualTo(400);
            assertThat(json.readTree(bad.getResponse().getContentAsString()).path("requestId").asText()).isNotBlank();
        }

        @Test
        @DisplayName("2. 课程详情：开课按学期倒序；只含 VERIFIED 教材（PENDING / REJECTED 不出现）；在售数量只计在售")
        void courseDetail() throws Exception {
            User seller = register();
            User viewer = register();
            String onSale = publishBook(seller, CALCULUS_8, "在售的第 8 版");
            String sold = publishBook(seller, CALCULUS_8, "已售出的第 8 版");
            perform(json(post("/v1/products/" + sold + "/status"), Map.of("status", "已售出")), seller);
            long before = onSaleCount(viewer, CALCULUS_2026, CALCULUS_8);

            // 直接写入一条 PENDING 与一条 REJECTED 关系：都不能进入公开目录
            jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) "
                    + "VALUES (?, 'demo-programming-2', 'pilot', 'RECOMMENDED', 'PENDING')", CALCULUS_2026);
            jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) "
                    + "VALUES (?, 'demo-physics-5', 'pilot', 'REFERENCE', 'REJECTED')", CALCULUS_2026);
            try {
                JsonNode course = data(perform(get("/v1/courses/" + CALCULUS), viewer));
                JsonNode offerings = course.path("offerings");
                assertThat(offerings).hasSize(2);
                assertThat(offerings.get(0).path("id").asText()).isEqualTo(CALCULUS_2026);
                List<String> editions = new ArrayList<>();
                for (JsonNode t : offerings.get(0).path("textbooks")) editions.add(t.path("edition").path("id").asText());
                assertThat(editions).as("必修在前、参考在后；PENDING / REJECTED 不出现").containsExactly(CALCULUS_8, CALCULUS_7);
                assertThat(offerings.get(0).path("textbooks").get(0).path("usageType").asText()).isEqualTo("REQUIRED");
                assertThat(before).as("已售出不计入在售数量").isGreaterThanOrEqualTo(1);
                assertThat(onSaleCount(viewer, CALCULUS_2026, CALCULUS_8)).isEqualTo(before);
                assertNoPrivateFields(course);

                JsonNode offering = data(perform(get("/v1/course-offerings/" + CALCULUS_2026), viewer));
                assertThat(offering.path("course").path("id").asText()).isEqualTo(CALCULUS);
                assertThat(offering.path("textbooks")).hasSize(2);
            } finally {
                jdbc.update("DELETE FROM course_textbooks WHERE course_offering_id=? AND verification_status <> 'VERIFIED'", CALCULUS_2026);
            }
            assertThat(onSale).isNotBlank();
        }

        @Test
        @DisplayName("3. 学校隔离：他校的课程 / 开课 / 教材 / ISBN 一律 404；他校用户也看不到本校目录")
        void schoolIsolation() throws Exception {
            ensureOtherSchool();
            jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name,is_demo) VALUES ('other-course','other-school','他校课程','他校课程',true) ON CONFLICT DO NOTHING");
            jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('other-offering','other-course','other-school','2026-2027','AUTUMN') ON CONFLICT DO NOTHING");
            jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label) "
                    + "VALUES ('other-edition','other-school','9780306406157','9780306406157','他校教材',ARRAY['a'],'p','第 1 版') ON CONFLICT DO NOTHING");

            User pilot = register();
            assertThat(status(perform(get("/v1/courses/other-course"), pilot))).isEqualTo(404);
            assertThat(status(perform(get("/v1/course-offerings/other-offering"), pilot))).isEqualTo(404);
            assertThat(status(perform(get("/v1/textbooks/other-edition"), pilot))).isEqualTo(404);
            assertThat(status(perform(get("/v1/textbooks/isbn/9780306406157"), pilot))).isEqualTo(404);
            assertThat(ids(data(perform(get("/v1/courses?pageSize=50"), pilot)))).doesNotContain("other-course");

            User other = registerOtherSchool();
            assertThat(ids(data(perform(get("/v1/courses"), other)))).containsExactly("other-course");
            assertThat(status(perform(get("/v1/courses/" + CALCULUS), other))).isEqualTo(404);
            assertThat(status(perform(get("/v1/textbooks/" + CALCULUS_8), other))).isEqualTo(404);
            ensureTestIsbnEdition();
            assertThat(status(perform(get("/v1/textbooks/isbn/" + TEST_ISBN), other))).isEqualTo(404);
        }

        @Test
        @DisplayName("4. 教材详情：关联课程；精确版本与其他版本的在售商品分两组返回、互不混排；只列在售")
        void textbookDetailSeparatesEditions() throws Exception {
            User seller = register();
            User viewer = register();
            String exact = publishBook(seller, CALCULUS_8, "精确第 8 版");
            String older = publishBook(seller, CALCULUS_7, "旧的第 7 版");
            String plain = publishBook(seller, null, "微积分教程（演示） 第 8 版 但未关联目录");
            String hidden = publishBook(seller, CALCULUS_8, "下架的第 8 版");
            perform(json(post("/v1/products/" + hidden + "/status"), Map.of("status", "已下架")), seller);

            JsonNode detail = data(perform(get("/v1/textbooks/" + CALCULUS_8), viewer));
            assertThat(detail.path("isbn").isNull()).as("4.8：演示教材没有 ISBN，不再把 ISMN 当书号").isTrue();
            assertThat(detail.toString()).doesNotContain(FORMER_DEMO_ISMN);
            assertThat(detail.path("editionLabel").asText()).isEqualTo("第 8 版");
            Set<String> courses = new HashSet<>();
            for (JsonNode c : detail.path("courses")) courses.add(c.path("courseId").asText() + "/" + c.path("usageType").asText());
            assertThat(courses).contains(CALCULUS + "/REQUIRED");

            List<String> exactIds = productIds(detail.path("listings"));
            List<String> otherIds = productIds(detail.path("otherEditionListings"));
            assertThat(exactIds).contains(exact).doesNotContain(older, plain, hidden);
            assertThat(otherIds).contains(older).doesNotContain(exact, plain);
            for (JsonNode item : detail.path("listings")) {
                assertThat(item.path("textbook").path("editionId").asText()).isEqualTo(CALCULUS_8);
                assertThat(item.path("status").asText()).isEqualTo("在售");
            }
            assertThat(detail.path("otherEditions").get(0).path("id").asText()).isEqualTo(CALCULUS_7);
            assertThat(detail.path("listingSort").asText()).as("没有宿舍楼时按最新").isEqualTo("latest");
            assertNoPrivateFields(detail);
        }

        @Test
        @DisplayName("5. 精确版本商品流沿用楼栋距离排序：设置宿舍楼后同楼栋的在售商品排在最前")
        void exactListingUsesBuildingSort() throws Exception {
            User near = register();
            User far = register();
            String farId = publishBook(far, CALCULUS_8, "远处的第 8 版", "west-zhuyuan-1", "西校区");
            String nearId = publishBook(near, CALCULUS_8, "同楼的第 8 版", "east-qinyuan-1", "东校区");
            User viewer = register();
            assertThat(status(perform(json(patch("/v1/auth/me"), Map.of("dormBuildingId", "east-qinyuan-1")), viewer))).isEqualTo(200);
            JsonNode detail = data(perform(get("/v1/textbooks/" + CALCULUS_8), viewer));
            assertThat(detail.path("listingSort").asText()).isEqualTo("nearest");
            List<String> order = productIds(detail.path("listings"));
            assertThat(order.indexOf(nearId)).isLessThan(order.indexOf(farId));
            assertThat(detail.path("listings").get(0).path("sameBuilding").asBoolean()).isTrue();
        }

        @Test
        @DisplayName("6. ISBN 精确查询：接受空格与连字符；校验位错误 400；979-0（ISMN）400；本校目录没有 404；ISBN-10 自动转换")
        void isbnLookup() throws Exception {
            User u = register();
            ensureTestIsbnEdition();
            assertThat(data(perform(get("/v1/textbooks/isbn/978-0-8044-2957-3"), u)).path("id").asText()).isEqualTo(TEST_ISBN_EDITION);
            MvcResult bad = perform(get("/v1/textbooks/isbn/9780804429574"), u);
            assertThat(status(bad)).isEqualTo(400);
            assertThat(bad.getResponse().getContentAsString()).contains("校验位").contains("requestId");
            MvcResult ismn = perform(get("/v1/textbooks/isbn/979-0-000001-02-2"), u);
            assertThat(status(ismn)).as("4.8：旧演示号码是 ISMN，不是图书 ISBN").isEqualTo(400);
            assertThat(ismn.getResponse().getContentAsString()).contains("乐谱号").contains("requestId");
            assertThat(status(perform(get("/v1/textbooks/isbn/9780000000019"), u))).isEqualTo(404);

            JsonNode byTen = data(perform(get("/v1/textbooks/isbn/0-8044-2957-x"), u));
            assertThat(byTen.path("id").asText()).isEqualTo(TEST_ISBN_EDITION);
            assertThat(byTen.path("isbn").asText()).isEqualTo(TEST_ISBN);
        }
    }

    // ==================================================================
    // 4.5 商品发布与编辑
    // ==================================================================

    @Nested
    @DisplayName("4.5 商品与教材版本")
    class Products {

        @Test
        @DisplayName("7. 关联教材：详情与列表都带具体版本（ISBN、版次、出版社、关联课程）；非教材分类 400；他校版本 404")
        void publishWithEdition() throws Exception {
            User seller = register();
            String id = publishBook(seller, CALCULUS_8, "关联了版本的教材");
            JsonNode tb = data(perform(get("/v1/products/" + id), seller)).path("textbook");
            assertThat(tb.path("editionId").asText()).isEqualTo(CALCULUS_8);
            assertThat(tb.path("isbn").isNull()).as("4.8：演示教材没有 ISBN").isTrue();
            assertThat(tb.path("editionLabel").asText()).isEqualTo("第 8 版");
            assertThat(tb.path("publisher").asText()).isEqualTo("演示大学出版社");
            assertThat(tb.path("courseNames").toString()).contains("演示课程·微积分（一）");

            JsonNode listed = null;
            for (JsonNode p : data(perform(get("/v1/products?keyword=关联了版本的教材"), seller)).path("items")) {
                if (id.equals(p.path("id").asText())) listed = p;
            }
            assertThat(listed).isNotNull();
            assertThat(listed.path("textbook").path("editionId").asText()).as("商品卡片同一次请求带版本").isEqualTo(CALCULUS_8);

            Map<String, Object> digital = product("数码电子", "装了教材的数码产品", null);
            digital.put("textbookEditionId", CALCULUS_8);
            assertThat(status(perform(json(post("/v1/products"), digital), seller))).isEqualTo(400);

            ensureOtherSchool();
            jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label) "
                    + "VALUES ('other-edition','other-school','9780306406157','9780306406157','他校教材',ARRAY['a'],'p','第 1 版') ON CONFLICT DO NOTHING");
            Map<String, Object> foreign = product("教材书籍", "他校版本", "other-edition");
            assertThat(status(perform(json(post("/v1/products"), foreign), seller))).isEqualTo(404);
        }

        @Test
        @DisplayName("8. 白名单：schoolId / isbnSnapshot / titleSnapshot / verificationStatus / sellerId 一律 400，带 requestId、不回显请求体")
        void unknownFieldsRejected() throws Exception {
            User seller = register();
            for (String field : List.of("schoolId", "isbnSnapshot", "titleSnapshot", "verificationStatus", "sellerId", "textbookEdition")) {
                Map<String, Object> b = product("教材书籍", "白名单 " + field, CALCULUS_8);
                b.put(field, "evil-value-" + field);
                MvcResult r = perform(json(post("/v1/products"), b), seller);
                assertThat(status(r)).as(field).isEqualTo(400);
                String body = r.getResponse().getContentAsString();
                assertThat(json.readTree(body).path("requestId").asText()).isNotBlank();
                assertThat(body).doesNotContain("evil-value-");
            }
        }

        @Test
        @DisplayName("9. 编辑：换版本则快照整体替换；重复提交同一版本不改写快照；切离教材分类自动解除关联；订单验货快照不变")
        void editKeepsSnapshotsHonest() throws Exception {
            User seller = register();
            String id = publishBook(seller, CALCULUS_8, "会被编辑的教材");
            Map<String, Object> first = jdbc.queryForMap("SELECT * FROM product_textbook_details WHERE product_id=?::uuid", id);

            // 下单生成验货快照，再取消，之后卖家才能编辑
            User buyer = register();
            MvcResult order = createOrder(buyer, id);
            assertThat(status(order)).isEqualTo(200);
            String orderId = data(order).path("id").asText();
            List<Map<String, Object>> inspectionBefore = jdbc.queryForList(
                    "SELECT * FROM order_inspection_items WHERE order_id=?::uuid ORDER BY item_code", orderId);
            perform(json(post("/v1/orders/" + orderId + "/transitions"), Map.of("to", "CANCELLED")), buyer);

            assertThat(status(perform(json(patch("/v1/products/" + id), Map.of("textbookEditionId", CALCULUS_8, "title", "会被编辑的教材 v2")), seller))).isEqualTo(200);
            assertThat(jdbc.queryForMap("SELECT * FROM product_textbook_details WHERE product_id=?::uuid", id))
                    .as("版本未变：快照与更新时间都不变").isEqualTo(first);

            assertThat(status(perform(json(patch("/v1/products/" + id), Map.of("textbookEditionId", CALCULUS_7)), seller))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT edition_snapshot FROM product_textbook_details WHERE product_id=?::uuid", String.class, id))
                    .isEqualTo("第 7 版");

            Map<String, Object> toDigital = new LinkedHashMap<>();
            toDigital.put("category", "数码电子");
            toDigital.put("inspection", InspectionFixtures.fullDisclosure("数码电子"));
            assertThat(status(perform(json(patch("/v1/products/" + id), toDigital), seller))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM product_textbook_details WHERE product_id=?::uuid", Long.class, id)).isZero();
            assertThat(data(perform(get("/v1/products/" + id), seller)).path("textbook").isNull()).isTrue();

            assertThat(jdbc.queryForList("SELECT * FROM order_inspection_items WHERE order_id=?::uuid ORDER BY item_code", orderId))
                    .as("已生成订单的验货快照不受商品编辑影响").isEqualTo(inspectionBefore);
        }

        @Test
        @DisplayName("10. 旧商品（没有关联）照常展示与交易，textbook 为 null；显式传 null 解除关联")
        void legacyProductsStayUnlinked() throws Exception {
            User seller = register();
            String legacy = publishBook(seller, null, "旧的教材商品");
            assertThat(data(perform(get("/v1/products/" + legacy), seller)).path("textbook").isNull()).isTrue();
            String linked = publishBook(seller, CALCULUS_8, "将被解除关联");
            Map<String, Object> unlink = new LinkedHashMap<>();
            unlink.put("textbookEditionId", null);
            assertThat(status(perform(json(patch("/v1/products/" + linked), unlink), seller))).isEqualTo(200);
            assertThat(data(perform(get("/v1/products/" + linked), seller)).path("textbook").isNull()).isTrue();
        }
    }

    // ==================================================================
    // 4.6 精确教材版本订阅
    // ==================================================================

    @Nested
    @DisplayName("4.6 需求雷达精确教材订阅")
    class Radar {

        @Test
        @DisplayName("11. 创建：分类自动为教材书籍、不带关键词；相同条件幂等；同版本不同条件 409；关键词 / 他类 400；他校与不存在 404；PATCH 不能改版本")
        void createTextbookSubscription() throws Exception {
            User buyer = register();
            MvcResult created = subscribe(buyer, Map.of("textbookEditionId", CALCULUS_8));
            assertThat(status(created)).isEqualTo(200);
            JsonNode sub = data(created).path("subscription");
            assertThat(data(created).path("outcome").asText()).isEqualTo("CREATED");
            assertThat(sub.path("category").asText()).isEqualTo("教材书籍");
            assertThat(sub.path("keyword").isNull()).isTrue();
            assertThat(sub.path("textbook").path("id").asText()).isEqualTo(CALCULUS_8);
            assertThat(sub.path("textbook").path("isbn").isNull()).isTrue();

            assertThat(data(subscribe(buyer, Map.of("textbookEditionId", CALCULUS_8))).path("outcome").asText()).isEqualTo("EXISTING");
            assertThat(status(subscribe(buyer, Map.of("textbookEditionId", CALCULUS_8, "maxPrice", 30)))).isEqualTo(409);
            assertThat(status(subscribe(buyer, Map.of("textbookEditionId", CALCULUS_7, "keyword", "微积分")))).isEqualTo(400);
            assertThat(status(subscribe(buyer, Map.of("textbookEditionId", CALCULUS_7, "category", "数码电子")))).isEqualTo(400);
            assertThat(status(subscribe(buyer, Map.of("textbookEditionId", "no-such-edition")))).isEqualTo(404);
            ensureOtherSchool();
            jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label) "
                    + "VALUES ('other-edition','other-school','9780306406157','9780306406157','他校教材',ARRAY['a'],'p','第 1 版') ON CONFLICT DO NOTHING");
            assertThat(status(subscribe(buyer, Map.of("textbookEditionId", "other-edition")))).isEqualTo(404);
            assertThat(status(perform(json(patch("/v1/demand-subscriptions/" + sub.path("id").asText()),
                    Map.of("textbookEditionId", CALCULUS_7)), buyer))).isEqualTo(400);
            // 修改范围 / 预算仍然可以
            assertThat(status(perform(json(patch("/v1/demand-subscriptions/" + sub.path("id").asText()),
                    Map.of("maxPrice", 40)), buyer))).isEqualTo(200);
        }

        @Test
        @DisplayName("12. 匹配：只命中关联了同一版本的商品（TEXTBOOK_EXACT 为首位理由，服务端给档位）；相似书名、其他版本、卖家自己都不命中")
        void exactEditionMatching() throws Exception {
            User buyer = register();
            subscribe(buyer, Map.of("textbookEditionId", CALCULUS_8));
            User seller = register();
            String exact = publishBook(seller, CALCULUS_8, "雷达精确版本");
            String sameTitle = publishBook(seller, null, "微积分教程（演示） 第 8 版");
            String other = publishBook(seller, CALCULUS_7, "雷达第 7 版");

            JsonNode inbox = data(perform(get("/v1/demand-matches"), buyer)).path("items");
            List<String> matched = new ArrayList<>();
            for (JsonNode m : inbox) matched.add(m.path("product").path("id").asText());
            assertThat(matched).contains(exact).doesNotContain(sameTitle, other);
            JsonNode match = find(inbox, exact);
            assertThat(match.path("reasonCodes").get(0).asText()).isEqualTo("TEXTBOOK_EXACT");
            assertThat(match.path("score").asInt()).isBetween(1, 100);
            assertThat(match.path("tier").asText()).isEqualTo("HIGH");
            assertThat(match.path("subscription").path("textbook").path("id").asText()).isEqualTo(CALCULUS_8);

            // 卖家自己的教材订阅不命中自己的商品
            subscribe(seller, Map.of("textbookEditionId", CALCULUS_8));
            publishBook(seller, CALCULUS_8, "卖家自己的第 8 版");
            assertThat(data(perform(get("/v1/demand-matches"), seller)).path("items")).isEmpty();
        }

        @Test
        @DisplayName("13. 编辑：解除关联后匹配失效；恢复关联后同一条匹配恢复（不重复插入）")
        void unlinkAndRelink() throws Exception {
            User buyer = register();
            subscribe(buyer, Map.of("textbookEditionId", "demo-physics-5"));
            User seller = register();
            String id = publishBook(seller, "demo-physics-5", "物理第 5 版");
            JsonNode first = find(data(perform(get("/v1/demand-matches"), buyer)).path("items"), id);
            assertThat(first.path("valid").asBoolean()).isTrue();

            Map<String, Object> unlink = new LinkedHashMap<>();
            unlink.put("textbookEditionId", null);
            perform(json(patch("/v1/products/" + id), unlink), seller);
            JsonNode invalid = find(data(perform(get("/v1/demand-matches"), buyer)).path("items"), id);
            assertThat(invalid.path("valid").asBoolean()).isFalse();
            assertThat(invalid.path("invalidReason").asText()).isEqualTo("NO_LONGER_MATCHES");

            perform(json(patch("/v1/products/" + id), Map.of("textbookEditionId", "demo-physics-5")), seller);
            JsonNode restored = find(data(perform(get("/v1/demand-matches"), buyer)).path("items"), id);
            assertThat(restored.path("valid").asBoolean()).isTrue();
            assertThat(restored.path("id").asText()).as("同一条匹配恢复").isEqualTo(first.path("id").asText());
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid", Long.class, id)).isEqualTo(1);
        }

        @Test
        @DisplayName("14. 兼容：普通关键词订阅行为与指纹不变（关键词命中仍是 KEYWORD_*，不会得到 TEXTBOOK_EXACT）")
        void keywordSubscriptionsUnchanged() throws Exception {
            User buyer = register();
            String keyword = "兼容" + UUID.randomUUID().toString().substring(0, 6);
            MvcResult created = subscribe(buyer, Map.of("keyword", keyword, "category", "教材书籍"));
            String subId = data(created).path("subscription").path("id").asText();
            String fingerprint = jdbc.queryForObject("SELECT fingerprint FROM demand_subscriptions WHERE id=?::uuid", String.class, subId);
            assertThat(fingerprint).as("无教材版本时指纹算法与 V4 时代逐字节相同")
                    .isEqualTo(DemandFingerprint.of(keyword, "教材书籍", null, null, "SCHOOL", null, null, null));

            User seller = register();
            String linked = publishBook(seller, CALCULUS_8, keyword + " 关联版本的教材");
            JsonNode match = find(data(perform(get("/v1/demand-matches"), buyer)).path("items"), linked);
            assertThat(match.path("reasonCodes").toString()).contains("KEYWORD_TITLE").contains("CATEGORY").doesNotContain("TEXTBOOK_EXACT");
        }

        @Test
        @DisplayName("15. 并发：8 个请求同时订阅同一版本（相同条件）只产生 1 条；不同条件同一版本也只有 1 条启用")
        void concurrentTextbookSubscriptions() throws Exception {
            User buyer = register();
            List<Integer> statuses = concurrently(8, i -> subscribe(buyer, Map.of("textbookEditionId", "demo-linear-algebra-3")));
            assertThat(statuses).containsOnly(200);
            User other = register();
            List<Integer> mixed = concurrently(8, i -> subscribe(other, Map.of("textbookEditionId", "demo-linear-algebra-3", "maxPrice", 10 + i)));
            assertThat(mixed.stream().filter(s -> s == 200)).hasSize(1);
            assertThat(mixed.stream().filter(s -> s == 409)).hasSize(7);
            for (User u : List.of(buyer, other)) {
                assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE user_id=?::uuid AND active "
                        + "AND textbook_edition_id='demo-linear-algebra-3'", Long.class, u.id())).isEqualTo(1);
            }
        }
    }

    // ==================================================================
    // 4.4 教材建议
    // ==================================================================

    @Nested
    @DisplayName("4.4 教材建议")
    class Suggestions {

        @Test
        @DisplayName("16. 默认 PENDING；只有本人可见与撤回；不进入公开课程页；撤回幂等；投影不含提交人")
        void pendingAndPrivate() throws Exception {
            User author = register();
            Map<String, Object> body = Map.of("courseOfferingId", "demo-programming-2026a", "textbookEditionId", "demo-linear-algebra-3",
                    "usageType", "REFERENCE", "note", "老师课上提过");
            MvcResult created = suggest(author, body);
            assertThat(status(created)).isEqualTo(200);
            JsonNode s = data(created).path("suggestion");
            assertThat(s.path("status").asText()).isEqualTo("PENDING");
            assertThat(s.has("submitterId")).isFalse();
            assertThat(data(created).toString()).doesNotContain(author.id());

            User stranger = register();
            JsonNode course = data(perform(get("/v1/courses/demo-programming"), stranger));
            assertThat(course.toString()).as("建议不出现在公开课程页").doesNotContain("demo-linear-algebra-3").doesNotContain("老师课上提过");
            assertThat(data(perform(get("/v1/textbook-suggestions/mine"), stranger))).isEmpty();
            assertThat(status(perform(delete("/v1/textbook-suggestions/" + s.path("id").asText()), stranger))).isEqualTo(404);

            assertThat(data(perform(delete("/v1/textbook-suggestions/" + s.path("id").asText()), author)).path("status").asText()).isEqualTo("WITHDRAWN");
            assertThat(status(perform(delete("/v1/textbook-suggestions/" + s.path("id").asText()), author))).as("撤回幂等").isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM course_textbooks WHERE textbook_edition_id='demo-linear-algebra-3' "
                    + "AND course_offering_id='demo-programming-2026a'", Long.class)).as("永远不会自动变成正式关系").isZero();
        }

        @Test
        @DisplayName("17. 输入：ISBN 已在目录时自动指向该版本；无 ISBN 必须有书名、出版社、版次；校验位 / 尖括号 / 未知字段 400")
        void validation() throws Exception {
            User u = register();
            ensureTestIsbnEdition();
            JsonNode byIsbn = data(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "isbn", "978-0-8044-2957-3")));
            assertThat(byIsbn.path("suggestion").path("textbookEditionId").asText()).isEqualTo(TEST_ISBN_EDITION);
            assertThat(byIsbn.path("suggestion").path("isbn").isNull()).isTrue();
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "isbn", FORMER_DEMO_ISMN)))).as("ISMN 400").isEqualTo(400);

            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a")))).isEqualTo(400);
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "title", "只有书名")))).isEqualTo(400);
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "isbn", "9780306406158")))).isEqualTo(400);
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "title", "<script>", "publisher", "p", "editionLabel", "v")))).isEqualTo(400);
            assertThat(status(suggest(u, Map.of("courseOfferingId", "no-such-offering", "isbn", "9780306406157")))).isEqualTo(404);
            for (String field : List.of("submitterId", "status", "verificationStatus", "schoolId", "createdAt")) {
                Map<String, Object> b = new LinkedHashMap<>(Map.of("courseOfferingId", "demo-physics-1-2026a", "isbn", "9780306406157"));
                b.put(field, "VERIFIED");
                MvcResult r = suggest(u, b);
                assertThat(status(r)).as(field).isEqualTo(400);
                assertThat(r.getResponse().getContentAsString()).contains("requestId");
            }
        }

        @Test
        @DisplayName("18. 幂等与限流：重复提交返回原记录且不计入每日限额；超出限额 429；并发相同建议只产生 1 条")
        void idempotencyAndRateLimit() throws Exception {
            User u = register();
            Map<String, Object> first = Map.of("courseOfferingId", "demo-academic-en-2026a", "isbn", "9780306406157");
            assertThat(data(suggest(u, first)).path("outcome").asText()).isEqualTo("CREATED");
            for (int i = 0; i < 3; i++) assertThat(data(suggest(u, first)).path("outcome").asText()).isEqualTo("EXISTING");
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-academic-en-2026a", "isbn", "9780804429573")))).isEqualTo(200);
            assertThat(status(suggest(u, Map.of("courseOfferingId", "demo-academic-en-2026a", "isbn", "9780000000019")))).isEqualTo(200);
            MvcResult limited = suggest(u, Map.of("courseOfferingId", "demo-physics-1-2026a", "isbn", "9780000000019"));
            assertThat(status(limited)).as("每日 3 条新建议").isEqualTo(429);
            assertThat(status(suggest(u, first))).as("已有的建议仍可幂等读取").isEqualTo(200);

            User racer = register();
            Map<String, Object> same = Map.of("courseOfferingId", "demo-calculus-1-2026a", "isbn", "9780306406157");
            List<Integer> statuses = concurrently(6, i -> suggest(racer, same));
            assertThat(statuses).containsOnly(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_suggestions WHERE submitter_id=?::uuid", Long.class, racer.id())).isEqualTo(1);
        }
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    record User(String id, String token) {}

    @FunctionalInterface
    interface Call { MvcResult run(int i) throws Exception; }

    private List<Integer> concurrently(int n, Call call) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < n; i++) {
                int index = i;
                futures.add(pool.submit(() -> { gate.await(); return status(call.run(index)); }));
            }
            gate.countDown();
            List<Integer> result = new ArrayList<>();
            for (Future<Integer> f : futures) result.add(f.get(60, TimeUnit.SECONDS));
            return result;
        } finally {
            pool.shutdownNow();
        }
    }

    /** 公开目录与商品流中绝不能出现的字段。 */
    private void assertNoPrivateFields(JsonNode node) {
        String raw = node.toString();
        for (String forbidden : List.of("submitter", "subscriber", "waiting", "dormBuildingId", "buyerId", "account", "13800000000")) {
            assertThat(raw).as("不得包含 %s", forbidden).doesNotContain(forbidden);
        }
    }

    private long onSaleCount(User viewer, String offeringId, String editionId) throws Exception {
        for (JsonNode t : data(perform(get("/v1/course-offerings/" + offeringId), viewer)).path("textbooks")) {
            if (editionId.equals(t.path("edition").path("id").asText())) return t.path("edition").path("onSaleCount").asLong();
        }
        throw new AssertionError("开课没有教材 " + editionId);
    }

    private static List<String> ids(JsonNode page) {
        List<String> result = new ArrayList<>();
        for (JsonNode c : page.path("items")) result.add(c.path("id").asText());
        return result;
    }

    private static List<String> productIds(JsonNode items) {
        List<String> result = new ArrayList<>();
        for (JsonNode p : items) result.add(p.path("id").asText());
        return result;
    }

    private static JsonNode find(JsonNode inbox, String productId) {
        for (JsonNode m : inbox) if (productId.equals(m.path("product").path("id").asText())) return m;
        throw new AssertionError("收件箱里没有商品 " + productId);
    }

    /** 本校的一条测试教材（真实格式的 ISBN-10 / 13，不是演示数据）。 */
    private void ensureTestIsbnEdition() {
        jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn10,isbn13,normalized_isbn,title,authors,publisher,edition_label) "
                + "VALUES (?,'pilot','080442957X',?,?,'十位书号教材',ARRAY['a'],'p','第 2 版') ON CONFLICT DO NOTHING",
                TEST_ISBN_EDITION, TEST_ISBN, TEST_ISBN);
    }

    private void ensureOtherSchool() {
        jdbc.update("INSERT INTO schools(id,name) VALUES ('other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('他校区','other-school','他校区') ON CONFLICT DO NOTHING");
    }

    private User register() throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "tb" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", PASSWORD);
        b.put("nickname", "教材");
        b.put("campus", "东校区");
        b.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
        JsonNode d = data(r);
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }

    /** 另一所学校的用户：注册接口只接受试点学校的校区，这里注册后直接改库模拟。 */
    private User registerOtherSchool() throws Exception {
        ensureOtherSchool();
        User u = register();
        jdbc.update("UPDATE users SET campus='他校区' WHERE id=?::uuid", u.id());
        return u;
    }

    private Map<String, Object> product(String category, String title, String editionId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", title);
        b.put("description", "课程教材图谱测试商品");
        b.put("price", 25);
        b.put("category", category);
        b.put("condition", "几乎全新");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        List<Map<String, Object>> inspection = InspectionFixtures.fullDisclosure(category);
        if (inspection != null) b.put("inspection", inspection);
        if (editionId != null) b.put("textbookEditionId", editionId);
        return b;
    }

    private String publishBook(User seller, String editionId, String title) throws Exception {
        return publishBook(seller, editionId, title, null, "东校区");
    }

    private String publishBook(User seller, String editionId, String title, String buildingId, String campus) throws Exception {
        Map<String, Object> b = product("教材书籍", title, editionId);
        b.put("campus", campus);
        if (buildingId != null) b.put("buildingId", buildingId);
        MvcResult r = perform(json(post("/v1/products"), b), seller);
        assertThat(status(r)).as("发布失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r).path("id").asText();
    }

    private MvcResult createOrder(User buyer, String productId) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1)
                .truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return perform(json(post("/v1/orders"), b), buyer);
    }

    private MvcResult subscribe(User u, Map<String, Object> b) throws Exception {
        return perform(json(post("/v1/demand-subscriptions"), b), u);
    }

    private MvcResult suggest(User u, Map<String, Object> b) throws Exception {
        return perform(json(post("/v1/textbook-suggestions"), b), u);
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder builder, Map<String, Object> b) throws Exception {
        return builder.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(b));
    }

    private MvcResult perform(MockHttpServletRequestBuilder builder, User user) throws Exception {
        return mockMvc.perform(builder.header("Authorization", "Bearer " + user.token())).andReturn();
    }

    private JsonNode data(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString()).path("data");
    }

    private static int status(MvcResult r) {
        return r.getResponse().getStatus();
    }

}
