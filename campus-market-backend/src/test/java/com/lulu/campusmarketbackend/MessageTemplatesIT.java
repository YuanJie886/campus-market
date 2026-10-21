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

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 私信快捷消息（默认配置：campus-market.messages.free-text-enabled 未设置 = false）。
 * 只能发预设快捷消息；买家 / 卖家只能发各自角色的模板；自由文字一律 400 且不落库；
 * 参与者与商品可见性规则不变；历史自由文字消息照常显示（templateCode=null）。
 * 自由文字开关打开时的行为见 {@link MessageFreeTextEnabledIT}。
 */
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MessageTemplatesIT {
    /** 契约：顺序、code、文案、角色必须与客户端约定完全一致。 */
    static final List<String[]> EXPECTED = List.of(
            new String[]{"BUYER_STILL_AVAILABLE", "你好，这件还在吗？", "BUYER"},
            new String[]{"BUYER_ASK_CONDITION", "可以再介绍一下成色和使用情况吗？", "BUYER"},
            new String[]{"BUYER_ASK_PRICE", "价格还有商量的空间吗？", "BUYER"},
            new String[]{"BUYER_ASK_PHOTOS", "方便在商品里补充几张实物照片吗？", "BUYER"},
            new String[]{"BUYER_ASK_CONTACT", "我想要这件，已在商品页申请联系方式，麻烦同意一下。", "BUYER"},
            new String[]{"SELLER_AVAILABLE", "还在的，可以在商品页申请联系方式。", "SELLER"},
            new String[]{"SELLER_SOLD", "不好意思，已经出了。", "SELLER"},
            new String[]{"SELLER_PRICE_FIRM", "价格不议，谢谢理解。", "SELLER"},
            new String[]{"SELLER_PRICE_NEGOTIABLE", "价格可以商量，交换联系方式后细聊。", "SELLER"},
            new String[]{"SELLER_CONTACT_VIA_REQUEST", "请在商品页点「申请联系方式」，我同意后你就能看到。", "SELLER"},
            new String[]{"SELLER_PHOTOS_ADDED", "照片已补充，刷新商品页就能看到。", "SELLER"},
            new String[]{"ANY_THANKS", "好的，谢谢！", "ANY"},
            new String[]{"ANY_LATER", "稍等，我晚点回复你。", "ANY"});

    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    record Chat(User seller, User buyer, String product, String conversation) {}

    private Chat chat() throws Exception {
        User seller = api.register(), buyer = api.register();
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("其他", "快捷消息测试商品", 20))).path("id").asText();
        String conversation = api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", product))).path("id").asText();
        return new Chat(seller, buyer, product, conversation);
    }

    private MvcResult send(User who, String conversation, Object body) throws Exception {
        return api.post(who, "/v1/conversations/" + conversation + "/messages", body);
    }

    private String text(String code) {
        return EXPECTED.stream().filter(t -> t[0].equals(code)).findFirst().orElseThrow()[1];
    }

    private long messageCount(String conversation) {
        return jdbc.queryForObject("SELECT count(*) FROM messages WHERE conversation_id=?::uuid", Long.class, conversation);
    }

    private void assertBadRequest(MvcResult result, String message) throws Exception {
        assertThat(status(result)).as(result.getResponse().getContentAsString()).isEqualTo(400);
        assertThat(api.body(result).path("message").asText()).isEqualTo(message);
    }

    @Test
    @DisplayName("1. GET /v1/message-templates：需要登录；按约定顺序返回 13 条 code / text / role；freeTextEnabled=false")
    void templatesEndpointListsTheContractInOrderAndRequiresLogin() throws Exception {
        assertThat(status(api.get(null, "/v1/message-templates"))).as("未登录").isEqualTo(401);

        MvcResult result = api.get(api.register(), "/v1/message-templates");
        JsonNode data = api.ok(result);
        assertThat(api.body(result).path("code").asInt()).isZero();
        assertThat(data.path("freeTextEnabled").isBoolean()).isTrue();
        assertThat(data.path("freeTextEnabled").asBoolean()).isFalse();
        JsonNode templates = data.path("templates");
        assertThat(templates).hasSize(EXPECTED.size());
        for (int i = 0; i < EXPECTED.size(); i++) {
            JsonNode t = templates.get(i);
            assertThat(t.size()).as("只有 code / text / role 三个字段").isEqualTo(3);
            assertThat(t.path("code").asText()).isEqualTo(EXPECTED.get(i)[0]);
            assertThat(t.path("text").asText()).isEqualTo(EXPECTED.get(i)[1]);
            assertThat(t.path("role").asText()).isEqualTo(EXPECTED.get(i)[2]);
        }
    }

    @Test
    @DisplayName("2. GET /v1/config（匿名）新增 messages.freeTextEnabled=false，images 部分不变")
    void configReportsTheMessagesSwitch() throws Exception {
        JsonNode data = api.ok(api.get(null, "/v1/config"));
        assertThat(data.path("messages").toString()).isEqualTo("{\"freeTextEnabled\":false}");
        assertThat(data.path("images").toString())
                .isEqualTo("{\"maxCount\":9,\"maxBytes\":5242880,\"accept\":[\"image/jpeg\",\"image/png\"],\"externalAllowed\":true}");
    }

    @Test
    @DisplayName("3. 买家可发 BUYER_* 与 ANY_*，卖家可发 SELLER_* 与 ANY_*：正文是预设文案、template_code 落库、创建与列表响应带 templateCode")
    void buyerAndSellerSendTheirOwnTemplates() throws Exception {
        Chat c = chat();
        List<String> sent = new ArrayList<>();
        for (String[] t : EXPECTED) {
            List<User> senders = switch (t[2]) {
                case "BUYER" -> List.of(c.buyer());
                case "SELLER" -> List.of(c.seller());
                default -> List.of(c.buyer(), c.seller());
            };
            for (User who : senders) {
                JsonNode created = api.ok(send(who, c.conversation(), Map.of("templateCode", t[0])));
                assertThat(created.path("templateCode").asText()).isEqualTo(t[0]);
                assertThat(created.path("content").asText()).isEqualTo(t[1]);
                assertThat(created.path("senderId").asText()).isEqualTo(who.id());
                assertThat(created.path("conversationId").asText()).isEqualTo(c.conversation());
                assertThat(created.path("quarantined").asBoolean()).isFalse();
                Map<String, Object> row = jdbc.queryForMap("SELECT content, template_code, sender_id::text AS sender FROM messages WHERE id=?::uuid",
                        UUID.fromString(created.path("id").asText()));
                assertThat(row).containsEntry("content", t[1]).containsEntry("template_code", t[0]).containsEntry("sender", who.id());
                sent.add(t[0]);
            }
        }
        assertThat(sent).hasSize(15);

        for (User viewer : List.of(c.buyer(), c.seller())) {
            JsonNode list = api.ok(api.get(viewer, "/v1/conversations/" + c.conversation() + "/messages"));
            assertThat(list).hasSize(15);
            for (int i = 0; i < sent.size(); i++) {
                assertThat(list.get(i).path("templateCode").asText()).isEqualTo(sent.get(i));
                assertThat(list.get(i).path("content").asText()).isEqualTo(text(sent.get(i)));
            }
        }
        assertThat(api.ok(api.get(c.seller(), "/v1/conversations")).toString()).as("会话列表照常").contains(c.conversation());
        assertThat(api.ok(api.get(c.seller(), "/v1/messages/unread")).path("count").asInt()).as("卖家未读 = 买家发的 5+2 条").isEqualTo(7);
    }

    @Test
    @DisplayName("4. 角色不对 → 400「这条快捷消息不能由你发送」，不落库")
    void wrongRoleIsRejected() throws Exception {
        Chat c = chat();
        for (String code : List.of("SELLER_AVAILABLE", "SELLER_SOLD", "SELLER_PRICE_FIRM", "SELLER_PRICE_NEGOTIABLE", "SELLER_CONTACT_VIA_REQUEST", "SELLER_PHOTOS_ADDED")) {
            assertBadRequest(send(c.buyer(), c.conversation(), Map.of("templateCode", code)), "这条快捷消息不能由你发送");
        }
        for (String code : List.of("BUYER_STILL_AVAILABLE", "BUYER_ASK_CONDITION", "BUYER_ASK_PRICE", "BUYER_ASK_PHOTOS", "BUYER_ASK_CONTACT")) {
            assertBadRequest(send(c.seller(), c.conversation(), Map.of("templateCode", code)), "这条快捷消息不能由你发送");
        }
        assertThat(messageCount(c.conversation())).isZero();
    }

    @Test
    @DisplayName("5. 未知 code（含大小写不符、空串、非字符串、null）→ 400「快捷消息不存在」，不落库")
    void unknownCodeIsRejected() throws Exception {
        Chat c = chat();
        List<Object> bad = new ArrayList<>(List.of("NO_SUCH_TEMPLATE", "buyer_still_available", "", " BUYER_STILL_AVAILABLE", 123, List.of("ANY_THANKS")));
        for (Object code : bad) {
            assertBadRequest(send(c.buyer(), c.conversation(), Map.of("templateCode", code)), "快捷消息不存在");
        }
        Map<String, Object> nullCode = new LinkedHashMap<>();
        nullCode.put("templateCode", null);
        assertBadRequest(send(c.buyer(), c.conversation(), nullCode), "快捷消息不存在");
        assertThat(messageCount(c.conversation())).isZero();
    }

    @Test
    @DisplayName("6. 默认关闭自由文字：{content}、{content+templateCode} → 400「私信目前只能发送预设的快捷消息」；空请求 400；未知字段照常 400；均不落库、不做内容安全检查")
    void freeTextIsRejectedByDefault() throws Exception {
        Chat c = chat();
        assertBadRequest(send(c.buyer(), c.conversation(), Map.of("content", "今晚七点宿舍楼下可以看看吗？")), "私信目前只能发送预设的快捷消息");
        assertBadRequest(send(c.buyer(), c.conversation(), Map.of("content", "要不要网赌，带你赚钱")), "私信目前只能发送预设的快捷消息");
        assertBadRequest(send(c.buyer(), c.conversation(), Map.of("content", "你好", "templateCode", "BUYER_STILL_AVAILABLE")), "私信目前只能发送预设的快捷消息");
        assertBadRequest(send(c.seller(), c.conversation(), Map.of("content", "在的")), "私信目前只能发送预设的快捷消息");
        assertBadRequest(send(c.buyer(), c.conversation(), Map.of()), "请选择一条快捷消息");
        MvcResult unknown = send(c.buyer(), c.conversation(), Map.of("templateCode", "BUYER_STILL_AVAILABLE", "senderId", c.seller().id()));
        assertThat(status(unknown)).isEqualTo(400);
        assertThat(api.body(unknown).path("message").asText()).contains("senderId");

        assertThat(messageCount(c.conversation())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM content_safety_events WHERE user_id=?::uuid", Long.class, UUID.fromString(c.buyer().id())))
                .as("被拒的自由文字没有进入内容安全检查").isZero();
        assertThat(api.ok(api.get(c.buyer(), "/v1/conversations/" + c.conversation() + "/messages"))).isEmpty();
    }

    @Test
    @DisplayName("7. 历史自由文字消息（template_code 为 NULL）照常显示，templateCode=null；与快捷消息混排")
    void legacyFreeTextMessagesStillDisplay() throws Exception {
        Chat c = chat();
        UUID legacy = UUID.randomUUID();
        jdbc.update("INSERT INTO messages(id, conversation_id, sender_id, content, created_at) VALUES (?, ?::uuid, ?::uuid, ?, now() - interval '1 hour')",
                legacy, c.conversation(), c.buyer().id(), "上线快捷消息之前发的自由文字");
        api.ok(send(c.seller(), c.conversation(), Map.of("templateCode", "SELLER_AVAILABLE")));

        for (User viewer : List.of(c.buyer(), c.seller())) {
            JsonNode list = api.ok(api.get(viewer, "/v1/conversations/" + c.conversation() + "/messages"));
            assertThat(list).hasSize(2);
            assertThat(list.get(0).path("id").asText()).isEqualTo(legacy.toString());
            assertThat(list.get(0).path("content").asText()).isEqualTo("上线快捷消息之前发的自由文字");
            assertThat(list.get(0).has("templateCode")).as("字段存在").isTrue();
            assertThat(list.get(0).path("templateCode").isNull()).isTrue();
            assertThat(list.get(1).path("templateCode").asText()).isEqualTo("SELLER_AVAILABLE");
            assertThat(list.get(1).path("content").asText()).isEqualTo("还在的，可以在商品页申请联系方式。");
        }
    }

    @Test
    @DisplayName("8. 第三方：发快捷消息 / 读消息仍然 404，不落库；买家失去商品可见性后同样 404（规则不变）")
    void thirdPartiesStillCannotSendOrRead() throws Exception {
        Chat c = chat();
        User stranger = api.register();
        for (String code : List.of("BUYER_STILL_AVAILABLE", "SELLER_SOLD", "ANY_THANKS")) {
            MvcResult r = send(stranger, c.conversation(), Map.of("templateCode", code));
            assertThat(status(r)).as(code).isEqualTo(404);
            assertThat(api.body(r).path("message").asText()).isEqualTo("会话不存在");
        }
        assertThat(status(api.get(stranger, "/v1/conversations/" + c.conversation() + "/messages"))).isEqualTo(404);
        assertThat(status(send(stranger, UUID.randomUUID().toString(), Map.of("templateCode", "ANY_THANKS")))).as("不存在的会话").isEqualTo(404);
        assertThat(status(send(null, c.conversation(), Map.of("templateCode", "ANY_THANKS")))).as("未登录").isEqualTo(401);
        assertThat(messageCount(c.conversation())).isZero();

        // 商品被治理隐藏：买家不能再访问会话（与原规则一致），卖家仍能发
        jdbc.update("UPDATE products SET moderation_hidden_at=now() WHERE id=?::uuid", UUID.fromString(c.product()));
        assertThat(status(send(c.buyer(), c.conversation(), Map.of("templateCode", "BUYER_STILL_AVAILABLE")))).isEqualTo(404);
        assertThat(status(send(c.seller(), c.conversation(), Map.of("templateCode", "SELLER_SOLD")))).isEqualTo(200);
        assertThat(messageCount(c.conversation())).isEqualTo(1);
    }
}
