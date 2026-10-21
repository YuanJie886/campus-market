package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.demand.DemandMatchService;
import com.lulu.campusmarketbackend.service.MarketService;
import com.lulu.campusmarketbackend.support.StatementCounter;
import org.apache.ibatis.session.SqlSessionFactory;
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
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * 需求雷达：订阅 API（2.2）、同步匹配（2.3）与收件箱（2.4）。
 *
 * <p>每个用例用专属的随机关键词隔离数据：订阅与商品都带上这个词，
 * 其他用例的商品不会误命中本用例的订阅。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DemandRadarIT {

    private static final String PASSWORD = "test-password-2026";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_demand")
            .withUsername("campus_demand").withPassword("campus_demand_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "demand-radar-it-secret-0123456789abc");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired MarketService market;
    @Autowired DemandMatchService matches;
    @Autowired SqlSessionFactory sessions;
    @Autowired TransactionTemplate transactions;

    // ==================================================================
    // 2.2 订阅 API
    // ==================================================================

    @Nested
    @DisplayName("2.2 订阅 API")
    class SubscriptionApi {

        @Test
        @DisplayName("1. 创建幂等：同条件再建返回原订阅；大小写、全角空格、首尾空白不同也视为同条件")
        void createIsIdempotentAfterNormalization() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            JsonNode first = data(subscribe(buyer, body("keyword", tag + " 台灯", "geoScope", "SCHOOL")));
            assertThat(first.path("outcome").asText()).isEqualTo("CREATED");

            JsonNode again = data(subscribe(buyer, body("keyword", "  " + tag.toUpperCase() + "　台灯 ", "geoScope", "SCHOOL")));
            assertThat(again.path("outcome").asText()).isEqualTo("EXISTING");
            assertThat(again.path("subscription").path("id").asText())
                    .isEqualTo(first.path("subscription").path("id").asText());
            assertThat(activeCount(buyer)).isEqualTo(1);
        }

        @Test
        @DisplayName("2. 身份与指纹字段不可覆盖：userId / schoolId / active / fingerprint 一律 400，且无副作用、不回显")
        void protectedFieldsAreRejected() throws Exception {
            User buyer = register("东校区");
            User victim = register("东校区");
            for (String field : List.of("userId", "schoolId", "active", "fingerprint", "zone", "score")) {
                Map<String, Object> b = body("keyword", tag(), "geoScope", "SCHOOL");
                b.put(field, field.equals("userId") ? victim.id() : "injected-value-xyz");
                MvcResult result = subscribe(buyer, b);
                assertThat(result.getResponse().getStatus()).as("%s 必须被拒绝", field).isEqualTo(400);
                assertThat(result.getResponse().getContentAsString()).doesNotContain("injected-value-xyz");
            }
            assertThat(activeCount(buyer)).as("被拒绝的请求不得留下任何订阅").isZero();
            assertThat(activeCount(victim)).isZero();
        }

        @Test
        @DisplayName("3. 至少要有关键词或分类；价格下限不得高于上限；负价格被拒")
        void conditionValidation() throws Exception {
            User buyer = register("东校区");
            assertThat(status(subscribe(buyer, body("geoScope", "SCHOOL")))).isEqualTo(400);
            assertThat(status(subscribe(buyer, body("keyword", tag(), "minPrice", 100, "maxPrice", 10)))).isEqualTo(400);
            assertThat(status(subscribe(buyer, body("keyword", tag(), "minPrice", -1)))).isEqualTo(400);
            assertThat(status(subscribe(buyer, body("keyword", "长".repeat(41))))).isEqualTo(400);
            assertThat(status(subscribe(buyer, body("category", "不存在的分类")))).isEqualTo(400);
        }

        @Test
        @DisplayName("4. BUILDING：没有宿舍楼也没选楼 → 409；有宿舍楼则默认用它；停用楼 400；不存在 404；校区矛盾 400")
        void buildingScopeRules() throws Exception {
            User buyer = register("东校区");
            assertThat(status(subscribe(buyer, body("keyword", tag(), "geoScope", "BUILDING"))))
                    .as("不能凭空创建「我的本楼」订阅").isEqualTo(409);

            setDorm(buyer, "east-qinyuan-1");
            JsonNode sub = data(subscribe(buyer, body("keyword", tag(), "geoScope", "BUILDING"))).path("subscription");
            assertThat(sub.path("buildingId").asText()).isEqualTo("east-qinyuan-1");
            assertThat(sub.path("campusId").asText()).as("校区由楼栋推导").isEqualTo("东校区");

            assertThat(status(subscribe(buyer, body("keyword", tag(), "geoScope", "BUILDING", "buildingId", "east-songyuan-6"))))
                    .as("停用楼栋").isEqualTo(400);
            assertThat(status(subscribe(buyer, body("keyword", tag(), "geoScope", "BUILDING", "buildingId", "no-such"))))
                    .as("不存在的楼栋").isEqualTo(404);
            assertThat(status(subscribe(buyer, body("keyword", tag(), "geoScope", "BUILDING",
                    "buildingId", "east-qinyuan-1", "campusId", "西校区")))).as("校区与楼栋矛盾").isEqualTo(400);
        }

        @Test
        @DisplayName("5. ZONE 由楼栋推导：同园区换一栋楼作锚点仍是同一订阅；不接受园区文本")
        void zoneIsDerivedFromBuilding() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            JsonNode a = data(subscribe(buyer, body("keyword", tag, "geoScope", "ZONE", "buildingId", "east-qinyuan-1")));
            JsonNode b = data(subscribe(buyer, body("keyword", tag, "geoScope", "ZONE", "buildingId", "east-qinyuan-3")));
            assertThat(a.path("subscription").path("zone").asText()).isEqualTo("沁园");
            assertThat(b.path("outcome").asText()).as("同园区的另一栋楼表达的是同一个需求").isEqualTo("EXISTING");
        }

        @Test
        @DisplayName("6. CAMPUS 默认本人校区；他校校区被拒")
        void campusScopeRules() throws Exception {
            User buyer = register("西校区");
            JsonNode sub = data(subscribe(buyer, body("category", "数码电子", "geoScope", "CAMPUS"))).path("subscription");
            assertThat(sub.path("campusId").asText()).isEqualTo("西校区");

            ensureOtherSchool();
            assertThat(status(subscribe(buyer, body("category", "数码电子", "geoScope", "CAMPUS", "campusId", "他校区"))))
                    .isEqualTo(400);
        }

        @Test
        @DisplayName("7. 只能查看与修改自己的订阅；删除是软停用，行仍在")
        void ownershipAndSoftDelete() throws Exception {
            User owner = register("东校区");
            User other = register("东校区");
            String id = data(subscribe(owner, body("keyword", tag()))).path("subscription").path("id").asText();

            assertThat(data(perform(get("/v1/demand-subscriptions"), other))).isEmpty();
            assertThat(status(perform(json(patch("/v1/demand-subscriptions/" + id), Map.of("keyword", "改")), other))).isEqualTo(404);
            assertThat(status(perform(delete("/v1/demand-subscriptions/" + id), other))).isEqualTo(404);

            JsonNode deleted = data(perform(delete("/v1/demand-subscriptions/" + id), owner));
            assertThat(deleted.path("active").asBoolean()).isFalse();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE id=?::uuid", Integer.class, id))
                    .as("软停用：历史匹配仍引用它").isEqualTo(1);
        }

        @Test
        @DisplayName("8. 已停用的同条件订阅 → 重新激活原行，而不是新建")
        void recreatingInactiveSubscriptionReactivatesIt() throws Exception {
            User buyer = register("东校区");
            Map<String, Object> conditions = body("keyword", tag(), "geoScope", "SCHOOL");
            String id = data(subscribe(buyer, conditions)).path("subscription").path("id").asText();
            perform(delete("/v1/demand-subscriptions/" + id), buyer);

            JsonNode again = data(subscribe(buyer, conditions));
            assertThat(again.path("outcome").asText()).isEqualTo("REACTIVATED");
            assertThat(again.path("subscription").path("id").asText()).isEqualTo(id);
            assertThat(again.path("subscription").path("active").asBoolean()).isTrue();
        }

        @Test
        @DisplayName("9. 修改条件重算指纹；与本人另一条启用订阅撞车 → 409")
        void patchRecomputesFingerprint() throws Exception {
            User buyer = register("东校区");
            String a = tag(), b = tag();
            data(subscribe(buyer, body("keyword", a)));
            String second = data(subscribe(buyer, body("keyword", b))).path("subscription").path("id").asText();

            assertThat(status(perform(json(patch("/v1/demand-subscriptions/" + second), Map.of("keyword", a)), buyer)))
                    .isEqualTo(409);
            JsonNode changed = data(perform(json(patch("/v1/demand-subscriptions/" + second), Map.of("keyword", b + "x")), buyer));
            assertThat(changed.path("keyword").asText()).isEqualTo(b + "x");
            // 改名后原关键词又可以用了
            assertThat(data(subscribe(buyer, body("keyword", b))).path("outcome").asText()).isEqualTo("CREATED");
        }

        @Test
        @DisplayName("10. 上限 50 条：第 51 条 409；停用一条后又能建")
        void activeLimitIsEnforced() throws Exception {
            User buyer = register("东校区");
            String first = null;
            for (int i = 0; i < 50; i++) {
                MvcResult r = subscribe(buyer, body("keyword", tag()));
                assertThat(status(r)).isEqualTo(200);
                if (first == null) first = data(r).path("subscription").path("id").asText();
            }
            assertThat(status(subscribe(buyer, body("keyword", tag())))).isEqualTo(409);
            perform(delete("/v1/demand-subscriptions/" + first), buyer);
            assertThat(status(subscribe(buyer, body("keyword", tag())))).isEqualTo(200);
            assertThat(activeCount(buyer)).isEqualTo(50);
        }

        @Test
        @DisplayName("11. 并发：已有 45 条时 20 个请求同时创建不同订阅，最终恰好 50 条启用")
        void concurrentCreatesRespectLimit() throws Exception {
            User buyer = register("东校区");
            for (int i = 0; i < 45; i++) subscribe(buyer, body("keyword", tag()));

            List<Integer> statuses = concurrently(20, i -> status(subscribe(buyer, body("keyword", tag()))));
            assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(5);
            assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(15);
            assertThat(activeCount(buyer)).as("并发下上限也必须守住").isEqualTo(50);
        }

        @Test
        @DisplayName("12. 并发：10 个请求同时创建同一条件，最终只有一条启用订阅")
        void concurrentIdenticalCreatesCollapse() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            List<Integer> statuses = concurrently(10, i -> status(subscribe(buyer, body("keyword", tag))));
            assertThat(statuses).allMatch(s -> s == 200);
            assertThat(activeCount(buyer)).isEqualTo(1);
        }
    }

    // ==================================================================
    // 2.3 同步匹配
    // ==================================================================

    @Nested
    @DisplayName("2.3 同步匹配")
    class Matching {

        @Test
        @DisplayName("1. 发布成功返回时匹配已经存在：不依赖任何扫描任务")
        void matchExistsWhenPublishReturns() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");

            String productId = publish(seller, product(tag + " 台灯"));
            // 发布接口一返回就直接查库：没有任何后台任务能在这之间补上匹配
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, productId)).isEqualTo(1);
            assertThat(inboxIds(buyer)).contains(productId);
        }

        @Test
        @DisplayName("2. 卖家自己的订阅不会被自己的商品命中")
        void sellerDoesNotMatchOwnSubscription() throws Exception {
            User seller = register("东校区");
            String tag = tag();
            subscribe(seller, body("keyword", tag));
            publish(seller, product(tag + " 台灯"));
            assertThat(inboxIds(seller)).isEmpty();
        }

        @Test
        @DisplayName("3. 学校隔离：他校订阅永远不会命中本校商品")
        void schoolIsolation() throws Exception {
            ensureOtherSchool();
            String tag = tag();
            UUID outsider = UUID.randomUUID();
            jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,?,?)",
                    outsider, "out" + outsider, "x", "他校", "他校区");
            jdbc.update("""
                    INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,geo_scope,fingerprint)
                    VALUES (gen_random_uuid(), ?, 'other-school', ?, ?, 'SCHOOL', ?)
                    """, outsider, tag, tag, "e".repeat(64));

            String productId = publish(register("东校区"), product(tag + " 台灯"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, productId)).isZero();
        }

        @Test
        @DisplayName("4. 四种地理范围：BUILDING 同楼 / ZONE 同园区 / CAMPUS 同校区 / SCHOOL 全校")
        void geoScopes() throws Exception {
            User building = register("东校区");
            User zone = register("东校区");
            User campus = register("东校区");
            User school = register("东校区");
            String tag = tag();
            subscribe(building, body("keyword", tag, "geoScope", "BUILDING", "buildingId", "east-qinyuan-1"));
            subscribe(zone, body("keyword", tag, "geoScope", "ZONE", "buildingId", "east-qinyuan-1"));
            subscribe(campus, body("keyword", tag, "geoScope", "CAMPUS", "campusId", "东校区"));
            subscribe(school, body("keyword", tag, "geoScope", "SCHOOL"));
            User seller = register("东校区");

            String sameBuilding = publish(seller, product(tag + " A", "东校区", "east-qinyuan-1"));
            String sameZone = publish(seller, product(tag + " B", "东校区", "east-qinyuan-2"));
            String sameCampus = publish(seller, product(tag + " C", "东校区", "east-songyuan-4"));
            String otherCampus = publish(seller, product(tag + " D", "西校区", "west-zhuyuan-1"));
            String noBuilding = publish(seller, product(tag + " E", "东校区", null));

            assertThat(inboxIds(building)).containsExactlyInAnyOrder(sameBuilding);
            assertThat(inboxIds(zone)).containsExactlyInAnyOrder(sameBuilding, sameZone);
            assertThat(inboxIds(campus)).containsExactlyInAnyOrder(sameBuilding, sameZone, sameCampus, noBuilding);
            assertThat(inboxIds(school)).containsExactlyInAnyOrder(sameBuilding, sameZone, sameCampus, otherCampus, noBuilding);
        }

        @Test
        @DisplayName("5. 关键词命中标题或描述；都不含则不匹配")
        void keywordInTitleOrDescription() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            String inTitle = publish(seller, product(tag + " 标题"));
            String inDescription = publish(seller, product("别的标题", "东校区", null, "描述里有 " + tag));
            publish(seller, product("完全无关", "东校区", null, "描述也无关"));

            Map<String, JsonNode> byProduct = inboxByProduct(buyer);
            assertThat(byProduct).containsOnlyKeys(inTitle, inDescription);
            assertThat(codes(byProduct.get(inTitle))).contains("KEYWORD_TITLE");
            assertThat(codes(byProduct.get(inDescription))).contains("KEYWORD_DESCRIPTION");
        }

        @Test
        @DisplayName("6. % 与 _ 是字面字符，不是通配符")
        void wildcardsAreLiteral() throws Exception {
            User percent = register("东校区");
            User underscore = register("东校区");
            String tag = tag();
            subscribe(percent, body("keyword", tag + "50%"));
            subscribe(underscore, body("keyword", tag + "a_c"));
            User seller = register("东校区");

            String literalPercent = publish(seller, product(tag + "50%新"));
            publish(seller, product(tag + "50元"));                 // 若 % 被当通配符会误中
            String literalUnderscore = publish(seller, product(tag + "a_c 型号"));
            publish(seller, product(tag + "abc 型号"));              // 若 _ 被当通配符会误中

            assertThat(inboxIds(percent)).containsExactly(literalPercent);
            assertThat(inboxIds(underscore)).containsExactly(literalUnderscore);
        }

        @Test
        @DisplayName("7. 中文关键词：全角空格与连续空白被规范化后正常匹配")
        void chineseKeywords() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag + "　护眼   台灯"));
            String productId = publish(register("东校区"), product("全新 " + tag + " 护眼 台灯 九成新"));
            assertThat(inboxIds(buyer)).containsExactly(productId);
        }

        @Test
        @DisplayName("8. 分类与价格区间是硬性条件")
        void categoryAndPriceAreHardFilters() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag, "category", "数码电子", "minPrice", 100, "maxPrice", 300));
            User seller = register("东校区");
            String ok = publish(seller, product(tag + " 耳机", "东校区", null, "d", "数码电子", 200));
            publish(seller, product(tag + " 耳机", "东校区", null, "d", "生活用品", 200));  // 分类不符
            publish(seller, product(tag + " 耳机", "东校区", null, "d", "数码电子", 99));   // 低于下限
            publish(seller, product(tag + " 耳机", "东校区", null, "d", "数码电子", 301));  // 高于上限
            String edge = publish(seller, product(tag + " 耳机", "东校区", null, "d", "数码电子", 300));  // 边界含
            assertThat(inboxIds(buyer)).containsExactlyInAnyOrder(ok, edge);
        }

        @Test
        @DisplayName("9. 评分与理由码一一对应：精确标题 + 分类 + 同楼 + 价格居中 = 100")
        void scoreAndReasonCodes() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag, "category", "数码电子", "minPrice", 100, "maxPrice", 300,
                    "geoScope", "BUILDING", "buildingId", "east-qinyuan-1"));
            String productId = publish(register("东校区"),
                    product(tag, "东校区", "east-qinyuan-1", "d", "数码电子", 200));

            JsonNode match = inboxByProduct(buyer).get(productId);
            assertThat(codes(match)).containsExactly("KEYWORD_TITLE_EXACT", "CATEGORY", "SAME_BUILDING", "PRICE_CLOSE");
            assertThat(match.path("score").asInt()).isEqualTo(100);
            assertThat(match.path("tier").asText()).as("档位由服务端给出").isEqualTo("HIGH");
        }

        @Test
        @DisplayName("10. 收件箱顺序稳定：重复查询完全一致")
        void inboxOrderIsStable() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            for (int i = 0; i < 5; i++) publish(seller, product(tag + " " + i));
            List<String> first = inboxIds(buyer);
            for (int i = 0; i < 3; i++) assertThat(inboxIds(buyer)).isEqualTo(first);
        }

        @Test
        @DisplayName("11. 重复评估不产生重复匹配")
        void reEvaluationNeverDuplicates() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            String productId = publish(seller, product(tag + " 台灯"));
            for (int i = 0; i < 3; i++) patchProduct(seller, productId, Map.of("description", "改描述 " + i));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, productId)).isEqualTo(1);
        }

        @Test
        @DisplayName("12. 编辑后新满足条件 → 新增匹配")
        void updateAddsMatch() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            String productId = publish(seller, product("还没有关键词"));
            assertThat(inboxIds(buyer)).isEmpty();

            patchProduct(seller, productId, Map.of("title", tag + " 改后的标题"));
            assertThat(inboxIds(buyer)).containsExactly(productId);
        }

        @Test
        @DisplayName("13. 编辑后不再满足 → 旧匹配标记失效但不删除；未读数不再计入")
        void updateInvalidatesMatch() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            String productId = publish(seller, product(tag + " 台灯"));
            long before = unread(buyer);

            patchProduct(seller, productId, Map.of("title", "改成别的"));
            JsonNode match = inboxByProduct(buyer).get(productId);
            assertThat(match).as("历史记录保留").isNotNull();
            assertThat(match.path("valid").asBoolean()).isFalse();
            assertThat(match.path("invalidReason").asText()).isEqualTo("NO_LONGER_MATCHES");
            assertThat(unread(buyer)).isEqualTo(before - 1);

            // 再改回来：同一条记录恢复有效，不会新增第二条
            patchProduct(seller, productId, Map.of("title", tag + " 又改回来"));
            assertThat(inboxByProduct(buyer).get(productId).path("valid").asBoolean()).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, productId)).isEqualTo(1);
        }

        @Test
        @DisplayName("14. 下架 / 已售 → 不可购买；重新上架 → 恢复")
        void takedownAndRelist() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            String productId = publish(seller, product(tag + " 台灯"));

            perform(json(post("/v1/products/" + productId + "/status"), Map.of("status", "已下架")), seller);
            assertThat(inboxByProduct(buyer).get(productId).path("valid").asBoolean()).isFalse();
            assertThat(unread(buyer)).isZero();

            perform(json(post("/v1/products/" + productId + "/status"), Map.of("status", "在售")), seller);
            assertThat(inboxByProduct(buyer).get(productId).path("valid").asBoolean()).isTrue();

            perform(json(post("/v1/products/" + productId + "/status"), Map.of("status", "已售出")), seller);
            assertThat(inboxByProduct(buyer).get(productId).path("valid").asBoolean()).isFalse();
        }

        @Test
        @DisplayName("15. 被别人下单锁定（预约中）→ 即时显示为不可购买，且不计入未读")
        void reservedProductIsNotPurchasable() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            String productId = publish(register("东校区"), product(tag + " 台灯"));
            assertThat(unread(buyer)).isEqualTo(1);

            jdbc.update("UPDATE products SET status='预约中' WHERE id=?::uuid", productId);
            JsonNode match = inboxByProduct(buyer).get(productId);
            assertThat(match.path("valid").asBoolean()).isFalse();
            assertThat(match.path("invalidReason").asText()).isEqualTo("NOT_ON_SALE");
            assertThat(unread(buyer)).isZero();
        }

        @Test
        @DisplayName("16. 外层事务回滚时，商品与匹配一起回滚")
        void rollbackTakesMatchesWithIt() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");

            String[] created = new String[1];
            transactions.executeWithoutResult(status -> {
                Map<String, Object> result = market.createProduct(seller.id(), product(tag + " 回滚"));
                created[0] = String.valueOf(result.get("id"));
                assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                        Integer.class, created[0])).as("事务内匹配已写入").isEqualTo(1);
                status.setRollbackOnly();
            });
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE id=?::uuid", Integer.class, created[0])).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, created[0])).isZero();
        }

        @Test
        @DisplayName("17. 并发评估同一商品：唯一约束保证每个订阅只有一条匹配")
        void concurrentEvaluationIsSafe() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            String productId = publish(register("东校区"), product(tag + " 台灯"));

            concurrently(8, i -> {
                transactions.executeWithoutResult(s -> matches.evaluate(UUID.fromString(productId)));
                return 0;
            });
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id=?::uuid",
                    Integer.class, productId)).isEqualTo(1);
        }

        @Test
        @DisplayName("18. 无 N+1：命中 1 个订阅与命中 30 个订阅，发布时的 SQL 条数相同")
        void publishDoesNotScaleWithSubscriptions() throws Exception {
            StatementCounter counter = StatementCounter.install(sessions);
            String few = tag(), many = tag();
            subscribe(register("东校区"), body("keyword", few));
            for (int i = 0; i < 30; i++) subscribe(register("东校区"), body("keyword", many));
            User seller = register("东校区");

            long one = counter.during(() -> call(() -> publish(seller, product(few + " 台灯"))));
            long thirty = counter.during(() -> call(() -> publish(seller, product(many + " 台灯"))));
            assertThat(one).isPositive();
            assertThat(thirty).as("命中订阅数从 1 到 30，语句数不变").isEqualTo(one);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches m JOIN demand_subscriptions s "
                    + "ON s.id=m.subscription_id WHERE s.normalized_keyword=?", Integer.class, many)).isEqualTo(30);
        }

        @Test
        @DisplayName("19. 隐私：发布响应不含任何匹配信息；卖家看不到买家订阅；他人无法读写别人的匹配")
        void privacyBoundaries() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");

            MvcResult published = perform(json(post("/v1/products"), product(tag + " 台灯")), seller);
            String response = published.getResponse().getContentAsString();
            assertThat(response).doesNotContain("match").doesNotContain("subscri").doesNotContain(buyer.id());

            assertThat(data(perform(get("/v1/demand-matches"), seller)).path("items")).isEmpty();
            assertThat(data(perform(get("/v1/demand-subscriptions"), seller))).isEmpty();

            String matchId = inboxByProduct(buyer).values().iterator().next().path("id").asText();
            assertThat(status(perform(post("/v1/demand-matches/" + matchId + "/read"), seller))).isEqualTo(404);
            assertThat(status(perform(post("/v1/demand-matches/" + matchId + "/dismiss"), seller))).isEqualTo(404);

            // 买家视角的商品投影不带卖家联系方式
            JsonNode product = inboxByProduct(buyer).values().iterator().next().path("product");
            assertThat(product.path("contact").asText()).isEmpty();
        }
    }

    // ==================================================================
    // 2.4 未读与已读
    // ==================================================================

    @Nested
    @DisplayName("2.4 未读")
    class Unread {

        @Test
        @DisplayName("1. 未读只统计有效、未读、未忽略；已读与忽略幂等")
        void unreadCounting() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            subscribe(buyer, body("keyword", tag));
            User seller = register("东校区");
            for (int i = 0; i < 3; i++) publish(seller, product(tag + " " + i));
            assertThat(unread(buyer)).isEqualTo(3);

            List<String> ids = new ArrayList<>();
            data(perform(get("/v1/demand-matches"), buyer)).path("items").forEach(n -> ids.add(n.path("id").asText()));

            assertThat(data(perform(post("/v1/demand-matches/" + ids.get(0) + "/read"), buyer)).path("count").asLong()).isEqualTo(2);
            assertThat(data(perform(post("/v1/demand-matches/" + ids.get(0) + "/read"), buyer)).path("count").asLong())
                    .as("重复标记已读幂等").isEqualTo(2);

            assertThat(data(perform(post("/v1/demand-matches/" + ids.get(1) + "/dismiss"), buyer)).path("count").asLong()).isEqualTo(1);
            assertThat(inboxIds(buyer)).as("已忽略的不再出现在收件箱").hasSize(2);
        }

        @Test
        @DisplayName("2. 停用订阅后，它产生的匹配不再计入未读")
        void inactiveSubscriptionIsNotCounted() throws Exception {
            User buyer = register("东校区");
            String tag = tag();
            String subscription = data(subscribe(buyer, body("keyword", tag))).path("subscription").path("id").asText();
            publish(register("东校区"), product(tag + " 台灯"));
            assertThat(unread(buyer)).isEqualTo(1);
            perform(delete("/v1/demand-subscriptions/" + subscription), buyer);
            assertThat(unread(buyer)).isZero();
        }

        @Test
        @DisplayName("3. 未登录访问任何需求雷达接口都是 401")
        void anonymousIsRejected() throws Exception {
            for (MockHttpServletRequestBuilder request : List.of(
                    get("/v1/demand-subscriptions"), get("/v1/demand-matches"),
                    get("/v1/demand-matches/unread-count"))) {
                assertThat(mockMvc.perform(request).andReturn().getResponse().getStatus()).isEqualTo(401);
            }
        }
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    record User(String id, String token) {}

    private static String tag() {
        return "r" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    }

    private static Map<String, Object> body(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
        return m;
    }

    private Map<String, Object> product(String title) {
        return product(title, "东校区", null);
    }

    private Map<String, Object> product(String title, String campus, String buildingId) {
        return product(title, campus, buildingId, "需求雷达测试商品");
    }

    private Map<String, Object> product(String title, String campus, String buildingId, String description) {
        return product(title, campus, buildingId, description, "生活用品", 50);
    }

    private Map<String, Object> product(String title, String campus, String buildingId, String description,
                                        String category, int price) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", title);
        b.put("description", description);
        b.put("price", price);
        b.put("category", category);
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        b.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure(category));
        b.put("condition", "全新");
        b.put("campus", campus);
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        b.put("buildingId", buildingId);
        return b;
    }

    private void ensureOtherSchool() {
        jdbc.update("INSERT INTO schools(id,name) VALUES ('other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('他校区','other-school','他校区') ON CONFLICT DO NOTHING");
    }

    private User register(String campus) throws Exception {
        Map<String, Object> b = body("account", "dr" + UUID.randomUUID().toString().replace("-", ""),
                "password", PASSWORD, "nickname", "雷达", "campus", campus, "contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(b))).andReturn();
        JsonNode d = data(r);
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }

    private void setDorm(User user, String buildingId) throws Exception {
        assertThat(status(perform(json(patch("/v1/auth/me"), Map.of("dormBuildingId", buildingId)), user))).isEqualTo(200);
    }

    private MvcResult subscribe(User user, Map<String, Object> b) throws Exception {
        return perform(json(post("/v1/demand-subscriptions"), b), user);
    }

    private String publish(User seller, Map<String, Object> b) throws Exception {
        MvcResult r = perform(json(post("/v1/products"), b), seller);
        assertThat(status(r)).as("发布失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r).path("id").asText();
    }

    private void patchProduct(User seller, String id, Map<String, Object> b) throws Exception {
        MvcResult r = perform(json(patch("/v1/products/" + id), b), seller);
        assertThat(status(r)).as("编辑失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder builder, Map<String, Object> b) throws Exception {
        return builder.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(b));
    }

    private MvcResult perform(MockHttpServletRequestBuilder builder, User user) throws Exception {
        return mockMvc.perform(builder.header("Authorization", "Bearer " + user.token())).andReturn();
    }

    private JsonNode data(MvcResult r) throws Exception {
        return objectMapper.readTree(r.getResponse().getContentAsString()).path("data");
    }

    private static int status(MvcResult r) {
        return r.getResponse().getStatus();
    }

    private long unread(User user) throws Exception {
        return data(perform(get("/v1/demand-matches/unread-count"), user)).path("count").asLong();
    }

    private List<String> inboxIds(User user) throws Exception {
        List<String> ids = new ArrayList<>();
        data(perform(get("/v1/demand-matches").param("pageSize", "100"), user)).path("items")
                .forEach(n -> ids.add(n.path("product").path("id").asText()));
        return ids;
    }

    private Map<String, JsonNode> inboxByProduct(User user) throws Exception {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        data(perform(get("/v1/demand-matches").param("pageSize", "100"), user)).path("items")
                .forEach(n -> result.put(n.path("product").path("id").asText(), n));
        return result;
    }

    private static List<String> codes(JsonNode match) {
        List<String> codes = new ArrayList<>();
        match.path("reasonCodes").forEach(n -> codes.add(n.asText()));
        return codes;
    }

    private long activeCount(User user) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM demand_subscriptions WHERE user_id=?::uuid AND active", Long.class, user.id());
        return count == null ? 0 : count;
    }

    @FunctionalInterface
    interface ThrowingTask { Object run() throws Exception; }

    private static void call(ThrowingTask task) {
        try {
            task.run();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @FunctionalInterface
    interface Indexed<T> { T apply(int i) throws Exception; }

    private static <T> List<T> concurrently(int threads, Indexed<T> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<T>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                int index = i;
                futures.add(pool.submit(() -> {
                    gate.await();
                    return task.apply(index);
                }));
            }
            gate.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
    }
}
