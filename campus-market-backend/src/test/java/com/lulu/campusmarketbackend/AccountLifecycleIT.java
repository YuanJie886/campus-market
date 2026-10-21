package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.junit.jupiter.api.extension.ExtendWith;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 阶段 3：账号生命周期——修改密码、工作人员协助的一次性重置码、注销、微信登录（code2session 用本机桩服务器，不访问微信）。
 */
@Testcontainers
@SpringBootTest(properties = "campus-market.rate-limit.password-reset.limit=12")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class AccountLifecycleIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    private static final String APP_ID = "wx-test-app";
    private static final String APP_SECRET = "wechat-secret-for-tests-only";
    /** 桩服务器收到的查询串（用来断言服务端确实带了 AppID / AppSecret / code，而它们从不出现在响应或日志里）。 */
    static final List<String> WECHAT_QUERIES = new CopyOnWriteArrayList<>();
    static final HttpServer WECHAT = startWechatStub();

    private static HttpServer startWechatStub() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/sns/jscode2session", exchange -> {
                String query = exchange.getRequestURI().getRawQuery();
                WECHAT_QUERIES.add(query);
                String code = query.replaceAll(".*js_code=([^&]*).*", "$1");
                String body = code.startsWith("valid-")
                        ? "{\"openid\":\"openid-" + code.substring(6) + "\",\"session_key\":\"session-key-never-stored\"}"
                        : "{\"errcode\":40029,\"errmsg\":\"invalid code\"}";
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @AfterAll static void stopStub() { WECHAT.stop(0); }

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("campus-market.wechat.app-id", () -> APP_ID);
        registry.add("campus-market.wechat.app-secret", () -> APP_SECRET);
        registry.add("campus-market.wechat.api-base", () -> "http://127.0.0.1:" + WECHAT.getAddress().getPort());
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private String accountOf(User user) {
        return jdbc.queryForObject("SELECT account FROM users WHERE id=?::uuid", String.class, user.id());
    }
    private MvcResult login(String account, String password) throws Exception {
        return api.post(null, "/v1/auth/login", Map.of("account", account, "password", password));
    }
    private User loginAs(String account, String password) throws Exception {
        JsonNode d = api.ok(login(account, password));
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }
    private User staff(String role) throws Exception {
        User user = api.register();
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?::uuid,'pilot',?)", user.id(), role);
        return user;
    }

    // ================= 修改密码 =================

    @Test void changingPasswordEndsOtherSessionsButKeepsTheCurrentOne() throws Exception {
        User first = api.register();
        String account = accountOf(first);
        User second = loginAs(account, "test-password-2026");
        assertThat(status(api.post(first, "/v1/auth/password", Map.of("currentPassword", "wrong-password", "newPassword", "new-password-2026"))))
                .isEqualTo(400);
        assertThat(status(api.post(first, "/v1/auth/password", Map.of("currentPassword", "test-password-2026", "newPassword", "test-password-2026"))))
                .as("新旧相同").isEqualTo(400);
        assertThat(status(api.post(first, "/v1/auth/password", Map.of("currentPassword", "test-password-2026", "newPassword", "short"))))
                .as("至少 8 位").isEqualTo(400);
        assertThat(status(api.post(first, "/v1/auth/password", Map.of("currentPassword", "test-password-2026", "newPassword", "new-password-2026", "userId", second.id()))))
                .as("未知字段").isEqualTo(400);
        JsonNode changed = api.ok(api.post(first, "/v1/auth/password", Map.of("currentPassword", "test-password-2026", "newPassword", "new-password-2026")));
        assertThat(changed.path("otherSessionsEnded").asInt()).isEqualTo(1);
        assertThat(status(api.get(second, "/v1/auth/me"))).as("其他设备立即失效").isEqualTo(401);
        assertThat(status(api.get(first, "/v1/auth/me"))).as("当前会话保留").isEqualTo(200);
        assertThat(status(login(account, "test-password-2026"))).isEqualTo(401);
        assertThat(status(login(account, "new-password-2026"))).isEqualTo(200);
        assertThat(status(api.post(null, "/v1/auth/password", Map.of("currentPassword", "x", "newPassword", "y-password")))).isEqualTo(401);
    }

    // ================= 人工找回 =================

    @Test void schoolAdminIssuesAOneTimeResetCodeThatIsStoredOnlyAsAHash() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), moderator = staff("MODERATOR"), user = api.register();
        String account = accountOf(user);
        assertThat(status(api.post(moderator, "/v1/admin/users/" + user.id() + "/password-reset", Map.of("note", "线下核对学生证")))).isEqualTo(403);
        assertThat(status(api.post(admin, "/v1/admin/users/" + admin.id() + "/password-reset", Map.of("note", "线下核对学生证")))).as("不能给自己签发").isEqualTo(403);
        assertThat(status(api.post(admin, "/v1/admin/users/" + user.id() + "/password-reset", Map.of()))).as("必须写明核对依据").isEqualTo(400);
        JsonNode first = api.ok(api.post(admin, "/v1/admin/users/" + user.id() + "/password-reset", Map.of("note", "线下核对学生证")));
        String oldCode = first.path("code").asText();
        assertThat(oldCode).matches("[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM password_reset_tickets WHERE code_hash LIKE ? OR note LIKE ?", Integer.class,
                "%" + oldCode + "%", "%" + oldCode + "%")).as("库里只有哈希").isZero();
        JsonNode second = api.ok(api.post(admin, "/v1/admin/users/" + user.id() + "/password-reset", Map.of("note", "第一张重置码遗失，重新签发")));
        String code = second.path("code").asText();
        assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", oldCode, "newPassword", "reset-password-2026"))))
                .as("重新签发后旧码作废").isEqualTo(400);

        MvcResult unknown = api.post(null, "/v1/auth/password-reset", Map.of("account", "no-such-account", "code", code, "newPassword", "reset-password-2026"));
        MvcResult wrong = api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", "AAAA-AAAA-AAAA", "newPassword", "reset-password-2026"));
        assertThat(api.body(unknown).path("message").asText()).as("不透露账号是否存在").isEqualTo(api.body(wrong).path("message").asText());

        JsonNode done = api.ok(api.post(null, "/v1/auth/password-reset",
                Map.of("account", account, "code", code.toLowerCase().replace("-", ""), "newPassword", "reset-password-2026")));
        assertThat(done.path("reset").asBoolean()).isTrue();
        assertThat(status(api.get(user, "/v1/auth/me"))).as("全部会话结束").isEqualTo(401);
        assertThat(status(login(account, "reset-password-2026"))).isEqualTo(200);
        assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", code, "newPassword", "again-password-2026"))))
                .as("只能用一次").isEqualTo(400);
        assertThatThrownBy(() -> jdbc.update("UPDATE password_reset_tickets SET used_at=NULL WHERE user_id=?::uuid", user.id()))
                .isInstanceOf(DataAccessException.class);
    }

    @Test void aResetCodeDiesAfterFiveWrongAttemptsAndExpiredCodesNeverWork() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), user = api.register(), late = api.register();
        String account = accountOf(user);
        String code = api.ok(api.post(admin, "/v1/admin/users/" + user.id() + "/password-reset", Map.of("note", "线下核对"))).path("code").asText();
        for (int i = 0; i < 5; i++) {
            assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", "BBBB-BBBB-BBBB", "newPassword", "reset-password-2026"))))
                    .isEqualTo(400);
        }
        assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", code, "newPassword", "reset-password-2026"))))
                .as("5 次错误后正确的码也失效").isEqualTo(400);
        assertThat(status(login(account, "test-password-2026"))).isEqualTo(200);

        String lateCode = "CCCC-DDDD-EEEE";
        jdbc.update("INSERT INTO password_reset_tickets(id,user_id,school_id,issued_by,code_hash,note,request_id,created_at,expires_at) "
                + "VALUES (gen_random_uuid(),?::uuid,'pilot',?::uuid,encode(sha256(convert_to('CCCCDDDDEEEE','UTF8')),'hex'),'过期','r',"
                + "now() - interval '40 minutes', now() - interval '10 minutes')", late.id(), admin.id());
        assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", accountOf(late), "code", lateCode, "newPassword", "reset-password-2026"))))
                .isEqualTo(400);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO password_reset_tickets(id,user_id,school_id,issued_by,code_hash,note,request_id,expires_at) "
                + "VALUES (gen_random_uuid(),?::uuid,'pilot',?::uuid,repeat('a',64),'太长','r',now() + interval '2 hours')", late.id(), admin.id()))
                .as("有效期不超过 30 分钟（数据库约束）").isInstanceOf(DataAccessException.class);
    }

    @Test void resetAttemptsAreRateLimitedPerAccount() throws Exception {
        User user = api.register();
        String account = accountOf(user);
        for (int i = 0; i < 12; i++) {
            assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", "ZZZZ-ZZZZ-ZZZZ", "newPassword", "reset-password-2026"))))
                    .isEqualTo(400);
        }
        assertThat(status(api.post(null, "/v1/auth/password-reset", Map.of("account", account, "code", "ZZZZ-ZZZZ-ZZZZ", "newPassword", "reset-password-2026"))))
                .isEqualTo(429);
    }

    // ================= 注销 =================

    @Test void deletingAnAccountAnonymisesItAndClosesEverythingItOwned(CapturedOutput output) throws Exception {
        User me = api.register(), seller = api.register(), buyer = api.register(), other = api.register(), owner = api.register();
        String account = accountOf(me);
        String onSale = api.ok(api.post(me, "/v1/products", SupplyApi.single("其他", "注销前在售", 10))).path("id").asText();
        String sold = api.ok(api.post(me, "/v1/products", SupplyApi.single("其他", "注销前已售", 10))).path("id").asText();
        api.ok(api.post(me, "/v1/products/" + sold + "/status", Map.of("status", "已售出")));
        String theirs = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "别人的商品", 10))).path("id").asText();
        String outgoing = api.requestContact(me, theirs);
        String incomingPending = api.requestContact(buyer, onSale);
        String incomingApproved = api.approvedContact(me, other, onSale);
        String circle = api.createCircle(owner, "注销测试圈", "PRIVATE");
        api.join(owner, circle, me);
        String myCircle = api.createCircle(me, "我的圈子", "PRIVATE");

        assertThat(status(api.post(me, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "注销")))).isEqualTo(400);
        assertThat(status(api.post(me, "/v1/auth/me/deletion", Map.of("password", "wrong-password", "confirmation", "确认注销")))).isEqualTo(400);
        MvcResult owning = api.post(me, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "确认注销"));
        assertThat(status(owning)).as("仍是在用圈子的所有者").isEqualTo(409);
        api.ok(api.post(me, "/v1/circles/" + myCircle + "/archive", Map.of()));
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?::uuid,'pilot','MODERATOR')", me.id());
        assertThat(status(api.post(me, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "确认注销")))).as("仍有后台权限").isEqualTo(409);
        jdbc.update("UPDATE staff_members SET active=false WHERE user_id=?::uuid", me.id());

        MvcResult deleted = api.post(me, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "确认注销"));
        assertThat(status(deleted)).isEqualTo(200);
        assertThat(deleted.getResponse().getHeader("Set-Cookie")).contains("cm_refresh=;").contains("Max-Age=0");
        JsonNode summary = api.data(deleted);
        assertThat(summary.path("productsTakenDown").asInt()).isEqualTo(1);
        assertThat(summary.path("requestsClosed").asInt()).isEqualTo(3);
        assertThat(summary.path("membershipsEnded").asInt()).isEqualTo(1);

        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, onSale)).isEqualTo("已下架");
        assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, sold)).isEqualTo("已售出");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE seller_id=?::uuid AND contact<>''", Integer.class, me.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid", String.class, outgoing)).isEqualTo("WITHDRAWN");
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid", String.class, incomingPending)).isEqualTo("REJECTED");
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid", String.class, incomingApproved)).isEqualTo("REVOKED");
        assertThat(jdbc.queryForObject("SELECT status FROM circle_memberships WHERE circle_id=?::uuid AND user_id=?::uuid", String.class, circle, me.id()))
                .isEqualTo("LEFT");
        Map<String, Object> row = jdbc.queryForMap("SELECT account, nickname, contact, avatar, deleted_at FROM users WHERE id=?::uuid", me.id());
        assertThat(row.get("account")).isEqualTo("deleted-" + me.id());
        assertThat(row.get("nickname")).isEqualTo("已注销用户");
        assertThat(row.get("contact")).isEqualTo("");
        assertThat(row.get("deleted_at")).isNotNull();
        assertThat(status(api.get(me, "/v1/auth/me"))).isEqualTo(401);
        assertThat(status(login(account, "test-password-2026"))).isEqualTo(401);
        assertThat(api.ok(api.get(other, "/v1/users/" + me.id())).path("nickname").asText()).isEqualTo("已注销用户");
        Map<String, Object> audit = jdbc.queryForMap("SELECT * FROM account_deletions WHERE user_id=?::uuid", me.id());
        assertThat(audit.toString()).doesNotContain(account).doesNotContain("13800000000");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?::uuid,'pilot','AUDITOR') "
                + "ON CONFLICT (user_id) DO UPDATE SET active=true, role='AUDITOR'", me.id())).as("已注销的账号不能再获得后台权限")
                .isInstanceOf(DataAccessException.class);
        assertThat(status(api.post(null, "/v1/auth/register", Map.of("account", account, "password", "test-password-2026", "nickname", "新同学", "campus", "东校区"))))
                .as("原账号名可以重新注册").isEqualTo(200);
        assertThat(output.getAll()).doesNotContain("test-password-2026");
    }

    // ================= 微信登录 =================

    @Test void wechatLoginBindsAnOpenidToAnExistingAccountWithoutLeakingSecrets(CapturedOutput output) throws Exception {
        User me = api.register(), someoneElse = api.register();
        assertThat(api.ok(api.get(null, "/v1/auth/wechat")).path("enabled").asBoolean()).isTrue();
        assertThat(status(api.post(null, "/v1/auth/wechat/login", Map.of("code", "expired-code")))).isEqualTo(400);
        assertThat(status(api.post(null, "/v1/auth/wechat/login", Map.of("code", "bad code!")))).as("格式不对的凭证不会发给微信").isEqualTo(400);
        String openid = UUID.randomUUID().toString().replace("-", "");
        JsonNode first = api.ok(api.post(null, "/v1/auth/wechat/login", Map.of("code", "valid-" + openid)));
        assertThat(first.path("bound").asBoolean()).isFalse();
        assertThat(first.has("accessToken")).isFalse();
        String ticket = first.path("bindTicket").asText();
        assertThat(ticket).hasSize(64);
        assertThat(status(api.post(null, "/v1/auth/wechat/bind", Map.of("bindTicket", ticket)))).as("绑定需要先用账号登录").isEqualTo(401);
        assertThat(api.ok(api.post(me, "/v1/auth/wechat/bind", Map.of("bindTicket", ticket))).path("bound").asBoolean()).isTrue();
        assertThat(status(api.post(someoneElse, "/v1/auth/wechat/bind", Map.of("bindTicket", ticket)))).as("票据只能用一次").isEqualTo(400);
        assertThat(api.ok(api.get(me, "/v1/auth/wechat")).path("bound").asBoolean()).isTrue();

        MvcResult again = api.post(null, "/v1/auth/wechat/login", Map.of("code", "valid-" + openid));
        JsonNode session = api.ok(again);
        assertThat(session.path("bound").asBoolean()).isTrue();
        assertThat(session.path("user").path("id").asText()).isEqualTo(me.id());
        assertThat(again.getResponse().getHeader("Set-Cookie")).contains("cm_refresh=").contains("HttpOnly");
        assertThat(status(api.get(new User(me.id(), session.path("accessToken").asText()), "/v1/auth/me"))).isEqualTo(200);

        String secondTicket = api.ok(api.post(null, "/v1/auth/wechat/login", Map.of("code", "valid-" + openid + "x"))).path("bindTicket").asText();
        assertThat(status(api.post(me, "/v1/auth/wechat/bind", Map.of("bindTicket", secondTicket)))).as("一个账号只绑一个微信").isEqualTo(409);
        String thirdTicket = api.ok(api.post(null, "/v1/auth/wechat/login", Map.of("code", "valid-" + openid + "y"))).path("bindTicket").asText();
        api.ok(api.post(someoneElse, "/v1/auth/wechat/bind", Map.of("bindTicket", thirdTicket)));
        assertThatThrownBy(() -> jdbc.update("INSERT INTO user_wechat_identities(user_id,app_id,openid) VALUES (?::uuid,?,?)", api.register().id(), APP_ID, "openid-" + openid))
                .as("同一 openid 只能绑定一个账号").isInstanceOf(DataAccessException.class);

        assertThat(api.ok(api.post(me, "/v1/auth/wechat/unbind", Map.of())).path("bound").asBoolean()).isFalse();
        assertThat(api.ok(api.post(null, "/v1/auth/wechat/login", Map.of("code", "valid-" + openid))).path("bound").asBoolean()).isFalse();

        assertThat(WECHAT_QUERIES).anyMatch(q -> q.contains("appid=" + APP_ID) && q.contains("secret=" + APP_SECRET) && q.contains("grant_type=authorization_code"));
        assertThat(WECHAT_QUERIES).noneMatch(q -> q.contains("bad"));
        assertThat(jdbc.queryForList("SELECT * FROM user_wechat_identities").toString()).doesNotContain("session-key");
        assertThat(output.getAll()).doesNotContain(APP_SECRET).doesNotContain("session-key-never-stored").doesNotContain("valid-" + openid);
    }
}
