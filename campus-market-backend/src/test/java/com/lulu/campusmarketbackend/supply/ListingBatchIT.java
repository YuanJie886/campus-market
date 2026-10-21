package com.lulu.campusmarketbackend.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.demand.DemandMatchService;
import com.lulu.campusmarketbackend.service.MarketService;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;
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
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

/**
 * 模块 5.1A / 5.1B / 5.2：服务端草稿与批量发布。真实 PostgreSQL 16：乐观锁、行锁、部分唯一索引、
 * 触发器与事务回滚都是真的；故障注入通过 Spy 在第 N 次调用时抛错。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.listing-draft-create.limit=60",
        "campus-market.rate-limit.listing-batch-publish.limit=6",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ListingBatchIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_batch")
            .withUsername("campus_batch").withPassword("campus_batch_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "listing-batch-it-secret-0123456789ab");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;
    @MockitoSpyBean MarketService market;
    @MockitoSpyBean DemandMatchService matches;

    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    // ==================================================================
    // 草稿
    // ==================================================================

    @Nested
    @DisplayName("5.1A 草稿")
    class Drafts {

        @Test
        @DisplayName("1. 允许部分保存；只有所有者可见（他人 404）；草稿不进入商品列表与搜索")
        void partialDraftIsPrivate() throws Exception {
            User owner = api.register();
            String title = "只填了标题的草稿" + UUID.randomUUID().toString().substring(0, 6);
            JsonNode draft = api.createDraft(owner, "SINGLE", Map.of("title", title));
            assertThat(draft.path("status").asText()).isEqualTo("DRAFT");
            assertThat(draft.path("version").asInt()).isEqualTo(1);
            assertThat(draft.path("access").asText()).isEqualTo("OWNER");
            assertThat(draft.toString()).doesNotContain(owner.id()).as("不返回所有者 id");
            String id = draft.path("id").asText();

            assertThat(api.ok(api.get(owner, "/v1/listing-drafts/" + id)).path("payload").path("title").asText()).isEqualTo(title);
            User stranger = api.register();
            assertThat(status(api.get(stranger, "/v1/listing-drafts/" + id))).isEqualTo(404);
            assertThat(status(api.patch(stranger, "/v1/listing-drafts/" + id, Map.of("expectedVersion", 1, "payload", Map.of())))).isEqualTo(404);
            assertThat(status(api.delete(stranger, "/v1/listing-drafts/" + id))).isEqualTo(404);
            assertThat(status(api.get(stranger, "/v1/listing-drafts/not-a-uuid"))).isEqualTo(404);
            assertThat(api.ok(api.get(stranger, "/v1/listing-drafts"))).isEmpty();
            assertThat(api.ok(api.get(owner, "/v1/listing-drafts")).toString()).contains(id);

            assertThat(api.ok(api.get(owner, "/v1/products?keyword=" + title)).path("items")).isEmpty();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title=?", Integer.class, title)).isZero();
        }

        @Test
        @DisplayName("2. 字段白名单：payload 未知字段、sellerId / status 等服务端字段、未知顶层字段一律 400，带 requestId")
        void whitelist() throws Exception {
            User owner = api.register();
            for (String field : List.of("sellerId", "ownerUserId", "status", "schoolId", "createdAt", "listingKind", "publishedBy")) {
                Map<String, Object> payload = new LinkedHashMap<>(Map.of("title", "t"));
                payload.put(field, "evil");
                MvcResult r = api.post(owner, "/v1/listing-drafts", Map.of("draftType", "SINGLE", "payload", payload));
                assertThat(status(r)).as(field).isEqualTo(400);
                assertThat(api.body(r).path("requestId").asText()).isNotBlank();
            }
            assertThat(status(api.post(owner, "/v1/listing-drafts", Map.of("draftType", "SINGLE", "ownerId", "x")))).isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/listing-drafts", Map.of("draftType", "PALLET")))).isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/listing-drafts", Map.of("payload", Map.of("inspection", List.of(Map.of("itemCode", "A", "evil", 1))))))).isEqualTo(400);
        }

        @Test
        @DisplayName("3. READY 必须通过正式校验（400 带逐项原因）；乐观锁：同一版本的第二次保存 409 并给出当前版本；If-Match 头等价；缺版本 400")
        void readyAndOptimisticLock() throws Exception {
            User owner = api.register();
            String id = api.createDraft(owner, "SINGLE", Map.of("title", "还没填完")).path("id").asText();
            MvcResult notReady = api.saveDraft(owner, id, 1, null, "READY");
            assertThat(status(notReady)).isEqualTo(400);
            assertThat(api.body(notReady).path("data").path("code").asText()).isEqualTo("MISSING_FIELD");
            assertThat(api.body(notReady).path("data").path("field").asText()).contains("description").contains("price");

            JsonNode saved = api.ok(api.saveDraft(owner, id, 1, single("生活用品", "台灯", 20), "READY"));
            assertThat(saved.path("status").asText()).isEqualTo("READY");
            assertThat(saved.path("version").asInt()).isEqualTo(2);

            // 两个标签页都读到了版本 2
            assertThat(status(api.saveDraft(owner, id, 2, single("生活用品", "台灯 A 页", 20), null))).isEqualTo(200);
            MvcResult stale = api.saveDraft(owner, id, 2, single("生活用品", "台灯 B 页", 25), null);
            assertThat(status(stale)).as("不得静默覆盖另一个页面的修改").isEqualTo(409);
            assertThat(api.body(stale).path("data").path("currentVersion").asInt()).isEqualTo(3);
            assertThat(api.ok(api.get(owner, "/v1/listing-drafts/" + id)).path("payload").path("title").asText()).isEqualTo("台灯 A 页");

            MvcResult viaHeader = api.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                    .patch("/v1/listing-drafts/" + id).header("If-Match", "W/\"3\"")
                    .contentType("application/json").content(json.writeValueAsString(Map.of("payload", Map.of("title", "头部版本")))), owner);
            assertThat(status(viaHeader)).isEqualTo(200);
            assertThat(status(api.patch(owner, "/v1/listing-drafts/" + id, Map.of("payload", Map.of())))).as("缺版本").isEqualTo(400);
        }

        @Test
        @DisplayName("4. 过期：读取时显式返回 EXPIRED、不可再写；丢弃是软状态、幂等；数据库拒绝物理删除与改写已关闭的草稿")
        void expiryAndDiscard() throws Exception {
            User owner = api.register();
            String expired = api.createDraft(owner, "SINGLE", Map.of("title", "会过期")).path("id").asText();
            jdbc.update("UPDATE listing_drafts SET expires_at = now() - interval '1 minute' WHERE id=?::uuid", expired);
            assertThat(api.ok(api.get(owner, "/v1/listing-drafts/" + expired)).path("status").asText()).isEqualTo("EXPIRED");
            assertThat(status(api.saveDraft(owner, expired, 1, Map.of("title", "x"), null))).isEqualTo(409);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts WHERE id=?::uuid", Integer.class, expired)).as("不自动删除").isEqualTo(1);

            String discarded = api.createDraft(owner, "SINGLE", Map.of("title", "会丢弃")).path("id").asText();
            assertThat(api.ok(api.delete(owner, "/v1/listing-drafts/" + discarded)).path("status").asText()).isEqualTo("DISCARDED");
            assertThat(api.ok(api.delete(owner, "/v1/listing-drafts/" + discarded)).path("status").asText()).as("幂等").isEqualTo("DISCARDED");
            assertThat(status(api.saveDraft(owner, discarded, 1, Map.of("title", "x"), null))).isEqualTo(409);

            assertThatThrownBy(() -> jdbc.update("DELETE FROM listing_drafts WHERE id=?::uuid", discarded))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThatThrownBy(() -> jdbc.update("UPDATE listing_drafts SET payload='{}'::jsonb WHERE id=?::uuid", discarded))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
        }

        @Test
        @DisplayName("5. 草稿创建限流：按账号计数，超出 429 带 Retry-After 与 requestId，错误体不回显草稿内容")
        void draftCreateRateLimit() throws Exception {
            User owner = api.register();
            MvcResult last = null;
            for (int i = 0; i < 61; i++) last = api.post(owner, "/v1/listing-drafts", Map.of("payload", Map.of("title", "限流秘密标题" + i)));
            assertThat(status(last)).isEqualTo(429);
            assertThat(last.getResponse().getHeader("Retry-After")).matches("[1-9][0-9]*");
            assertThat(api.body(last).path("requestId").asText()).isNotBlank();
            assertThat(last.getResponse().getContentAsString()).doesNotContain("限流秘密标题");
            assertThat(status(api.post(api.register(), "/v1/listing-drafts", Map.of("payload", Map.of())))).as("另一个账号不受影响").isEqualTo(200);
        }
    }

    // ==================================================================
    // 批次与逐项校验
    // ==================================================================

    @Nested
    @DisplayName("5.1B / 5.2 批次")
    class Batches {

        @Test
        @DisplayName("6. 逐项校验码：MISSING_FIELD / INVALID_CATEGORY / INVALID_PRICE / INVALID_BUILDING / INVALID_INSPECTION / INVALID_TEXTBOOK / INVALID_BUNDLE；有一项不通过则整批 400，什么都不写")
        void perItemValidation() throws Exception {
            User owner = api.register();
            Map<String, Map<String, Object>> cases = new LinkedHashMap<>();
            cases.put("VALID", single("数码电子", "合格的一件", 30));
            cases.put("MISSING_FIELD", Map.of("title", "只有标题"));
            Map<String, Object> category = single("生活用品", "分类错", 10); category.put("category", "奢侈品"); cases.put("INVALID_CATEGORY", category);
            Map<String, Object> price = single("生活用品", "价格错", 10); price.put("price", -5); cases.put("INVALID_PRICE", price);
            Map<String, Object> building = single("生活用品", "楼栋错", 10); building.put("buildingId", "west-zhuyuan-1"); cases.put("INVALID_BUILDING", building);
            Map<String, Object> inspection = single("数码电子", "验货缺项", 10); inspection.remove("inspection"); cases.put("INVALID_INSPECTION", inspection);
            Map<String, Object> textbook = single("生活用品", "非教材关联版本", 10); textbook.put("textbookEditionId", "demo-calculus-8"); cases.put("INVALID_TEXTBOOK", textbook);
            Map<String, Object> bundle = single("生活用品", "单件带明细", 10); bundle.put("bundleItems", SupplyApi.bundleItems(2)); cases.put("INVALID_BUNDLE", bundle);

            List<String> ids = new ArrayList<>();
            for (Map<String, Object> payload : cases.values()) ids.add(api.createDraft(owner, "SINGLE", payload).path("id").asText());
            String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", ids))).path("id").asText();

            JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
            assertThat(detail.path("allValid").asBoolean()).isFalse();
            List<String> codes = new ArrayList<>();
            for (JsonNode item : detail.path("items")) codes.add(item.path("validation").path("code").asText());
            assertThat(codes).containsExactlyElementsOf(cases.keySet());

            long before = jdbc.queryForObject("SELECT count(*) FROM products", Long.class);
            MvcResult rejected = api.publish(owner, batch, UUID.randomUUID().toString());
            assertThat(status(rejected)).isEqualTo(400);
            JsonNode problems = api.body(rejected).path("data").path("items");
            assertThat(problems).hasSize(cases.size() - 1);
            assertThat(problems.get(0).path("position").asInt()).as("定位到具体条目").isEqualTo(2);
            assertThat(problems.get(0).path("draftId").asText()).isEqualTo(ids.get(1));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products", Long.class)).isEqualTo(before);
            assertThat(api.ok(api.get(owner, "/v1/listing-batches/" + batch)).path("status").asText()).isEqualTo("OPEN");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_publish_requests WHERE batch_id=?::uuid", Integer.class, batch)).isZero();
        }

        @Test
        @DisplayName("7. 上限 20；同一草稿不能进两个未发布批次；他人草稿 404；空批次不能发布；批次乐观锁 409")
        void batchRules() throws Exception {
            User owner = api.register();
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < 21; i++) ids.add(api.createDraft(owner, "SINGLE", Map.of("title", "d" + i)).path("id").asText());
            assertThat(status(api.post(owner, "/v1/listing-batches", Map.of("draftIds", ids)))).isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(ids.get(0), ids.get(0)))))).isEqualTo(400);

            JsonNode first = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", ids.subList(0, 20))));
            assertThat(first.path("items")).hasSize(20);
            assertThat(status(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(ids.get(3)))))).as("已在未发布批次").isEqualTo(409);
            assertThat(status(api.delete(owner, "/v1/listing-drafts/" + ids.get(3)))).as("在批次里的草稿要先移出").isEqualTo(409);

            User stranger = api.register();
            assertThat(status(api.post(stranger, "/v1/listing-batches", Map.of("draftIds", List.of(ids.get(20)))))).isEqualTo(404);
            assertThat(status(api.get(stranger, "/v1/listing-batches/" + first.path("id").asText()))).isEqualTo(404);
            assertThat(status(api.publish(stranger, first.path("id").asText(), UUID.randomUUID().toString()))).isEqualTo(404);

            String empty = api.ok(api.post(owner, "/v1/listing-batches", Map.of())).path("id").asText();
            assertThat(status(api.publish(owner, empty, UUID.randomUUID().toString()))).isEqualTo(400);

            String batch = first.path("id").asText();
            assertThat(status(api.patch(owner, "/v1/listing-batches/" + batch, Map.of("expectedVersion", 1, "draftIds", ids.subList(0, 2))))).isEqualTo(200);
            assertThat(status(api.patch(owner, "/v1/listing-batches/" + batch, Map.of("expectedVersion", 1, "draftIds", ids.subList(0, 3))))).isEqualTo(409);
            assertThat(status(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(ids.get(3)))))).as("移出后可以进入新批次").isEqualTo(200);
        }

        @Test
        @DisplayName("8. 发布 20 件：一次成功，按顺序返回商品 id；草稿与批次标记已发布；published_by 是所有者；需求匹配同步完成；响应不含需求人数")
        void publishTwenty() throws Exception {
            User buyer = api.register();
            api.ok(api.post(buyer, "/v1/demand-subscriptions", Map.of("keyword", "毕业二十件", "geoScope", "SCHOOL")));
            User owner = api.register();
            String batch = api.readyBatch(owner, 20, "毕业二十件");
            JsonNode published = api.ok(api.publish(owner, batch, "publish-twenty-key"));
            assertThat(published.path("publishedCount").asInt()).isEqualTo(20);
            assertThat(published.path("replayed").asBoolean()).isFalse();
            List<String> productIds = texts(published.path("productIds"));
            assertThat(new HashSet<>(productIds)).hasSize(20);
            assertThat(published.toString()).doesNotContain("match").doesNotContain("subscriber").doesNotContain("demand");

            for (int i = 0; i < 20; i++) {
                assertThat(jdbc.queryForObject("SELECT title FROM products WHERE id=?::uuid", String.class, productIds.get(i)))
                        .isEqualTo("毕业二十件-" + (i + 1));
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE id = ANY(?::uuid[]) AND seller_id=?::uuid AND published_by=?::uuid "
                    + "AND assisted_by IS NULL AND listing_kind='SINGLE'", Integer.class, productIds.toArray(String[]::new), owner.id(), owner.id())).isEqualTo(20);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts WHERE owner_user_id=?::uuid AND status='PUBLISHED'", Integer.class, owner.id())).isEqualTo(20);
            JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
            assertThat(detail.path("status").asText()).isEqualTo("PUBLISHED");
            assertThat(detail.path("items").get(0).path("productId").asText()).isEqualTo(productIds.get(0));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE product_id = ANY(?::uuid[])", Integer.class,
                    (Object) productIds.toArray(String[]::new))).as("发布事务内同步匹配").isEqualTo(20);

            String draftId = detail.path("items").get(0).path("draft").path("id").asText();
            assertThat(status(api.saveDraft(owner, draftId, 1, Map.of("title", "x"), null))).as("已发布草稿只读").isEqualTo(409);
        }

        @Test
        @DisplayName("9. 幂等：同键同请求返回原结果且不重复创建；同键不同批次 409；换键再发已发布批次 409；缺键 400")
        void idempotency() throws Exception {
            User owner = api.register();
            String batch = api.readyBatch(owner, 3, "幂等三件");
            assertThat(status(api.publish(owner, batch, null))).isEqualTo(400);
            assertThat(status(api.publish(owner, batch, "short"))).isEqualTo(400);
            JsonNode first = api.ok(api.publish(owner, batch, "idem-key-0001"));
            JsonNode replay = api.ok(api.publish(owner, batch, "idem-key-0001"));
            assertThat(replay.path("replayed").asBoolean()).isTrue();
            assertThat(replay.path("productIds")).isEqualTo(first.path("productIds"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE '幂等三件-%' AND seller_id=?::uuid", Integer.class, owner.id())).isEqualTo(3);

            String other = api.readyBatch(owner, 1, "幂等另一批");
            assertThat(status(api.publish(owner, other, "idem-key-0001"))).as("同键不同请求").isEqualTo(409);
            assertThat(status(api.publish(owner, batch, "idem-key-0002"))).as("批次已发布").isEqualTo(409);
            assertThat(api.ok(api.get(owner, "/v1/listing-batches/" + other)).path("status").asText()).isEqualTo("OPEN");
        }

        @Test
        @DisplayName("10. 并发：同一批次 6 个不同键并发发布只成功一次；同一键并发全部拿到同一结果；商品不重复")
        void concurrentPublish() throws Exception {
            User owner = api.register();
            String batch = api.readyBatch(owner, 5, "并发五件");
            List<MvcResult> results = concurrently(6, i -> api.publish(owner, batch, "race-key-" + i + "-" + UUID.randomUUID()));
            assertThat(results.stream().filter(r -> status(r) == 200).count()).isEqualTo(1);
            assertThat(results.stream().filter(r -> status(r) != 200).allMatch(r -> status(r) == 409)).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE '并发五件-%'", Integer.class)).isEqualTo(5);

            User owner2 = api.register();
            String batch2 = api.readyBatch(owner2, 4, "同键并发");
            List<MvcResult> same = concurrently(5, i -> api.publish(owner2, batch2, "same-race-key"));
            Set<String> answers = new HashSet<>();
            for (MvcResult r : same) answers.add(api.ok(r).path("productIds").toString());
            assertThat(answers).hasSize(1);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE '同键并发-%'", Integer.class)).isEqualTo(4);
        }

        @Test
        @DisplayName("11. 批量发布限流：按账号计数（失败的尝试也计数），超出 429 带 Retry-After 与 requestId")
        void publishRateLimit() throws Exception {
            User owner = api.register();
            String empty = api.ok(api.post(owner, "/v1/listing-batches", Map.of())).path("id").asText();
            MvcResult last = null;
            for (int i = 0; i < 7; i++) last = api.publish(owner, empty, "rate-key-" + i + "-abcdef");
            assertThat(status(last)).isEqualTo(429);
            assertThat(last.getResponse().getHeader("Retry-After")).matches("[1-9][0-9]*");
            assertThat(api.body(last).path("requestId").asText()).isNotBlank();
        }
    }

    // ==================================================================
    // 故障注入：全有或全无
    // ==================================================================

    @Nested
    @DisplayName("5.2 故障注入")
    class FailureInjection {

        @Test
        @DisplayName("12. 第 10 件商品创建失败：整批回滚——没有商品、没有匹配、草稿与批次原样、没有幂等记录；修复后同一键可以重试成功")
        void tenthProductFails() throws Exception {
            User buyer = api.register();
            api.ok(api.post(buyer, "/v1/demand-subscriptions", Map.of("keyword", "第十件故障", "geoScope", "SCHOOL")));
            User owner = api.register();
            String batch = api.readyBatch(owner, 20, "第十件故障");
            AtomicInteger calls = new AtomicInteger();
            transactions.executeWithoutResult(s -> doAnswer(inv -> {
                if (calls.incrementAndGet() == 10) throw new IllegalStateException("模拟第 10 件失败");
                return inv.callRealMethod();
            }).when(market).createProductAs(any(), any(), any(), any()));

            MvcResult failed = api.publish(owner, batch, "fail-tenth-key");
            assertThat(status(failed)).isEqualTo(500);
            assertThat(failed.getResponse().getContentAsString()).doesNotContain("模拟第 10 件失败");
            assertThat(calls.get()).isEqualTo(10);
            assertRolledBack(owner, batch, "第十件故障");

            org.mockito.Mockito.reset(market);
            JsonNode retried = api.ok(api.publish(owner, batch, "fail-tenth-key"));
            assertThat(retried.path("replayed").asBoolean()).as("失败的尝试没有留下幂等记录").isFalse();
            assertThat(retried.path("publishedCount").asInt()).isEqualTo(20);
        }

        @Test
        @DisplayName("13. 第 15 件的需求匹配失败：前 14 件的商品与匹配全部回滚")
        void fifteenthMatchFails() throws Exception {
            User buyer = api.register();
            api.ok(api.post(buyer, "/v1/demand-subscriptions", Map.of("keyword", "第十五件故障", "geoScope", "SCHOOL")));
            User owner = api.register();
            String batch = api.readyBatch(owner, 20, "第十五件故障");
            AtomicInteger calls = new AtomicInteger();
            transactions.executeWithoutResult(s -> doAnswer(inv -> {
                if (calls.incrementAndGet() == 15) throw new IllegalStateException("模拟匹配失败");
                return inv.callRealMethod();
            }).when(matches).evaluate(any(UUID.class)));

            assertThat(status(api.publish(owner, batch, "fail-fifteenth-key"))).isEqualTo(500);
            assertThat(calls.get()).isEqualTo(15);
            assertRolledBack(owner, batch, "第十五件故障");
        }

        @Test
        @DisplayName("14. 数据库唯一约束失败（第 12 件与第 5 件撞上测试专用唯一索引）：整批回滚，返回 409")
        void uniqueConstraintFails() throws Exception {
            User owner = api.register();
            List<String> ids = new ArrayList<>();
            for (int i = 1; i <= 15; i++) {
                String title = (i == 5 || i == 12) ? "UNIQ-撞车" : "唯一约束故障-" + i;
                ids.add(api.createDraft(owner, "SINGLE", single("生活用品", title, 10)).path("id").asText());
            }
            String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", ids))).path("id").asText();
            jdbc.execute("CREATE UNIQUE INDEX test_only_unique_title ON products(title) WHERE title LIKE 'UNIQ-%'");
            try {
                assertThat(status(api.publish(owner, batch, "fail-unique-key"))).isEqualTo(409);
            } finally {
                jdbc.execute("DROP INDEX test_only_unique_title");
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE 'UNIQ-%' OR title LIKE '唯一约束故障-%'", Integer.class)).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts WHERE id = ANY(?::uuid[]) AND status='PUBLISHED'",
                    Integer.class, (Object) ids.toArray(String[]::new))).isZero();
            assertThat(api.ok(api.get(owner, "/v1/listing-batches/" + batch)).path("status").asText()).isEqualTo("OPEN");
        }

        private void assertRolledBack(User owner, String batch, String prefix) throws Exception {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE ?", Integer.class, prefix + "-%")).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches m JOIN products p ON p.id=m.product_id WHERE p.title LIKE ?",
                    Integer.class, prefix + "-%")).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM product_inspection_disclosures d JOIN products p ON p.id=d.product_id WHERE p.title LIKE ?",
                    Integer.class, prefix + "-%")).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts WHERE owner_user_id=?::uuid AND status <> 'DRAFT'", Integer.class, owner.id())).isZero();
            JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
            assertThat(detail.path("status").asText()).isEqualTo("OPEN");
            assertThat(detail.path("allValid").asBoolean()).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_publish_requests WHERE owner_user_id=?::uuid", Integer.class, owner.id())).isZero();
        }
    }

    // ==================================================================

    private static List<String> texts(JsonNode array) {
        List<String> result = new ArrayList<>();
        for (JsonNode n : array) result.add(n.asText());
        return result;
    }

    private static List<MvcResult> concurrently(int n, ThrowingFn task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<MvcResult>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                int index = i;
                Callable<MvcResult> call = () -> { start.await(); return task.apply(index); };
                futures.add(pool.submit(call));
            }
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    @FunctionalInterface
    interface ThrowingFn { MvcResult apply(int i) throws Exception; }
}
