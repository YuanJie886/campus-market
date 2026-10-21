package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
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

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/** 阶段 4：文本内容安全——关键词过滤（始终生效）与微信 msg_sec_check（已绑定微信的用户；本机桩服务器）。 */
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class ContentSafetyIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final AtomicInteger TOKEN_REQUESTS = new AtomicInteger();
    static final HttpServer WECHAT = stub();

    private static void reply(HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static HttpServer stub() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/sns/jscode2session", exchange -> {
                String code = exchange.getRequestURI().getRawQuery().replaceAll(".*js_code=([^&]*).*", "$1");
                reply(exchange, "{\"openid\":\"openid-" + code + "\",\"session_key\":\"sk\"}");
            });
            server.createContext("/cgi-bin/token", exchange -> {
                TOKEN_REQUESTS.incrementAndGet();
                reply(exchange, "{\"access_token\":\"stub-access-token\",\"expires_in\":7200}");
            });
            server.createContext("/wxa/msg_sec_check", exchange -> {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                if (body.contains("微信故障")) { reply(exchange, "{\"errcode\":-1,\"errmsg\":\"system error\"}"); return; }
                String suggest = body.contains("高风险内容") ? "risky" : body.contains("待复核内容") ? "review" : "pass";
                reply(exchange, "{\"errcode\":0,\"result\":{\"suggest\":\"" + suggest + "\",\"label\":" + ("pass".equals(suggest) ? 100 : 20002) + "}}");
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @AfterAll static void stop() { WECHAT.stop(0); }

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("campus-market.wechat.app-id", () -> "wx-safety-test");
        registry.add("campus-market.wechat.app-secret", () -> "safety-secret-for-tests");
        registry.add("campus-market.wechat.api-base", () -> "http://127.0.0.1:" + WECHAT.getAddress().getPort());
        // REWRITTEN：私信默认只能发快捷消息（不做内容安全）；这里打开自由文字开关，继续验证私信自由文字的内容安全检查
        registry.add("campus-market.messages.free-text-enabled", () -> "true");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private User wechatBound() throws Exception {
        User user = api.register();
        String ticket = api.ok(api.post(null, "/v1/auth/wechat/login", Map.of("code", "c" + UUID.randomUUID().toString().replace("-", "")))).path("bindTicket").asText();
        api.ok(api.post(user, "/v1/auth/wechat/bind", Map.of("bindTicket", ticket)));
        return user;
    }

    private Map<String, Object> product(String title, String description) {
        Map<String, Object> body = SupplyApi.single("其他", title, 20);
        body.put("description", description);
        return body;
    }

    private List<Map<String, Object>> events(User user) {
        return jdbc.queryForList("SELECT scene, provider, verdict, label, text_sha256 FROM content_safety_events WHERE user_id=?::uuid ORDER BY id", UUID.fromString(user.id()));
    }

    @Test void keywordFilterBlocksProhibitedTradesEvenWhenSplitAndRecordsNoRawText(CapturedOutput output) throws Exception {
        User seller = api.register(), buyer = api.register();
        MvcResult blocked = api.post(seller, "/v1/products", product("四级代 - 考 包过", "保证通过，私聊"));
        assertThat(status(blocked)).isEqualTo(400);
        assertThat(api.body(blocked).path("message").asText()).isEqualTo("内容可能包含违规信息，请修改后再提交");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE seller_id=?::uuid", Integer.class, seller.id())).isZero();
        assertThat(status(api.post(seller, "/v1/products", product("宿舍台灯", "出售管制刀具一把")))).as("描述同样检查").isEqualTo(400);

        String ok = api.ok(api.post(seller, "/v1/products", product("大麻袋收纳箱", "宿舍搬家用的结实收纳袋，九成新"))).path("id").asText();
        assertThat(status(api.patch(seller, "/v1/products/" + ok, Map.of("title", "出售 迷药")))).as("编辑同样检查").isEqualTo(400);
        assertThat(status(api.post(buyer, "/v1/products/" + ok + "/comments", Map.of("content", "收不收银行卡出售？")))).isEqualTo(400);
        String conversation = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", ok))).path("id").asText();
        assertThat(status(api.post(buyer, "/v1/conversations/" + conversation + "/messages", Map.of("content", "要不要网赌，带你赚钱")))).isEqualTo(400);
        assertThat(status(api.post(buyer, "/v1/conversations/" + conversation + "/messages", Map.of("content", "今晚七点宿舍楼下可以看看吗？")))).isEqualTo(200);
        assertThat(status(api.patch(buyer, "/v1/auth/me", Map.of("nickname", "代考专业户")))).isEqualTo(400);
        assertThat(status(api.post(null, "/v1/auth/register", Map.of("account", "safety" + UUID.randomUUID().toString().substring(0, 8),
                "password", "test-password-2026", "nickname", "办证找我", "campus", "东校区")))).as("注册昵称只做关键词过滤").isEqualTo(400);

        List<Map<String, Object>> sellerEvents = events(seller);
        assertThat(sellerEvents).hasSize(3);
        assertThat(sellerEvents).allMatch(e -> "KEYWORD".equals(e.get("provider")) && "BLOCKED".equals(e.get("verdict")));
        assertThat(events(buyer)).extracting(e -> e.get("scene")).containsExactly("COMMENT", "MESSAGE", "PROFILE");
        assertThat(jdbc.queryForList("SELECT * FROM content_safety_events").toString()).doesNotContain("代").doesNotContain("迷药").doesNotContain("网赌");
        assertThat(output.getAll()).doesNotContain("网赌").doesNotContain("银行卡出售");
    }

    /** 圈子名称 / 简介（创建与修改）与教材建议的自由文本：同一套检查、同一句提示；正常文本照常通过；事件不存原文。 */
    @Test void circlesAndTextbookSuggestionsUseTheSameCheck() throws Exception {
        User owner = api.register();
        String blockedMessage = "内容可能包含违规信息，请修改后再提交";
        Map<String, Object> circle = new java.util.LinkedHashMap<>(Map.of("type", "CLUB", "name", "代 考互助群", "description", "一起复习", "visibility", "DISCOVERABLE"));
        MvcResult blockedName = api.post(owner, "/v1/circles", circle);
        assertThat(status(blockedName)).isEqualTo(400);
        assertThat(api.body(blockedName).path("message").asText()).isEqualTo(blockedMessage);
        circle.put("name", "考研资料交流");
        circle.put("description", "群里出售管制刀具");
        assertThat(api.body(api.post(owner, "/v1/circles", circle)).path("message").asText()).as("简介同样检查").isEqualTo(blockedMessage);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM circles WHERE owner_user_id=?::uuid", Integer.class, UUID.fromString(owner.id()))).isZero();

        circle.put("description", "一起分享笔记和二手教材");
        String circleId = api.ok(api.post(owner, "/v1/circles", circle)).path("id").asText();
        assertThat(api.body(api.patch(owner, "/v1/circles/" + circleId, Map.of("name", "办证交流群"))).path("message").asText()).as("修改名称同样检查").isEqualTo(blockedMessage);
        assertThat(status(api.patch(owner, "/v1/circles/" + circleId, Map.of("description", "收购银行卡，价格好说")))).as("修改简介同样检查").isEqualTo(400);
        Map<String, Object> stored = jdbc.queryForMap("SELECT name, description FROM circles WHERE id=?::uuid", UUID.fromString(circleId));
        assertThat(stored).containsEntry("name", "考研资料交流").containsEntry("description", "一起分享笔记和二手教材");
        assertThat(api.ok(api.patch(owner, "/v1/circles/" + circleId, Map.of("name", "考研资料交流（东区）", "description", "每周六自习室见"))).path("name").asText())
                .as("正常修改通过").isEqualTo("考研资料交流（东区）");

        Map<String, Object> suggestion = new java.util.LinkedHashMap<>(Map.of("courseOfferingId", "demo-programming-2026a",
                "title", "论文代写速成", "publisher", "演示出版社", "editionLabel", "第 1 版"));
        MvcResult blockedTitle = api.post(owner, "/v1/textbook-suggestions", suggestion);
        assertThat(status(blockedTitle)).isEqualTo(400);
        assertThat(api.body(blockedTitle).path("message").asText()).isEqualTo(blockedMessage);
        suggestion.put("title", "程序设计基础");
        suggestion.put("note", "群里有四六级答案");
        assertThat(api.body(api.post(owner, "/v1/textbook-suggestions", suggestion)).path("message").asText()).as("备注同样检查").isEqualTo(blockedMessage);
        suggestion.put("note", "老师第一节课推荐的参考书");
        assertThat(api.ok(api.post(owner, "/v1/textbook-suggestions", suggestion)).path("outcome").asText()).as("正常建议通过").isEqualTo("CREATED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_suggestions WHERE submitter_id=?::uuid", Integer.class, UUID.fromString(owner.id()))).isEqualTo(1);

        assertThat(events(owner)).extracting(e -> e.get("scene"))
                .containsExactly("CIRCLE", "CIRCLE", "CIRCLE", "CIRCLE", "TEXTBOOK_SUGGESTION", "TEXTBOOK_SUGGESTION");
        assertThat(events(owner)).allMatch(e -> "KEYWORD".equals(e.get("provider")) && "BLOCKED".equals(e.get("verdict")));
        assertThat(jdbc.queryForList("SELECT * FROM content_safety_events WHERE user_id=?::uuid", UUID.fromString(owner.id())).toString())
                .doesNotContain("代").doesNotContain("管制刀具").doesNotContain("办证").doesNotContain("银行卡").doesNotContain("论文").doesNotContain("答案");
    }

    @Test void wechatCheckBlocksRiskyAllowsReviewAndFailsOpenForBoundUsers() throws Exception {
        User bound = wechatBound(), unbound = api.register();
        int tokensBefore = TOKEN_REQUESTS.get();
        MvcResult risky = api.post(bound, "/v1/products", product("普通商品", "这是一段高风险内容"));
        assertThat(status(risky)).isEqualTo(400);
        assertThat(status(api.post(bound, "/v1/products", product("普通商品二", "这是一段待复核内容")))).as("待复核放行").isEqualTo(200);
        assertThat(status(api.post(bound, "/v1/products", product("普通商品三", "微信故障时的正常描述")))).as("微信不可用时放行").isEqualTo(200);
        assertThat(status(api.post(bound, "/v1/products", product("普通商品四", "完全正常的描述")))).isEqualTo(200);
        assertThat(events(bound)).extracting(e -> e.get("provider") + ":" + e.get("verdict")).containsExactly("WECHAT:BLOCKED", "WECHAT:REVIEW");
        assertThat(events(bound).get(0).get("label")).isEqualTo("wechat-20002");
        assertThat(TOKEN_REQUESTS.get() - tokensBefore).as("调用凭证被缓存").isLessThanOrEqualTo(1);
        assertThat(status(api.post(unbound, "/v1/products", product("普通商品五", "这是一段高风险内容")))).as("未绑定微信的用户只有关键词过滤").isEqualTo(200);
        assertThat(events(unbound)).isEmpty();
    }
}
