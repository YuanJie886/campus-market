package com.lulu.campusmarketbackend;

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
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 私信自由文字开关打开（campus-market.messages.free-text-enabled=true，即 MESSAGES_FREE_TEXT_ENABLED=true）：
 * {content} 与原来一样可以发送并做内容安全检查；快捷消息照常可用且不走内容安全；两者同时出现 400。
 *
 * <p>为证明快捷消息确实跳过内容安全，本类额外配置一份词表，把快捷消息 BUYER_STILL_AVAILABLE 的文案片段
 * 「这件还在吗」设为违禁词：同样的文字作为自由文字会被拦截，作为快捷消息照常发送。
 */
@Testcontainers
@SpringBootTest(properties = "campus-market.messages.free-text-enabled=true")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MessageFreeTextEnabledIT {
    static final String BLOCKED = "内容可能包含违规信息，请修改后再提交";

    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final Path KEYWORDS;
    static {
        try {
            KEYWORDS = Files.createTempFile("cm-message-keywords-", ".txt");
            Files.writeString(KEYWORDS, "# 测试专用：快捷消息文案的片段\n这件还在吗\n", StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("campus-market.content-safety.keywords-file", KEYWORDS::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    record Chat(User seller, User buyer, String conversation) {}

    private Chat chat() throws Exception {
        User seller = api.register(), buyer = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "自由文字测试商品", 20))).path("id").asText();
        String conversation = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", product))).path("id").asText();
        return new Chat(seller, buyer, conversation);
    }

    private MvcResult send(User who, String conversation, Object body) throws Exception {
        return api.post(who, "/v1/conversations/" + conversation + "/messages", body);
    }

    private long messageCount(String conversation) {
        return jdbc.queryForObject("SELECT count(*) FROM messages WHERE conversation_id=?::uuid", Long.class, conversation);
    }

    private List<String> messageEvents(User user) {
        return jdbc.queryForList("SELECT provider || ':' || verdict FROM content_safety_events WHERE user_id=?::uuid AND scene='MESSAGE' ORDER BY id",
                String.class, UUID.fromString(user.id()));
    }

    @Test
    @DisplayName("1. 开关打开：/v1/config 与 /v1/message-templates 都报告 freeTextEnabled=true，模板列表不变")
    void switchIsReported() throws Exception {
        assertThat(api.ok(api.get(null, "/v1/config")).path("messages").toString()).isEqualTo("{\"freeTextEnabled\":true}");
        JsonNode templates = api.ok(api.get(api.register(), "/v1/message-templates"));
        assertThat(templates.path("freeTextEnabled").asBoolean()).isTrue();
        assertThat(templates.path("templates")).hasSize(MessageTemplatesIT.EXPECTED.size());
        assertThat(templates.path("templates").get(0).path("code").asText()).isEqualTo("BUYER_STILL_AVAILABLE");
    }

    @Test
    @DisplayName("2. {content} 照常发送（双方都可以），templateCode=null；内容安全照常拦截且不落库")
    void freeTextWorksWithContentSafety() throws Exception {
        Chat c = chat();
        JsonNode created = api.ok(send(c.buyer(), c.conversation(), Map.of("content", "  今晚七点宿舍楼下可以看看吗？ ")));
        assertThat(created.path("content").asText()).as("与原来一样去掉首尾空白").isEqualTo("今晚七点宿舍楼下可以看看吗？");
        assertThat(created.has("templateCode")).isTrue();
        assertThat(created.path("templateCode").isNull()).isTrue();
        assertThat(jdbc.queryForObject("SELECT template_code FROM messages WHERE id=?::uuid", String.class, UUID.fromString(created.path("id").asText()))).isNull();
        assertThat(status(send(c.seller(), c.conversation(), Map.of("content", "可以的")))).isEqualTo(200);

        MvcResult blocked = send(c.buyer(), c.conversation(), Map.of("content", "要不要网赌，带你赚钱"));
        assertThat(status(blocked)).isEqualTo(400);
        assertThat(api.body(blocked).path("message").asText()).isEqualTo(BLOCKED);
        assertThat(messageEvents(c.buyer())).containsExactly("KEYWORD:BLOCKED");
        assertThat(status(send(c.buyer(), c.conversation(), Map.of("content", "")))).as("空正文仍然 400").isEqualTo(400);
        assertThat(messageCount(c.conversation())).isEqualTo(2);

        JsonNode list = api.ok(api.get(c.seller(), "/v1/conversations/" + c.conversation() + "/messages"));
        assertThat(list).hasSize(2);
        assertThat(list.get(0).path("templateCode").isNull()).isTrue();
        assertThat(list.get(1).path("content").asText()).isEqualTo("可以的");
        assertThat(list.get(1).path("templateCode").isNull()).isTrue();
    }

    @Test
    @DisplayName("3. 同时提交 content 与 templateCode → 400「只能二选一：快捷消息或文字」，不落库")
    void bothFieldsAreRejected() throws Exception {
        Chat c = chat();
        MvcResult both = send(c.buyer(), c.conversation(), Map.of("content", "你好", "templateCode", "BUYER_STILL_AVAILABLE"));
        assertThat(status(both)).isEqualTo(400);
        assertThat(api.body(both).path("message").asText()).isEqualTo("只能二选一：快捷消息或文字");
        assertThat(messageCount(c.conversation())).isZero();
        MvcResult unknown = send(c.buyer(), c.conversation(), Map.of("content", "你好", "senderId", c.seller().id()));
        assertThat(status(unknown)).as("未知字段照常 400").isEqualTo(400);
        assertThat(api.body(unknown).path("message").asText()).contains("senderId");
        assertThat(messageCount(c.conversation())).isZero();
    }

    @Test
    @DisplayName("4. 快捷消息在开关打开时照常可用，角色 / 未知 code 规则不变，且不走内容安全（同样文字作为自由文字会被词表拦截）")
    void templatesStillWorkAndSkipContentSafety() throws Exception {
        Chat c = chat();
        MvcResult freeText = send(c.buyer(), c.conversation(), Map.of("content", "你好，这件还在吗？"));
        assertThat(status(freeText)).isEqualTo(400);
        assertThat(api.body(freeText).path("message").asText()).as("测试词表生效").isEqualTo(BLOCKED);
        assertThat(messageEvents(c.buyer())).containsExactly("KEYWORD:BLOCKED");

        JsonNode created = api.ok(send(c.buyer(), c.conversation(), Map.of("templateCode", "BUYER_STILL_AVAILABLE")));
        assertThat(created.path("content").asText()).isEqualTo("你好，这件还在吗？");
        assertThat(created.path("templateCode").asText()).isEqualTo("BUYER_STILL_AVAILABLE");
        assertThat(messageEvents(c.buyer())).as("快捷消息没有新增内容安全事件").containsExactly("KEYWORD:BLOCKED");

        MvcResult wrongRole = send(c.seller(), c.conversation(), Map.of("templateCode", "BUYER_STILL_AVAILABLE"));
        assertThat(status(wrongRole)).isEqualTo(400);
        assertThat(api.body(wrongRole).path("message").asText()).isEqualTo("这条快捷消息不能由你发送");
        MvcResult unknown = send(c.seller(), c.conversation(), Map.of("templateCode", "SELLER_NOPE"));
        assertThat(status(unknown)).isEqualTo(400);
        assertThat(api.body(unknown).path("message").asText()).isEqualTo("快捷消息不存在");
        assertThat(messageCount(c.conversation())).isEqualTo(1);
    }

    @Test
    @DisplayName("5. 开关打开时第三方发自由文字仍然 404，不落库、不做内容安全检查")
    void thirdPartyFreeTextIsStillNotFound() throws Exception {
        Chat c = chat();
        User stranger = api.register();
        MvcResult r = send(stranger, c.conversation(), Map.of("content", "我也想问问"));
        assertThat(status(r)).isEqualTo(404);
        assertThat(api.body(r).path("message").asText()).isEqualTo("会话不存在");
        assertThat(status(send(stranger, c.conversation(), Map.of("content", "要不要网赌")))).isEqualTo(404);
        assertThat(messageEvents(stranger)).isEmpty();
        assertThat(messageCount(c.conversation())).isZero();
    }
}
