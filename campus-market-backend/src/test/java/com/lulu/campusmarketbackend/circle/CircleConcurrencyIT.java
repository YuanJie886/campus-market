package com.lulu.campusmarketbackend.circle;

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
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 6 七、并发与竞态（真实 PostgreSQL 16，多线程同时发起 HTTP 请求）。每个场景重复多轮，
 * 断言的是<b>任何交错下都成立</b>的确定结果：依靠行锁（圈子 FOR UPDATE、成员 / 圈子 FOR SHARE、邀请 FOR UPDATE）
 * 与数据库约束（主键、部分唯一索引、提交时的约束触发器），不依赖任何单机内存锁。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.circle-create.limit=1000",
        "campus-market.rate-limit.circle-invite-create.limit=1000",
        "campus-market.rate-limit.circle-invite-redeem.limit=1000",
        "campus-market.rate-limit.listing-draft-create.limit=1000",
        "campus-market.rate-limit.listing-batch-publish.limit=1000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CircleConcurrencyIT {

    private static final int ROUNDS = 6;

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_circle_race")
            .withUsername("campus_race").withPassword("campus_race_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "circle-race-it-secret-0123456789abcdef");
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
    @DisplayName("1. 成员被移除 × 创建订单：要么订单先成立（移除在其后），要么下单 404；永远不会有「移除之后才成立」的非成员订单")
    void removalVsOrder() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "下单竞态 " + round, "PRIVATE");
            User buyer = api.register();
            api.join(owner, circle, buyer);
            String product = api.circleProduct(owner, "竞态商品 " + round, circle);
            List<MvcResult> results = race(
                    () -> api.post(buyer, "/v1/orders", orderBody(product)),
                    () -> api.delete(owner, "/v1/circles/" + circle + "/members/" + buyer.id()));
            assertThat(status(results.get(1))).isEqualTo(200);
            int orderStatus = status(results.get(0));
            assertThat(orderStatus).isIn(200, 404);
            Long late = jdbc.queryForObject("SELECT count(*) FROM orders o JOIN circle_memberships m ON m.user_id = o.buyer_id "
                    + "WHERE o.product_id=?::uuid AND m.circle_id=?::uuid AND m.ended_at < o.created_at", Long.class, product, circle);
            assertThat(late).as("第 %d 轮：不能在移除之后成立订单", round).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id=?::uuid", Long.class, product)).isEqualTo(orderStatus == 200 ? 1 : 0);
        }
    }

    @Test
    @DisplayName("2. 圈子归档 × 发布圈子商品：要么商品在归档前发布，要么发布 404；归档之后不会再出现关联到它的新商品")
    void archiveVsPublish() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "归档竞态 " + round, "PRIVATE");
            Map<String, Object> body = single("生活用品", "归档竞态商品 " + round, 10);
            body.put("visibility", "CIRCLE_ONLY");
            body.put("circleIds", List.of(circle));
            List<MvcResult> results = race(
                    () -> api.post(owner, "/v1/products", body),
                    () -> api.post(owner, "/v1/circles/" + circle + "/archive", Map.of()));
            assertThat(status(results.get(1))).isEqualTo(200);
            assertThat(status(results.get(0))).isIn(200, 404);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM product_circle_visibility v JOIN circles c ON c.id = v.circle_id "
                    + "WHERE v.circle_id=?::uuid AND v.created_at > c.archived_at", Long.class, circle)).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title=?", Long.class, "归档竞态商品 " + round))
                    .isEqualTo(status(results.get(0)) == 200 ? 1 : 0);
        }
    }

    @Test
    @DisplayName("3. 商品改为圈子可见 × 非成员收藏：收藏要么在改动前成功、要么 404；改动之后非成员的收藏列表一定不含这件商品")
    void switchVsFavorite() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "切换竞态 " + round, "PRIVATE");
            String product = api.ok(api.post(owner, "/v1/products", single("生活用品", "切换竞态 " + round, 10))).path("id").asText();
            User fan = api.register();
            List<MvcResult> results = race(
                    () -> api.put(fan, "/v1/products/" + product + "/favorite", Map.of()),
                    () -> api.patch(owner, "/v1/products/" + product, Map.of("visibility", "CIRCLE_ONLY", "circleIds", List.of(circle))));
            assertThat(status(results.get(1))).isEqualTo(200);
            assertThat(status(results.get(0))).isIn(200, 404);
            assertThat(api.ok(api.get(fan, "/v1/favorites")).toString()).doesNotContain(product);
            assertThat(status(api.get(fan, "/v1/products/" + product))).isEqualTo(404);
        }
    }

    @Test
    @DisplayName("4. 同一邀请码 8 人并发兑换：恰好一人成功，成员记录只多一条，其余统一 404")
    void concurrentRedeem() throws Exception {
        User owner = api.register();
        String circle = api.createCircle(owner, "并发兑换", "PRIVATE");
        String token = api.inviteToken(owner, circle);
        List<User> users = new ArrayList<>();
        for (int i = 0; i < 8; i++) users.add(api.register());
        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (User u : users) calls.add(() -> api.post(u, "/v1/circle-invites/redeem", Map.of("token", token)));
        List<MvcResult> results = race(calls);
        assertThat(results.stream().filter(r -> status(r) == 200).count()).isEqualTo(1);
        assertThat(results.stream().filter(r -> status(r) != 200).allMatch(r -> status(r) == 404)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid", Long.class, circle)).isEqualTo(2);

        // 同一个人用两个邀请码并发加入：主键保证只有一条成员记录。6.1C 起在籍后的再次兑换是幂等的，
        // 因此两个请求都返回 200，但只有一个邀请码被消耗、名额只占一个
        User twice = api.register();
        String t1 = api.inviteToken(owner, circle);
        String t2 = api.inviteToken(owner, circle);
        List<MvcResult> both = race(() -> api.post(twice, "/v1/circle-invites/redeem", Map.of("token", t1)),
                () -> api.post(twice, "/v1/circle-invites/redeem", Map.of("token", t2)));
        assertThat(both.stream().allMatch(r -> status(r) == 200)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_invites WHERE circle_id=?::uuid AND redeemed_by=?::uuid", Long.class, circle, twice.id()))
                .as("只消耗一个邀请码").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND user_id=?::uuid", Long.class, circle, twice.id())).isEqualTo(1);
    }

    @Test
    @DisplayName("5. OWNER 转让 × 受让人退出、以及并发转让给两个人：任何交错下都恰好一个在籍 OWNER，且与 circles.owner_user_id 一致")
    void ownerRules() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "转让竞态 " + round, "PRIVATE");
            User heir = api.register();
            User other = api.register();
            api.join(owner, circle, heir);
            api.join(owner, circle, other);
            List<MvcResult> results = race(
                    () -> api.patch(owner, "/v1/circles/" + circle + "/members/" + heir.id(), Map.of("role", "OWNER")),
                    () -> api.delete(heir, "/v1/circles/" + circle + "/members/" + heir.id()),
                    () -> api.patch(owner, "/v1/circles/" + circle + "/members/" + other.id(), Map.of("role", "OWNER")));
            for (MvcResult r : results) assertThat(status(r)).isIn(200, 403, 404, 409);
            assertSingleOwner(circle);
        }
    }

    @Test
    @DisplayName("6. 批量发布 × 发布者的成员资格失效：整批要么全部发布（移除在其后），要么全部回滚；不会有一部分商品挂在圈子里")
    void batchVsRemoval() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "批量竞态 " + round, "PRIVATE");
            User seller = api.register();
            api.join(owner, circle, seller);
            List<String> ids = new ArrayList<>();
            for (int i = 1; i <= 5; i++) {
                Map<String, Object> p = single("生活用品", "批量竞态 " + round + "-" + i, 10 + i);
                p.put("visibility", "CIRCLE_ONLY");
                p.put("circleIds", List.of(circle));
                ids.add(api.createDraft(seller, "SINGLE", p).path("id").asText());
            }
            String batch = api.ok(api.post(seller, "/v1/listing-batches", Map.of("draftIds", ids))).path("id").asText();
            List<MvcResult> results = race(
                    () -> api.publish(seller, batch, "race-batch-key-" + round + "-" + UUID.randomUUID()),
                    () -> api.delete(owner, "/v1/circles/" + circle + "/members/" + seller.id()));
            assertThat(status(results.get(1))).isEqualTo(200);
            long published = jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE ?", Long.class, "批量竞态 " + round + "-%");
            assertThat(published).as("第 %d 轮：全有或全无", round).isIn(0L, 5L);
            assertThat(status(results.get(0)) == 200).isEqualTo(published == 5);
            if (published == 5) {
                assertThat(jdbc.queryForObject("SELECT count(*) FROM products p JOIN product_circle_visibility v ON v.product_id = p.id "
                        + "JOIN circle_memberships m ON m.circle_id = v.circle_id AND m.user_id = p.seller_id "
                        + "WHERE p.title LIKE ? AND m.ended_at < p.created_at", Long.class, "批量竞态 " + round + "-%")).isZero();
            }
        }
    }

    @Test
    @DisplayName("7. 创建圈子订阅 × 成员移除：结束后被移除的人没有任何启用中的圈子订阅")
    void subscriptionVsRemoval() throws Exception {
        for (int n = 0; n < ROUNDS; n++) {
            final int round = n;
            User owner = api.register();
            String circle = api.createCircle(owner, "订阅竞态 " + round, "PRIVATE");
            User member = api.register();
            api.join(owner, circle, member);
            List<MvcResult> results = race(
                    () -> api.post(member, "/v1/demand-subscriptions", Map.of("keyword", "竞态台灯 " + round, "circleId", circle)),
                    () -> api.delete(owner, "/v1/circles/" + circle + "/members/" + member.id()));
            assertThat(status(results.get(1))).isEqualTo(200);
            assertThat(status(results.get(0))).isIn(200, 404);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE user_id=?::uuid AND circle_id=?::uuid AND active",
                    Long.class, member.id(), circle)).as("第 %d 轮", round).isZero();
        }
    }

    // ------------------------------------------------------------------

    private void assertSingleOwner(String circle) {
        List<String> owners = jdbc.queryForList("SELECT user_id::text FROM circle_memberships WHERE circle_id=?::uuid AND role='OWNER' AND status='ACTIVE'",
                String.class, circle);
        assertThat(owners).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT owner_user_id::text FROM circles WHERE id=?::uuid", String.class, circle)).isEqualTo(owners.get(0));
    }

    private Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return b;
    }

    @SafeVarargs
    private static List<MvcResult> race(Callable<MvcResult>... calls) throws Exception {
        return race(List.of(calls));
    }

    private static List<MvcResult> race(List<Callable<MvcResult>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<MvcResult>> futures = new ArrayList<>();
            for (Callable<MvcResult> call : calls) futures.add(pool.submit(() -> { start.await(); return call.call(); }));
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }
}
