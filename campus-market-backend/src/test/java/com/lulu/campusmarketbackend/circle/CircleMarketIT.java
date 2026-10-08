package com.lulu.campusmarketbackend.circle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 模块 6：圈子集市的 HTTP 行为测试（真实 PostgreSQL 16）。覆盖权限矩阵、可见性攻击面上的每一个入口、
 * 订单参与者例外、圈子订阅与隐私边界。源码扫描只在前端作补充，这里全部是接口行为。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.circle-invite-redeem.limit=6",
        "campus-market.rate-limit.circle-create.limit=100",
        "campus-market.rate-limit.circle-invite-create.limit=200",
        "campus-market.rate-limit.price-guidance.limit=100",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class CircleMarketIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_circle")
            .withUsername("campus_circle").withPassword("campus_circle_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "circle-market-it-secret-0123456789abc");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    // ==================================================================
    // 圈子与权限矩阵
    // ==================================================================

    @Nested
    @DisplayName("6.4 圈子与权限")
    class Circles {

        @Test
        @DisplayName("1. 创建：学校由登录用户推导；固定「用户创建」；official / ownerId / schoolId / status / role 等服务端字段一律 400；名称长度与尖括号 400")
        void create() throws Exception {
            User owner = api.register();
            JsonNode c = api.ok(api.post(owner, "/v1/circles", Map.of("type", "CLASS", "name", "2023 级软工 2 班", "visibility", "PRIVATE")));
            assertThat(c.path("userCreated").asBoolean()).isTrue();
            assertThat(c.path("myRole").asText()).isEqualTo("OWNER");
            assertThat(c.has("official")).isFalse();
            assertThat(jdbc.queryForObject("SELECT school_id FROM circles WHERE id=?::uuid", String.class, c.path("id").asText())).isEqualTo("pilot");
            for (String field : List.of("official", "ownerId", "ownerUserId", "schoolId", "status", "role", "id")) {
                Map<String, Object> b = new LinkedHashMap<>(Map.of("type", "CLUB", "name", "字段 " + field));
                b.put(field, field.equals("official") ? true : "evil");
                MvcResult r = api.post(owner, "/v1/circles", b);
                assertThat(status(r)).as(field).isEqualTo(400);
                assertThat(api.body(r).path("requestId").asText()).isNotBlank();
            }
            assertThat(status(api.post(owner, "/v1/circles", Map.of("type", "DORM", "name", "宿舍圈")))).as("没有宿舍圈类型").isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/circles", Map.of("type", "CLUB", "name", "x")))).isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/circles", Map.of("type", "CLUB", "name", "<b>社团</b>")))).isEqualTo(400);
            assertThat(status(api.post(owner, "/v1/circles", Map.of("type", "CLUB", "name", "a".repeat(31))))).isEqualTo(400);
            assertThat(status(mockMvc.perform(get("/v1/circles/mine")).andReturn())).as("需要登录").isEqualTo(401);
        }

        @Test
        @DisplayName("2. PRIVATE 圈子对非成员不可枚举：详情 / 成员 / 邀请 / 商品流一律与不存在相同的 404；也不出现在发现列表")
        void privateNotEnumerable() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "私密读书会", "PRIVATE");
            User stranger = api.register();
            String fake = UUID.randomUUID().toString();
            for (String path : List.of("", "/members", "/invites", "/products")) {
                MvcResult real = api.get(stranger, "/v1/circles/" + circle + path);
                MvcResult none = api.get(stranger, "/v1/circles/" + fake + path);
                assertThat(status(real)).as(path).isEqualTo(404);
                assertThat(api.body(real).path("message").asText()).as(path).isEqualTo(api.body(none).path("message").asText());
                assertThat(real.getResponse().getContentAsString()).doesNotContain("私密读书会");
            }
            assertThat(api.ok(api.get(stranger, "/v1/circles/discover")).toString()).doesNotContain(circle).doesNotContain("私密读书会");
            assertThat(status(api.post(stranger, "/v1/circles/" + circle + "/invites", Map.of()))).isEqualTo(404);
        }

        @Test
        @DisplayName("3. DISCOVERABLE：非成员只看到名称 / 简介 / 类型 / 用户创建标识，没有所有者、人数或成员；他校用户 404")
        void discoverable() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "摄影爱好者", "DISCOVERABLE");
            User stranger = api.register();
            JsonNode found = null;
            for (JsonNode c : api.ok(api.get(stranger, "/v1/circles/discover?q=摄影"))) if (circle.equals(c.path("id").asText())) found = c;
            assertThat(found).isNotNull();
            assertThat(fieldNames(found)).containsExactlyInAnyOrder("id", "type", "name", "description", "userCreated", "joined");
            JsonNode detail = api.ok(api.get(stranger, "/v1/circles/" + circle));
            assertThat(fieldNames(detail)).containsExactlyInAnyOrder("id", "type", "name", "description", "userCreated", "joined");
            assertThat(detail.toString()).doesNotContain(owner.id());
            assertThat(status(api.get(stranger, "/v1/circles/" + circle + "/members"))).isEqualTo(404);
            assertThat(status(api.get(stranger, "/v1/circles/" + circle + "/products"))).isEqualTo(404);

            User foreign = otherSchoolUser();
            assertThat(status(api.get(foreign, "/v1/circles/" + circle))).isEqualTo(404);
            assertThat(api.ok(api.get(foreign, "/v1/circles/discover")).toString()).doesNotContain(circle);
        }

        @Test
        @DisplayName("4. 成员名单：普通成员 403；OWNER / MODERATOR 只拿到昵称 / 头像 / 角色 / 加入时间，没有账号、联系方式或宿舍楼")
        void memberList() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "羽毛球社", "PRIVATE");
            User member = api.register();
            api.join(owner, circle, member);
            jdbc.update("UPDATE users SET dorm_building_id='east-qinyuan-1' WHERE id=?::uuid", member.id());
            assertThat(status(api.get(member, "/v1/circles/" + circle + "/members"))).isEqualTo(403);
            JsonNode page = api.ok(api.get(owner, "/v1/circles/" + circle + "/members"));
            assertThat(fieldNames(page)).containsExactly("items", "total", "page", "size");
            JsonNode members = page.path("items");
            assertThat(members).hasSize(2);
            for (JsonNode m : members) assertThat(fieldNames(m)).containsExactlyInAnyOrder("userId", "nickname", "avatar", "role", "joinedAt");
            assertThat(members.toString()).doesNotContain("13800000000").doesNotContain("east-qinyuan-1").doesNotContain("\"account\"");
            api.ok(api.patch(owner, "/v1/circles/" + circle + "/members/" + member.id(), Map.of("role", "MODERATOR")));
            assertThat(api.ok(api.get(member, "/v1/circles/" + circle + "/members")).path("items")).hasSize(2);
        }

        @Test
        @DisplayName("5. 角色规则：OWNER 不能直接退出；MODERATOR 不能移除 OWNER 或 MODERATOR；MEMBER 不能管理；转让后恰好一个 OWNER；审计完整")
        void roleRules() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "辩论社", "PRIVATE");
            User mod = api.register();
            User mod2 = api.register();
            User member = api.register();
            User member2 = api.register();
            for (User u : List.of(mod, mod2, member, member2)) api.join(owner, circle, u);
            api.ok(api.patch(owner, "/v1/circles/" + circle + "/members/" + mod.id(), Map.of("role", "MODERATOR")));
            api.ok(api.patch(owner, "/v1/circles/" + circle + "/members/" + mod2.id(), Map.of("role", "MODERATOR")));

            assertThat(status(api.delete(owner, "/v1/circles/" + circle + "/members/" + owner.id()))).as("OWNER 不能直接退出").isEqualTo(409);
            assertThat(status(api.delete(mod, "/v1/circles/" + circle + "/members/" + owner.id()))).isEqualTo(403);
            assertThat(status(api.delete(mod, "/v1/circles/" + circle + "/members/" + mod2.id()))).isEqualTo(403);
            assertThat(status(api.delete(member, "/v1/circles/" + circle + "/members/" + member2.id()))).isEqualTo(403);
            assertThat(status(api.patch(mod, "/v1/circles/" + circle + "/members/" + member.id(), Map.of("role", "MODERATOR")))).isEqualTo(403);
            assertThat(status(api.patch(mod, "/v1/circles/" + circle, Map.of("visibility", "DISCOVERABLE")))).isEqualTo(403);
            assertThat(status(api.patch(member, "/v1/circles/" + circle, Map.of("name", "改名")))).isEqualTo(403);
            assertThat(status(api.patch(owner, "/v1/circles/" + circle, Map.of("ownerId", mod.id())))).isEqualTo(400);

            assertThat(api.ok(api.delete(mod, "/v1/circles/" + circle + "/members/" + member2.id())).path("status").asText()).isEqualTo("REMOVED");
            assertThat(api.ok(api.delete(member, "/v1/circles/" + circle + "/members/" + member.id())).path("status").asText()).isEqualTo("LEFT");

            api.ok(api.patch(owner, "/v1/circles/" + circle + "/members/" + mod.id(), Map.of("role", "OWNER")));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND role='OWNER' AND status='ACTIVE'", Integer.class, circle)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT owner_user_id::text FROM circles WHERE id=?::uuid", String.class, circle)).isEqualTo(mod.id());
            assertThat(api.ok(api.delete(owner, "/v1/circles/" + circle + "/members/" + owner.id())).path("status").asText()).as("转让后原所有者可以退出").isEqualTo("LEFT");
            List<String> events = jdbc.queryForList("SELECT event_code FROM circle_events WHERE circle_id=?::uuid ORDER BY seq", String.class, circle);
            assertThat(events).contains("CIRCLE_CREATED", "MEMBER_JOINED", "ROLE_CHANGED", "MEMBER_REMOVED", "MEMBER_LEFT", "OWNER_TRANSFERRED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid", Integer.class, circle)).as("退出与移除保留记录").isEqualTo(5);
        }

        @Test
        @DisplayName("6. 邀请：原始邀请码只返回一次、只存哈希、一次性；已使用 / 撤销 / 过期 / 不存在 / 他校统一 404；限流 429；日志不含邀请码与成员")
        void invites(CapturedOutput output) throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "邀请测试社", "PRIVATE");
            JsonNode created = api.ok(api.post(owner, "/v1/circles/" + circle + "/invites", Map.of()));
            String token = created.path("token").asText();
            assertThat(token).matches("[A-Za-z0-9_-]{43}");
            Map<String, Object> row = jdbc.queryForMap("SELECT * FROM circle_invites WHERE id=?::uuid", created.path("invite").path("id").asText());
            assertThat(row.get("token_hash")).isEqualTo(sha256(token));
            assertThat(row.values().stream().map(String::valueOf).noneMatch(v -> v.contains(token))).isTrue();
            assertThat(api.ok(api.get(owner, "/v1/circles/" + circle + "/invites")).toString()).doesNotContain(token);
            long hours = Math.round((created.path("invite").path("expiresAt").asLong() - created.path("invite").path("createdAt").asLong()) / 3_600_000.0);
            assertThat(hours).isEqualTo(24);
            assertThat(status(api.post(owner, "/v1/circles/" + circle + "/invites", Map.of("expiresInHours", 169)))).isEqualTo(400);

            User joiner = api.register();
            api.ok(api.post(joiner, "/v1/circle-invites/redeem", Map.of("token", token)));
            String message = api.body(api.post(api.register(), "/v1/circle-invites/redeem", Map.of("token", token))).path("message").asText();
            String revoked = api.inviteToken(owner, circle);
            String revokedId = jdbc.queryForObject("SELECT id::text FROM circle_invites WHERE token_hash=?", String.class, sha256(revoked));
            api.ok(api.post(owner, "/v1/circle-invites/" + revokedId + "/revoke", Map.of()));
            String expired = api.inviteToken(owner, circle);
            jdbc.update("UPDATE circle_invites SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash=?", sha256(expired));
            String foreignToken = api.inviteToken(owner, circle);
            for (Map.Entry<String, User> attempt : List.of(Map.entry(revoked, api.register()), Map.entry(expired, api.register()),
                    Map.entry("x".repeat(43), api.register()), Map.entry(foreignToken, otherSchoolUser()))) {
                MvcResult r = api.post(attempt.getValue(), "/v1/circle-invites/redeem", Map.of("token", attempt.getKey()));
                assertThat(status(r)).isEqualTo(404);
                assertThat(api.body(r).path("message").asText()).isEqualTo(message);
            }
            // 6.1C：已在籍的人再次兑换是幂等的——返回圈子，但不消耗邀请码、不占名额
            String spare = api.inviteToken(owner, circle);
            long seats = jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND status='ACTIVE'", Long.class, circle);
            assertThat(status(api.post(joiner, "/v1/circle-invites/redeem", Map.of("token", spare)))).as("已在籍").isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM circle_memberships WHERE circle_id=?::uuid AND status='ACTIVE'", Long.class, circle)).isEqualTo(seats);
            assertThat(jdbc.queryForObject("SELECT status FROM circle_invites WHERE token_hash=?", String.class, sha256(spare))).as("邀请码未被消耗").isEqualTo("PENDING");

            User guesser = api.register();
            MvcResult last = null;
            for (int i = 0; i < 7; i++) last = api.post(guesser, "/v1/circle-invites/redeem", Map.of("token", "guess-" + i));
            assertThat(status(last)).isEqualTo(429);
            assertThat(last.getResponse().getHeader("Retry-After")).matches("[1-9][0-9]*");
            assertThat(api.body(last).path("requestId").asText()).isNotBlank();
            // 7.1D：原兑换者重放（返回 200、不改变任何状态）同样计入限流，限流没有因为幂等而放宽
            User replayer = api.register();
            String own = api.inviteToken(owner, circle);
            assertThat(status(api.post(replayer, "/v1/circle-invites/redeem", Map.of("token", own)))).isEqualTo(200);
            java.util.List<Integer> replays = new java.util.ArrayList<>();
            for (int i = 0; i < 6; i++) replays.add(status(api.post(replayer, "/v1/circle-invites/redeem", Map.of("token", own))));
            assertThat(replays.subList(0, 5)).as("限额内的重放都是 200").containsOnly(200);
            assertThat(replays.get(5)).as("第 7 次尝试（含首次兑换）超过 6 次限额").isEqualTo(429);
            assertThat(output.getAll()).doesNotContain(token).doesNotContain(revoked).doesNotContain(own).doesNotContain("邀请测试社");
        }

        @Test
        @DisplayName("7. 归档：只有所有者；归档后不能再发布或邀请；成员看到归档状态，圈子商品对成员不再可见")
        void archive() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "将要归档", "PRIVATE");
            User member = api.register();
            api.join(owner, circle, member);
            String product = api.circleProduct(owner, "归档前的圈子商品", circle);
            assertThat(status(api.get(member, "/v1/products/" + product))).isEqualTo(200);
            assertThat(status(api.post(member, "/v1/circles/" + circle + "/archive", Map.of()))).isEqualTo(403);
            assertThat(api.ok(api.post(owner, "/v1/circles/" + circle + "/archive", Map.of())).path("status").asText()).isEqualTo("ARCHIVED");
            assertThat(status(api.get(member, "/v1/products/" + product))).isEqualTo(404);
            assertThat(status(api.get(owner, "/v1/products/" + product))).as("卖家本人仍可见").isEqualTo(200);
            assertThat(status(api.post(owner, "/v1/circles/" + circle + "/invites", Map.of()))).isEqualTo(409);
            Map<String, Object> b = single("生活用品", "归档后发布", 10);
            b.put("visibility", "CIRCLE_ONLY");
            b.put("circleIds", List.of(circle));
            assertThat(status(api.post(owner, "/v1/products", b))).isEqualTo(404);
            assertThat(api.ok(api.get(member, "/v1/circles/" + circle)).path("status").asText()).isEqualTo("ARCHIVED");
        }
    }

    // ==================================================================
    // 圈子商品与全部读取入口
    // ==================================================================

    @Nested
    @DisplayName("6.5 / 6.6 圈子商品的可见性")
    class Visibility {

        @Test
        @DisplayName("8. 发布：默认 PUBLIC；圈子可见需 1～5 个圈子、卖家在籍、同校；PUBLIC 不接受圈子；打包商品同样支持")
        void publishRules() throws Exception {
            User seller = api.register();
            List<String> mine = new ArrayList<>();
            for (int i = 0; i < 6; i++) mine.add(api.createCircle(seller, "发布测试圈 " + i, "PRIVATE"));
            assertThat(api.ok(api.post(seller, "/v1/products", single("生活用品", "默认公开", 10))).path("visibility").asText()).isEqualTo("PUBLIC");
            Map<String, Object> b = single("生活用品", "圈子商品", 10);
            b.put("visibility", "CIRCLE_ONLY");
            assertThat(status(api.post(seller, "/v1/products", b))).as("没有选圈子").isEqualTo(400);
            b.put("circleIds", mine);
            assertThat(status(api.post(seller, "/v1/products", b))).as("超过 5 个").isEqualTo(400);
            b.put("circleIds", List.of(mine.get(0), mine.get(0)));
            assertThat(status(api.post(seller, "/v1/products", b))).as("重复").isEqualTo(400);
            User other = api.register();
            String notMine = api.createCircle(other, "别人的圈子", "DISCOVERABLE");
            b.put("circleIds", List.of(mine.get(0), notMine));
            assertThat(status(api.post(seller, "/v1/products", b))).as("不是成员").isEqualTo(404);
            b.put("circleIds", mine.subList(0, 5));
            JsonNode ok = api.ok(api.post(seller, "/v1/products", b));
            assertThat(ok.path("visibility").asText()).isEqualTo("CIRCLE_ONLY");
            assertThat(ok.path("circles")).hasSize(5);
            Map<String, Object> pub = single("生活用品", "公开却带圈子", 10);
            pub.put("circleIds", List.of(mine.get(0)));
            assertThat(status(api.post(seller, "/v1/products", pub))).isEqualTo(400);

            Map<String, Object> bundle = SupplyApi.bundle("圈子整套", 60, 3);
            bundle.put("visibility", "CIRCLE_ONLY");
            bundle.put("circleIds", List.of(mine.get(1)));
            String bundleId = api.ok(api.post(seller, "/v1/products", bundle)).path("id").asText();
            assertThat(status(api.get(api.register(), "/v1/products/" + bundleId))).as("非成员看不到整套详情").isEqualTo(404);
        }

        @Test
        @DisplayName("9. 非成员在每个入口都看不到私密商品：列表 / 搜索 / feed / 计数 / 详情 / 分享链接 / 浏览 / 收藏 / 评论 / 会话 / 教材商品流；成员与卖家看得到；PUBLIC 行为不变")
        void everyEntryPoint() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "全入口测试圈", "PRIVATE");
            User member = api.register();
            api.join(seller, circle, member);
            User stranger = api.register();
            String tag = "入口" + UUID.randomUUID().toString().substring(0, 6);
            String secret = api.circleProduct(seller, tag + " 私密", circle);
            String open = api.ok(api.post(seller, "/v1/products", single("生活用品", tag + " 公开", 10))).path("id").asText();
            Map<String, Object> book = single("教材书籍", tag + " 私密教材", 20);
            book.put("textbookEditionId", "demo-calculus-8");
            book.put("visibility", "CIRCLE_ONLY");
            book.put("circleIds", List.of(circle));
            String secretBook = api.ok(api.post(seller, "/v1/products", book)).path("id").asText();

            for (User viewer : List.of(stranger, member)) {
                boolean sees = viewer == member;
                JsonNode list = api.ok(api.get(viewer, "/v1/products?keyword=" + tag));
                assertThat(ids(list.path("items")).contains(secret)).isEqualTo(sees);
                assertThat(list.path("total").asInt()).as("搜索总数").isEqualTo(sees ? 3 : 1);
                JsonNode feed = api.ok(api.get(viewer, "/v1/products/feed?keyword=" + tag + "&scope=SCHOOL"));
                assertThat(ids(feed.path("items")).contains(secret)).isEqualTo(sees);
                assertThat(feed.path("total").asInt()).isEqualTo(sees ? 3 : 1);
                assertThat(status(api.get(viewer, "/v1/products/" + secret))).isEqualTo(sees ? 200 : 404);
                assertThat(status(api.post(viewer, "/v1/products/" + secret + "/view", Map.of()))).isEqualTo(sees ? 200 : 404);
                assertThat(status(api.put(viewer, "/v1/products/" + secret + "/favorite", Map.of()))).isEqualTo(sees ? 200 : 404);
                assertThat(status(api.get(viewer, "/v1/products/" + secret + "/comments"))).isEqualTo(sees ? 200 : 404);
                assertThat(status(api.post(viewer, "/v1/products/" + secret + "/comments", Map.of("content", "还在吗")))).isEqualTo(sees ? 200 : 404);
                assertThat(status(api.post(viewer, "/v1/conversations", Map.of("productId", secret)))).isEqualTo(sees ? 200 : 404);
                JsonNode textbook = api.ok(api.get(viewer, "/v1/textbooks/demo-calculus-8"));
                assertThat(ids(textbook.path("listings")).contains(secretBook)).isEqualTo(sees);
            }
            // 与不存在的商品完全相同的响应，不能用来判断私密商品是否存在
            MvcResult hidden = api.get(stranger, "/v1/products/" + secret);
            MvcResult missing = api.get(stranger, "/v1/products/" + UUID.randomUUID());
            assertThat(api.body(hidden).path("message").asText()).isEqualTo(api.body(missing).path("message").asText());
            assertThat(hidden.getResponse().getContentAsString()).doesNotContain(tag);
            // 6.1A 起未登录不能读取任何商品：公开与私密商品都是同一个 401，不形成侧信道
            assertThat(status(mockMvc.perform(get("/v1/products?keyword=" + tag)).andReturn())).isEqualTo(401);
            assertThat(status(mockMvc.perform(get("/v1/products/" + open)).andReturn())).isEqualTo(401);
            assertThat(status(mockMvc.perform(get("/v1/products/" + secret)).andReturn())).isEqualTo(401);
            // 卖家本人
            assertThat(api.ok(api.get(seller, "/v1/products?keyword=" + tag)).path("total").asInt()).isEqualTo(3);
        }

        @Test
        @DisplayName("10. 圈子标签只对有权查看者显示，且只列出查看者自己也在籍的圈子；圈子商品流只给成员")
        void circleLabels() throws Exception {
            User seller = api.register();
            String a = api.createCircle(seller, "标签圈 A", "PRIVATE");
            String b = api.createCircle(seller, "标签圈 B", "PRIVATE");
            User onlyA = api.register();
            api.join(seller, a, onlyA);
            String product = api.circleProduct(seller, "两个圈子都可见", a, b);
            JsonNode forSeller = api.ok(api.get(seller, "/v1/products/" + product));
            assertThat(forSeller.path("circles")).hasSize(2);
            JsonNode forMember = api.ok(api.get(onlyA, "/v1/products/" + product));
            assertThat(forMember.path("circles")).hasSize(1);
            assertThat(forMember.toString()).contains("标签圈 A").doesNotContain("标签圈 B").doesNotContain(b);
            JsonNode feed = api.ok(api.get(onlyA, "/v1/circles/" + a + "/products"));
            assertThat(ids(feed.path("items"))).containsExactly(product);
            assertThat(status(api.get(onlyA, "/v1/circles/" + b + "/products"))).isEqualTo(404);
        }

        @Test
        @DisplayName("11. PUBLIC → CIRCLE_ONLY：非成员的收藏从列表消失、再收藏 404；未成交会话从列表消失、消息与未读都不再可见")
        void switchToCircleOnly() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "切换可见圈", "PRIVATE");
            String product = api.ok(api.post(seller, "/v1/products", single("生活用品", "先公开后私密", 10))).path("id").asText();
            User fan = api.register();
            api.ok(api.put(fan, "/v1/products/" + product + "/favorite", Map.of()));
            String conversation = api.ok(api.post(fan, "/v1/conversations", Map.of("productId", product))).path("id").asText();
            api.ok(api.post(seller, "/v1/conversations/" + conversation + "/messages", Map.of("content", "在的")));
            assertThat(api.ok(api.get(fan, "/v1/messages/unread")).path("count").asInt()).isEqualTo(1);

            api.ok(api.patch(seller, "/v1/products/" + product, Map.of("visibility", "CIRCLE_ONLY", "circleIds", List.of(circle))));
            assertThat(api.ok(api.get(fan, "/v1/favorites"))).isEmpty();
            assertThat(status(api.put(fan, "/v1/products/" + product + "/favorite", Map.of()))).isEqualTo(404);
            assertThat(api.ok(api.get(fan, "/v1/conversations"))).isEmpty();
            assertThat(status(api.get(fan, "/v1/conversations/" + conversation + "/messages"))).isEqualTo(404);
            assertThat(status(api.post(fan, "/v1/conversations/" + conversation + "/messages", Map.of("content", "?")))).isEqualTo(404);
            assertThat(api.ok(api.get(fan, "/v1/messages/unread")).path("count").asInt()).as("未读不形成侧信道").isZero();
            assertThat(api.ok(api.get(seller, "/v1/conversations")).toString()).as("卖家仍能看到自己的会话").contains(conversation);

            api.ok(api.patch(seller, "/v1/products/" + product, Map.of("visibility", "PUBLIC")));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM product_circle_visibility WHERE product_id=?::uuid", Integer.class, product)).isZero();
            assertThat(api.ok(api.get(fan, "/v1/favorites"))).hasSize(1);
        }

        @Test
        @DisplayName("12. 订单参与者例外：成员下单后被移出圈子，仍能查看这件商品并完成交易；但看不到卖家的其他圈子商品；非成员不能下单")
        void participantException() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "参与者例外圈", "PRIVATE");
            User buyer = api.register();
            api.join(seller, circle, buyer);
            String product = api.circleProduct(seller, "先下单后被移除", circle);
            String another = api.circleProduct(seller, "卖家的另一件圈子商品", circle);
            User stranger = api.register();
            assertThat(status(api.post(stranger, "/v1/orders", orderBody(product)))).as("非成员不能购买").isEqualTo(404);

            String orderId = api.order(buyer, product);
            api.ok(api.delete(seller, "/v1/circles/" + circle + "/members/" + buyer.id()));
            assertThat(status(api.get(buyer, "/v1/products/" + product))).as("订单参与者仍可读").isEqualTo(200);
            assertThat(status(api.get(buyer, "/v1/products/" + another))).as("不恢复对其他圈子商品的访问").isEqualTo(404);
            assertThat(ids(api.ok(api.get(buyer, "/v1/products?keyword=卖家的另一件")).path("items"))).isEmpty();
            api.ok(api.transition(seller, orderId, "PENDING_MEETING"));
            api.ok(api.submitAll(buyer, orderId, "MATCH"));
            api.ok(api.transition(buyer, orderId, "BUYER_CONFIRMED"));
            String code = jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, orderId);
            api.ok(api.post(seller, "/v1/orders/" + orderId + "/transitions", Map.of("to", "COMPLETED", "confirmationCode", code)));
            assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, product)).isEqualTo("已售出");
            assertThat(jdbc.queryForObject("SELECT visibility_snapshot FROM orders WHERE id=?::uuid", String.class, orderId)).isEqualTo("CIRCLE_ONLY");
        }
    }

    // ==================================================================
    // 需求订阅与价格参考
    // ==================================================================

    @Nested
    @DisplayName("6.3 圈子订阅")
    class Subscriptions {

        @Test
        @DisplayName("13. 普通全校订阅收不到私密商品；只有绑定同一圈子的在籍成员订阅会匹配；非成员不能创建圈子订阅")
        void matching() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "订阅测试圈", "PRIVATE");
            User member = api.register();
            api.join(seller, circle, member);
            String tag = "圈订" + UUID.randomUUID().toString().substring(0, 6);
            JsonNode sub = api.ok(api.post(member, "/v1/demand-subscriptions", Map.of("keyword", tag, "circleId", circle))).path("subscription");
            assertThat(sub.path("circle").path("name").asText()).isEqualTo("订阅测试圈");
            User publicWatcher = api.register();
            api.ok(api.post(publicWatcher, "/v1/demand-subscriptions", Map.of("keyword", tag, "geoScope", "SCHOOL")));
            User memberPublic = member;
            api.ok(api.post(memberPublic, "/v1/demand-subscriptions", Map.of("keyword", tag + " 全校", "geoScope", "SCHOOL")));
            User stranger = api.register();
            assertThat(status(api.post(stranger, "/v1/demand-subscriptions", Map.of("keyword", tag, "circleId", circle)))).isEqualTo(404);
            assertThat(status(api.post(member, "/v1/demand-subscriptions", Map.of("keyword", tag, "circleId", circle, "geoScope", "CAMPUS")))).isEqualTo(400);

            String secret = api.circleProduct(seller, tag + " 私密台灯", circle);
            String open = api.ok(api.post(seller, "/v1/products", single("生活用品", tag + " 公开台灯", 10))).path("id").asText();
            assertThat(inboxIds(publicWatcher)).as("普通订阅只收到公开商品").containsExactly(open);
            assertThat(inboxIds(member)).as("圈子订阅收到私密商品，公开商品由普通订阅匹配").contains(secret);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches m JOIN demand_subscriptions s ON s.id=m.subscription_id "
                    + "WHERE m.product_id=?::uuid AND s.circle_id IS NULL", Integer.class, secret)).as("私密商品不产生任何普通订阅匹配").isZero();
        }

        @Test
        @DisplayName("14. 退出 / 被移除后：圈子订阅停用、旧匹配失效、未读清零、收件箱不再出现私密商品；已停用的订阅不能在非成员状态下重新启用")
        void leaveCleansUp() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "退出清理圈", "PRIVATE");
            User member = api.register();
            api.join(seller, circle, member);
            String tag = "退订" + UUID.randomUUID().toString().substring(0, 6);
            String subId = api.ok(api.post(member, "/v1/demand-subscriptions", Map.of("keyword", tag, "circleId", circle))).path("subscription").path("id").asText();
            String secret = api.circleProduct(seller, tag + " 私密", circle);
            assertThat(api.ok(api.get(member, "/v1/demand-matches/unread-count")).path("count").asInt()).isEqualTo(1);
            api.ok(api.delete(member, "/v1/circles/" + circle + "/members/" + member.id()));
            assertThat(jdbc.queryForObject("SELECT active FROM demand_subscriptions WHERE id=?::uuid", Boolean.class, subId)).isFalse();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE subscription_id=?::uuid AND invalidated_at IS NULL", Integer.class, subId)).isZero();
            assertThat(api.ok(api.get(member, "/v1/demand-matches/unread-count")).path("count").asInt()).isZero();
            assertThat(api.ok(api.get(member, "/v1/demand-matches")).toString()).doesNotContain(secret).doesNotContain(tag);
            assertThat(status(api.patch(member, "/v1/demand-subscriptions/" + subId, Map.of("active", true)))).isEqualTo(404);
        }

        @Test
        @DisplayName("15. 公开价格参考排除圈子商品的成交（按订单的可见性快照）")
        void priceGuidanceExcludesCircleTrades() throws Exception {
            User seller = api.register();
            String circle = api.createCircle(seller, "价格隔离圈", "PRIVATE");
            User viewer = api.register();
            List<String> orders = new ArrayList<>();
            for (int i = 1; i <= 8; i++) {
                User buyer = api.register();
                api.join(seller, circle, buyer);
                Map<String, Object> b = single("运动户外", "圈内成交 " + i, 900 + i);
                b.put("visibility", "CIRCLE_ONLY");
                b.put("circleIds", List.of(circle));
                String product = api.ok(api.post(seller, "/v1/products", b)).path("id").asText();
                orders.add(api.complete(seller, buyer, product,
                        id -> jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, id)));
            }
            assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE id = ANY(?::uuid[]) AND visibility_snapshot='CIRCLE_ONLY' AND status='COMPLETED'",
                    Integer.class, (Object) orders.toArray(String[]::new))).isEqualTo(8);
            JsonNode g = api.ok(api.get(viewer, "/v1/price-guidance?category=运动户外"));
            assertThat(g.path("sufficient").asBoolean()).as("8 笔圈内成交都不进入公开统计").isFalse();
        }
    }

    // ==================================================================
    // 批量发布与协助发布
    // ==================================================================

    @Nested
    @DisplayName("6.5 批量发布与协助")
    class Batches {

        @Test
        @DisplayName("16. 批量发布逐项校验圈子（INVALID_CIRCLE）；发布期间有一件圈子权限失效，整批回滚；协助人不能替所有者选圈子")
        void batchAndAssist() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "批量发布圈", "PRIVATE");
            User other = api.register();
            String foreign = api.createCircle(other, "别人的批量圈", "PRIVATE");
            List<String> ids = new ArrayList<>();
            for (int i = 1; i <= 3; i++) {
                Map<String, Object> p = single("生活用品", "批量圈子 " + i, 10 + i);
                p.put("visibility", "CIRCLE_ONLY");
                p.put("circleIds", List.of(i == 2 ? foreign : circle));
                ids.add(api.createDraft(owner, "SINGLE", p).path("id").asText());
            }
            String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", ids))).path("id").asText();
            JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
            assertThat(detail.path("items").get(1).path("validation").path("code").asText()).isEqualTo("INVALID_CIRCLE");
            assertThat(status(api.publish(owner, batch, "circle-batch-key-1"))).isEqualTo(400);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE '批量圈子 %'", Integer.class)).isZero();

            Map<String, Object> fixed = single("生活用品", "批量圈子 2", 12);
            fixed.put("visibility", "CIRCLE_ONLY");
            fixed.put("circleIds", List.of(circle));
            api.ok(api.saveDraft(owner, ids.get(1), 1, fixed, null));
            // 校验通过之后、发布之前，所有者的成员资格失效（例如圈子被归档）：发布时加锁复核，整批回滚
            api.ok(api.post(owner, "/v1/circles/" + circle + "/archive", Map.of()));
            assertThat(status(api.publish(owner, batch, "circle-batch-key-2"))).isIn(400, 404);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE title LIKE '批量圈子 %'", Integer.class)).isZero();
            assertThat(api.ok(api.get(owner, "/v1/listing-batches/" + batch)).path("status").asText()).isEqualTo("OPEN");

            // 协助人：可见范围不在可整理的字段里
            String live = api.createCircle(owner, "协助测试圈", "PRIVATE");
            String draft = api.createDraft(owner, "SINGLE", single("生活用品", "协助不能改圈子", 10)).path("id").asText();
            JsonNode invite = api.ok(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft)));
            User helper = api.register();
            api.ok(api.post(helper, "/v1/listing-assist-invites/redeem", Map.of("token", invite.path("token").asText())));
            Map<String, Object> tamper = single("生活用品", "协助不能改圈子", 10);
            tamper.remove("contact");
            tamper.put("visibility", "CIRCLE_ONLY");
            tamper.put("circleIds", List.of(live));
            assertThat(status(api.saveDraft(helper, draft, 1, tamper, null))).isEqualTo(403);
        }
    }

    // ==================================================================
    // 隐私
    // ==================================================================

    @Nested
    @DisplayName("十 隐私")
    class Privacy {

        @Test
        @DisplayName("17. 用户公开履历与公共资料不展示圈子；我的圈子只含圈子资料与我的角色，不含其他成员")
        void publicProfile() throws Exception {
            User owner = api.register();
            String circle = api.createCircle(owner, "履历隐私圈", "PRIVATE");
            User member = api.register();
            api.join(owner, circle, member);
            assertThat(api.ok(api.get(member, "/v1/users/" + member.id() + "/trade-summary")).toString()).doesNotContain("履历隐私圈").doesNotContain(circle);
            assertThat(api.ok(api.get(api.register(), "/v1/users/" + member.id())).toString()).doesNotContain("履历隐私圈").doesNotContain(circle);
            JsonNode mine = api.ok(api.get(member, "/v1/circles/mine"));
            assertThat(mine.toString()).contains("履历隐私圈").doesNotContain(owner.id());
        }

        @Test
        @DisplayName("18. 一致性：每个查看者 × 每件商品，列表 / 搜索计数 / 详情 / 收藏 与权威 SQL 函数的结论完全一致")
        void consistencyMatrix() throws Exception {
            User seller = api.register();
            String a = api.createCircle(seller, "一致性 A", "PRIVATE");
            String b = api.createCircle(seller, "一致性 B", "DISCOVERABLE");
            User inA = api.register();
            api.join(seller, a, inA);
            User inB = api.register();
            api.join(seller, b, inB);
            User left = api.register();
            api.join(seller, a, left);
            api.ok(api.delete(left, "/v1/circles/" + a + "/members/" + left.id()));
            User nobody = api.register();
            String tag = "一致" + UUID.randomUUID().toString().substring(0, 6);
            List<String> products = List.of(
                    api.ok(api.post(seller, "/v1/products", single("生活用品", tag + " 公开", 10))).path("id").asText(),
                    api.circleProduct(seller, tag + " 仅 A", a),
                    api.circleProduct(seller, tag + " 仅 B", b),
                    api.circleProduct(seller, tag + " A 与 B", a, b));
            for (User viewer : List.of(seller, inA, inB, left, nobody)) {
                List<String> listed = ids(api.ok(api.get(viewer, "/v1/products?keyword=" + tag)).path("items"));
                long total = api.ok(api.get(viewer, "/v1/products?keyword=" + tag)).path("total").asLong();
                int expectedCount = 0;
                for (String product : products) {
                    boolean expected = Boolean.TRUE.equals(jdbc.queryForObject(
                            "SELECT product_visible_to(id, visibility, seller_id, ?::uuid) FROM products WHERE id=?::uuid", Boolean.class, viewer.id(), product));
                    if (expected) expectedCount++;
                    assertThat(listed.contains(product)).as("列表 %s", product).isEqualTo(expected);
                    assertThat(status(api.get(viewer, "/v1/products/" + product)) == 200).as("详情 %s", product).isEqualTo(expected);
                    if (viewer != seller) {
                        assertThat(status(api.put(viewer, "/v1/products/" + product + "/favorite", Map.of())) == 200).as("收藏 %s", product).isEqualTo(expected);
                    }
                }
                assertThat(total).isEqualTo(expectedCount);
                if (viewer != seller) assertThat(api.ok(api.get(viewer, "/v1/favorites"))).hasSize(expectedCount);
            }
        }
    }

    // ------------------------------------------------------------------

    private Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return b;
    }

    private List<String> inboxIds(User user) throws Exception {
        List<String> result = new ArrayList<>();
        for (JsonNode item : api.ok(api.get(user, "/v1/demand-matches")).path("items")) result.add(item.path("product").path("id").asText());
        return result;
    }

    private User otherSchoolUser() throws Exception {
        jdbc.update("INSERT INTO schools(id,name) VALUES ('circle-other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('圈子他校区','circle-other-school','圈子他校区') ON CONFLICT DO NOTHING");
        User u = api.register();
        jdbc.update("UPDATE users SET campus='圈子他校区' WHERE id=?::uuid", u.id());
        return u;
    }

    private static List<String> ids(JsonNode items) {
        List<String> result = new ArrayList<>();
        for (JsonNode item : items) result.add(item.path("id").asText());
        return result;
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private static String sha256(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }
}
