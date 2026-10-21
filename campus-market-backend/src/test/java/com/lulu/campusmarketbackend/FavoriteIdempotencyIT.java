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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * 收藏接口幂等性测试（R-08 / 0.7C）。
 *
 * <p>改造前 {@code PUT /v1/products/{id}/favorite} 是 toggle：第一次 PUT 收藏、
 * 第二次相同 PUT 取消收藏。这违反 HTTP PUT 的幂等语义——网络重试、用户双击
 * 或传输层重发都会把刚加上的收藏删掉。
 *
 * <p>改造后 PUT 只负责「保证已收藏」（依赖 favorites 表的 UNIQUE(user_id,product_id)
 * 配合 ON CONFLICT DO NOTHING），DELETE 只负责「保证未收藏」，两者重复调用结果都不变。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FavoriteIdempotencyIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String TEST_DB = "campus_market_fav";
    private static final String TEST_USER = "campus_fav";
    private static final String TEST_PASSWORD = "campus_fav_only";
    private static final String CAMPUS = "东校区";
    private static final String ACCOUNT_PASSWORD = "test-password-2026";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName(TEST_DB).withUsername(TEST_USER).withPassword(TEST_PASSWORD);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "favorite-idempotency-it-secret-0123456789");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JdbcTemplate jdbc;

    @Test
    @DisplayName("1. PUT 一次后存在；重复 PUT 仍只有一行且保持已收藏")
    void putIsIdempotent() throws Exception {
        Actor owner = register("fav-owner");
        Actor user = register("fav-user");
        String productId = publishProduct(owner);

        MvcResult first = mockMvc.perform(authorized(put(favoritePath(productId)), user)).andReturn();
        assertThat(first.getResponse().getStatus()).isEqualTo(200);
        assertThat(activeOf(first)).isTrue();
        assertThat(favoriteRows(user.id(), productId)).isEqualTo(1);

        // 关键回归：改造前这一次会把收藏删掉
        for (int i = 0; i < 3; i++) {
            MvcResult again = mockMvc.perform(authorized(put(favoritePath(productId)), user)).andReturn();
            assertThat(again.getResponse().getStatus()).isEqualTo(200);
            assertThat(activeOf(again)).as("重复 PUT 必须仍返回已收藏").isTrue();
            assertThat(favoriteRows(user.id(), productId)).as("重复 PUT 不得改变行数").isEqualTo(1);
        }
    }

    @Test
    @DisplayName("2. DELETE 一次后不存在；重复 DELETE 仍保持未收藏")
    void deleteIsIdempotent() throws Exception {
        Actor owner = register("del-owner");
        Actor user = register("del-user");
        String productId = publishProduct(owner);

        mockMvc.perform(authorized(put(favoritePath(productId)), user)).andReturn();
        assertThat(favoriteRows(user.id(), productId)).isEqualTo(1);

        for (int i = 0; i < 3; i++) {
            MvcResult result = mockMvc.perform(authorized(delete(favoritePath(productId)), user)).andReturn();
            assertThat(result.getResponse().getStatus()).isEqualTo(200);
            assertThat(activeOf(result)).as("重复 DELETE 必须仍返回未收藏").isFalse();
            assertThat(favoriteRows(user.id(), productId)).isZero();
        }
    }

    @Test
    @DisplayName("3. 10 个并发 PUT 后数据库只有一行，且无 5xx")
    void concurrentPutCreatesExactlyOneRow() throws Exception {
        Actor owner = register("cc-owner");
        Actor user = register("cc-user");
        String productId = publishProduct(owner);

        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return mockMvc.perform(authorized(put(favoritePath(productId)), user))
                            .andReturn().getResponse().getStatus();
                }));
            }
            gate.countDown();
            for (Future<Integer> f : futures) {
                assertThat(f.get(60, TimeUnit.SECONDS)).as("并发 PUT 不得出现 5xx").isEqualTo(200);
            }
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(favoriteRows(user.id(), productId))
                .as("UNIQUE(user_id,product_id) + ON CONFLICT DO NOTHING 保证只有一行").isEqualTo(1);
    }

    @Test
    @DisplayName("4. 用户之间互不影响；收藏列表只返回自己的记录")
    void usersAreIsolated() throws Exception {
        Actor owner = register("iso-owner");
        Actor a = register("iso-a");
        Actor b = register("iso-b");
        String productId = publishProduct(owner);

        mockMvc.perform(authorized(put(favoritePath(productId)), a)).andReturn();
        mockMvc.perform(authorized(put(favoritePath(productId)), b)).andReturn();
        assertThat(favoriteRows(a.id(), productId)).isEqualTo(1);
        assertThat(favoriteRows(b.id(), productId)).isEqualTo(1);

        // A 取消不影响 B
        mockMvc.perform(authorized(delete(favoritePath(productId)), a)).andReturn();
        assertThat(favoriteRows(a.id(), productId)).isZero();
        assertThat(favoriteRows(b.id(), productId)).as("B 的收藏不受影响").isEqualTo(1);

        List<JsonNode> bList = favoriteList(b);
        assertThat(bList).hasSize(1);
        assertThat(bList.get(0).path("userId").asText()).isEqualTo(b.id());
        assertThat(favoriteList(a)).as("A 的列表应为空").isEmpty();
    }

    @Test
    @DisplayName("5. 未认证 401；不存在的商品 404")
    void authAndNotFoundContracts() throws Exception {
        Actor owner = register("nf-owner");
        Actor user = register("nf-user");
        String productId = publishProduct(owner);

        assertThat(mockMvc.perform(put(favoritePath(productId))).andReturn().getResponse().getStatus())
                .as("未认证 PUT").isEqualTo(401);
        assertThat(mockMvc.perform(delete(favoritePath(productId))).andReturn().getResponse().getStatus())
                .as("未认证 DELETE").isEqualTo(401);

        String missing = UUID.randomUUID().toString();
        assertThat(mockMvc.perform(authorized(put(favoritePath(missing)), user))
                .andReturn().getResponse().getStatus()).as("商品不存在 PUT").isEqualTo(404);
        assertThat(mockMvc.perform(authorized(delete(favoritePath(missing)), user))
                .andReturn().getResponse().getStatus()).as("商品不存在 DELETE").isEqualTo(404);
    }

    // ==================================================================

    private record Actor(String id, String token) {}

    private static String favoritePath(String productId) {
        return "/v1/products/" + productId + "/favorite";
    }

    private boolean activeOf(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("active").asBoolean();
    }

    private int favoriteRows(String userId, String productId) {
        Integer v = jdbc.queryForObject(
                "SELECT count(*) FROM favorites WHERE user_id = ?::uuid AND product_id = ?::uuid",
                Integer.class, userId, productId);
        return v == null ? -1 : v;
    }

    private List<JsonNode> favoriteList(Actor actor) throws Exception {
        MvcResult result = mockMvc.perform(authorized(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/v1/favorites"), actor))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        List<JsonNode> list = new ArrayList<>();
        objectMapper.readTree(result.getResponse().getContentAsString()).path("data").forEach(list::add);
        return list;
    }

    private Actor register(String role) throws Exception {
        String account = role.replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("account", account);
        body.put("password", ACCOUNT_PASSWORD);
        body.put("nickname", role);
        body.put("campus", CAMPUS);
        body.put("contact", "13800000000");
        MvcResult result = mockMvc.perform(post("/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Actor(data.path("user").path("id").asText(), data.path("accessToken").asText());
    }

    private String publishProduct(Actor seller) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "收藏幂等测试商品");
        body.put("description", "由 FavoriteIdempotencyIT 创建");
        body.put("price", 12.00);
        body.put("category", "生活用品");
        // 模块 3：受支持分类的新商品必须附带完整验货声明
        body.put("inspection", com.lulu.campusmarketbackend.support.InspectionFixtures.fullDisclosure("生活用品"));
        body.put("condition", "全新");
        body.put("campus", CAMPUS);
        body.put("images", List.of("https://example.invalid/test.png"));
        body.put("contact", "13800000001");
        MvcResult result = mockMvc.perform(authorized(post("/v1/products"), seller)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText();
    }

    private static MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder b, Actor a) {
        return b.header("Authorization", "Bearer " + a.token());
    }
}
