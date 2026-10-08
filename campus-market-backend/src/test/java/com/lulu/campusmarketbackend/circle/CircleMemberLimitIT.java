package com.lulu.campusmarketbackend.circle;

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

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 模块 6.1C：成员分页（默认 20、最大 100、稳定排序、total/page/size）与单圈 1000 人在籍上限
 * （含 OWNER；LEFT / REMOVED 不占名额；重新加入重新检查；已在籍的幂等兑换不占名额；并发兑换不超限）。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.circle-invite-redeem.limit=1000",
        "campus-market.rate-limit.circle-create.limit=100",
        "campus-market.rate-limit.circle-invite-create.limit=1000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CircleMemberLimitIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_members").withUsername("campus_members").withPassword("campus_members_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "circle-member-limit-it-secret-012345");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    /** 直接写库补足在籍成员（每条插入都经过 V10 的上限触发器）。 */
    private void fill(String circle, int n, String prefix) {
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) "
                + "SELECT gen_random_uuid(), ? || g, 'x', '成员' || g, '东校区' FROM generate_series(1, ?) g", prefix, n);
        jdbc.update("INSERT INTO circle_memberships(circle_id, user_id, school_id, role, joined_at) "
                + "SELECT ?::uuid, u.id, 'pilot', 'MEMBER', now() - (row_number() OVER (ORDER BY u.account)) * interval '1 second' "
                + "FROM users u WHERE u.account LIKE ? || '%'", circle, prefix);
    }

    private long active(String circle) {
        return jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND status='ACTIVE'", Long.class, circle);
    }

    private List<MvcResult> race(List<Callable<MvcResult>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<MvcResult>> futures = new ArrayList<>();
            for (Callable<MvcResult> c : calls) futures.add(pool.submit(() -> { start.await(); return c.call(); }));
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> f : futures) results.add(f.get());
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("1. 分页：默认 20、最大 100、越界 400；total/page/size；角色优先级 → 加入时间 → userId 的稳定排序；翻页无重复无遗漏")
    void pagination() throws Exception {
        User owner = api.register();
        String circle = api.createCircle(owner, "分页圈", "PRIVATE");
        fill(circle, 64, "page-" + circle.substring(0, 8) + "-");
        String moderator = jdbc.queryForObject("SELECT user_id::text FROM circle_memberships WHERE circle_id=?::uuid AND role='MEMBER' ORDER BY joined_at DESC LIMIT 1", String.class, circle);
        jdbc.update("UPDATE circle_memberships SET role='MODERATOR' WHERE circle_id=?::uuid AND user_id=?::uuid", circle, moderator);

        JsonNode first = api.ok(api.get(owner, "/v1/circles/" + circle + "/members"));
        assertThat(first.path("size").asInt()).isEqualTo(20);
        assertThat(first.path("page").asInt()).isEqualTo(1);
        assertThat(first.path("total").asLong()).isEqualTo(65);
        assertThat(first.path("items")).hasSize(20);
        assertThat(first.path("items").get(0).path("role").asText()).isEqualTo("OWNER");
        assertThat(first.path("items").get(1).path("userId").asText()).as("MODERATOR 排在所有 MEMBER 之前").isEqualTo(moderator);

        List<String> seen = new ArrayList<>();
        for (int page = 1; page <= 4; page++) {
            for (JsonNode m : api.ok(api.get(owner, "/v1/circles/" + circle + "/members?page=" + page + "&size=20")).path("items")) {
                seen.add(m.path("userId").asText());
                List<String> fields = new ArrayList<>();
                m.fieldNames().forEachRemaining(fields::add);
                assertThat(fields).containsExactlyInAnyOrder("userId", "nickname", "avatar", "role", "joinedAt");
            }
        }
        assertThat(seen).hasSize(65).doesNotHaveDuplicates();
        List<String> expected = jdbc.queryForList("SELECT user_id::text FROM circle_memberships WHERE circle_id=?::uuid AND status='ACTIVE' "
                + "ORDER BY circle_role_rank(role), joined_at, user_id", String.class, circle);
        assertThat(seen).as("与数据库排序逐条一致").isEqualTo(expected);

        assertThat(api.ok(api.get(owner, "/v1/circles/" + circle + "/members?size=100")).path("items")).hasSize(65);
        for (String bad : List.of("size=101", "size=0", "page=0", "page=abc")) {
            assertThat(status(api.get(owner, "/v1/circles/" + circle + "/members?" + bad))).as(bad).isEqualTo(400);
        }
        User member = api.register();
        api.join(owner, circle, member);
        assertThat(status(api.get(member, "/v1/circles/" + circle + "/members"))).as("普通成员").isEqualTo(403);
        assertThat(status(api.get(api.register(), "/v1/circles/" + circle + "/members"))).as("非成员").isEqualTo(404);
    }

    @Test
    @DisplayName("2. 上限 1000（含 OWNER）：满员 409 且邀请码不被消耗；退出后名额释放；重新加入重新检查；已在籍的幂等兑换不占名额；触发器兜底")
    void memberLimit() throws Exception {
        User owner = api.register();
        String circle = api.createCircle(owner, "满员圈", "PRIVATE");
        fill(circle, 998, "cap-" + circle.substring(0, 8) + "-");
        assertThat(active(circle)).isEqualTo(999);

        User last = api.register();
        api.join(owner, circle, last);
        assertThat(active(circle)).isEqualTo(1000);

        User late = api.register();
        String token = api.inviteToken(owner, circle);
        MvcResult full = api.post(late, "/v1/circle-invites/redeem", Map.of("token", token));
        assertThat(status(full)).isEqualTo(409);
        assertThat(jdbc.queryForObject("SELECT status FROM circle_invites WHERE circle_id=?::uuid AND redeemed_by IS NULL ORDER BY created_at DESC LIMIT 1", String.class, circle))
                .as("满员时邀请码不被消耗").isEqualTo("PENDING");
        assertThat(active(circle)).isEqualTo(1000);

        // 已在籍的人再次兑换：200，不占名额
        assertThat(status(api.post(last, "/v1/circle-invites/redeem", Map.of("token", api.inviteToken(owner, circle))))).isEqualTo(200);
        assertThat(active(circle)).isEqualTo(1000);

        // 有人退出后名额释放，同一个邀请码现在可以用
        api.ok(api.delete(last, "/v1/circles/" + circle + "/members/" + last.id()));
        assertThat(active(circle)).isEqualTo(999);
        assertThat(status(api.post(late, "/v1/circle-invites/redeem", Map.of("token", token)))).isEqualTo(200);
        assertThat(active(circle)).isEqualTo(1000);

        // LEFT 的人重新加入同样要检查上限
        MvcResult rejoin = api.post(last, "/v1/circle-invites/redeem", Map.of("token", api.inviteToken(owner, circle)));
        assertThat(status(rejoin)).isEqualTo(409);

        // 绕过接口直接写库也不能超过上限
        assertThatThrownBy(() -> jdbc.update("UPDATE circle_memberships SET status='ACTIVE', ended_at=NULL WHERE circle_id=?::uuid AND user_id=?::uuid", circle, last.id()))
                .isInstanceOf(DataAccessException.class);
        assertThat(active(circle)).isEqualTo(1000);
    }

    @Test
    @DisplayName("3. 并发：还剩 2 个名额时 6 人各持邀请码同时兑换，恰好 2 人成功、其余 409，在籍人数正好 1000")
    void concurrentRedeemRespectsLimit() throws Exception {
        User owner = api.register();
        String circle = api.createCircle(owner, "抢名额", "PRIVATE");
        fill(circle, 997, "race-" + circle.substring(0, 8) + "-");
        assertThat(active(circle)).isEqualTo(998);
        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            User u = api.register();
            String token = api.inviteToken(owner, circle);
            calls.add(() -> api.post(u, "/v1/circle-invites/redeem", Map.of("token", token)));
        }
        List<MvcResult> results = race(calls);
        assertThat(results.stream().filter(r -> status(r) == 200).count()).isEqualTo(2);
        assertThat(results.stream().filter(r -> status(r) != 200).allMatch(r -> status(r) == 409)).isTrue();
        assertThat(active(circle)).isEqualTo(1000);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_invites WHERE circle_id=?::uuid AND status='REDEEMED'", Long.class, circle))
                .as("只有成功的人消耗了邀请码").isEqualTo(2);
    }
}
