package com.lulu.campusmarketbackend.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import java.util.List;
import java.util.Map;

import static com.lulu.campusmarketbackend.support.SupplyApi.single;
import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 模块 5.1D / 5.5：协助整理发布。邀请一次性、只存哈希；协助人只能编辑被授权的草稿，不能发布、
 * 不能看联系方式 / 订单 / 其他草稿、不能再发邀请；撤销或过期立即失效；最终由所有者发布。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.rate-limit.assist-invite-redeem.limit=5",
        "campus-market.rate-limit.assist-invite-create.limit=8",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class AssistInviteIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_assist")
            .withUsername("campus_assist").withPassword("campus_assist_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "assist-invite-it-secret-0123456789ab");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    record Invite(String id, String token) {}

    @Test
    @DisplayName("1. 邀请码只返回一次、服务端只存 SHA-256；列表与事件都不含邀请码；有效期默认 24 小时、最长 7 天")
    void tokenIsReturnedOnceAndHashed(CapturedOutput output) throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", Map.of("title", "请室友帮忙整理", "description", "日志里不该出现的描述文字")).path("id").asText();
        JsonNode created = api.ok(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft)));
        String token = created.path("token").asText();
        assertThat(token).matches("[A-Za-z0-9_-]{43}");
        String inviteId = created.path("invite").path("id").asText();
        assertThat(created.path("invite").path("status").asText()).isEqualTo("PENDING");
        assertThat(hoursBetween(created.path("invite"))).isEqualTo(24);

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM listing_assist_invites WHERE id=?::uuid", inviteId);
        assertThat(row.get("token_hash")).isEqualTo(sha256(token));
        assertThat(row.values().stream().map(String::valueOf).noneMatch(v -> v.contains(token))).as("原始邀请码不落库").isTrue();
        assertThat(api.ok(api.get(owner, "/v1/listing-assist-invites")).toString()).doesNotContain(token);
        assertThat(api.ok(api.get(owner, "/v1/listing-assist-invites/" + inviteId + "/events")).toString())
                .contains("INVITE_CREATED").doesNotContain(token);

        User assistant = api.register();
        api.ok(api.post(assistant, "/v1/listing-assist-invites/redeem", Map.of("token", token)));
        assertThat(output.getAll()).as("邀请码与草稿内容不写日志").doesNotContain(token).doesNotContain("日志里不该出现的描述文字");

        assertThat(status(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft, "expiresInHours", 169)))).isEqualTo(400);
        assertThat(status(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft, "expiresInHours", 0)))).isEqualTo(400);
        assertThat(status(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft, "batchId", draft)))).isEqualTo(400);
        JsonNode week = api.ok(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft, "expiresInHours", 168)));
        assertThat(hoursBetween(week.path("invite"))).isEqualTo(168);
    }

    @Test
    @DisplayName("2. 一次性：兑换过、自己的、不存在的邀请码返回完全相同的 404，不透露它是否存在过")
    void oneTimeAndUniformFailure() throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", Map.of("title", "一次性")).path("id").asText();
        Invite invite = invite(owner, Map.of("draftId", draft));
        assertThat(status(api.post(owner, "/v1/listing-assist-invites/redeem", Map.of("token", invite.token())))).as("不能自己兑换").isEqualTo(404);
        User assistant = api.register();
        api.ok(api.post(assistant, "/v1/listing-assist-invites/redeem", Map.of("token", invite.token())));
        MvcResult reused = api.post(api.register(), "/v1/listing-assist-invites/redeem", Map.of("token", invite.token()));
        MvcResult unknown = api.post(api.register(), "/v1/listing-assist-invites/redeem", Map.of("token", "x".repeat(43)));
        assertThat(status(reused)).isEqualTo(404);
        assertThat(status(unknown)).isEqualTo(404);
        assertThat(api.body(reused).path("message").asText()).isEqualTo(api.body(unknown).path("message").asText());
        assertThat(api.body(reused).path("data").isNull()).isTrue();
        assertThat(status(api.post(assistant, "/v1/listing-assist-invites/redeem", Map.of("token", invite.token(), "draftId", draft)))).isEqualTo(400);
    }

    @Test
    @DisplayName("3. 协助人能改内容，但看不到也写不了联系方式、不能标记可发布、不能发布、不能再发邀请、看不到所有者的其他草稿与批次")
    void assistantBoundaries() throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", single("生活用品", "台灯", 20)).path("id").asText();
        String other = api.createDraft(owner, "SINGLE", Map.of("title", "所有者的另一个草稿")).path("id").asText();
        String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(draft)))).path("id").asText();
        User assistant = api.register();
        redeem(assistant, invite(owner, Map.of("draftId", draft)));

        JsonNode seen = api.ok(api.get(assistant, "/v1/listing-drafts/" + draft));
        assertThat(seen.path("access").asText()).isEqualTo("ASSISTANT");
        assertThat(seen.path("payload").has("contact")).as("看不到所有者联系方式").isFalse();
        assertThat(seen.toString()).doesNotContain("13800000000").doesNotContain(owner.id());
        assertThat(api.ok(api.get(assistant, "/v1/listing-drafts/assisting")).toString()).contains(draft).doesNotContain(other);

        Map<String, Object> edit = single("生活用品", "协助整理后的台灯", 18);
        edit.remove("contact");
        edit.put("description", "协助人补充了细节");
        JsonNode saved = api.ok(api.saveDraft(assistant, draft, 1, edit, null));
        assertThat(saved.path("payload").path("title").asText()).isEqualTo("协助整理后的台灯");
        assertThat(jdbc.queryForObject("SELECT payload->>'contact' FROM listing_drafts WHERE id=?::uuid", String.class, draft))
                .as("保存时保留所有者的联系方式").isEqualTo("13800000000");

        Map<String, Object> withContact = single("生活用品", "偷改联系方式", 18);
        assertThat(status(api.saveDraft(assistant, draft, 2, withContact, null))).isEqualTo(403);
        for (Map.Entry<String, Object> ownerField : List.<Map.Entry<String, Object>>of(
                Map.entry("condition", "全新"), Map.entry("images", List.of("https://example.invalid/b.png")),
                Map.entry("campus", "西校区"), Map.entry("inspection", List.of()))) {
            Map<String, Object> tamper = new java.util.LinkedHashMap<>(edit);
            tamper.put(ownerField.getKey(), ownerField.getValue());
            assertThat(status(api.saveDraft(assistant, draft, 2, tamper, null))).as("协助人不能改 " + ownerField.getKey()).isEqualTo(403);
        }
        Map<String, Object> suggestion = new java.util.LinkedHashMap<>(edit);
        suggestion.put("price", 16);
        suggestion.put("buildingId", "east-qinyuan-1");
        assertThat(status(api.saveDraft(assistant, draft, 2, suggestion, null))).as("价格与楼栋建议可以改").isEqualTo(200);
        assertThat(status(api.saveDraft(assistant, draft, 3, null, "READY"))).isEqualTo(403);
        assertThat(status(api.publish(assistant, batch, "assistant-publish-key"))).isEqualTo(404);
        assertThat(status(api.get(assistant, "/v1/listing-batches/" + batch))).isEqualTo(404);
        assertThat(status(api.post(assistant, "/v1/listing-assist-invites", Map.of("draftId", draft)))).as("不能再发邀请").isEqualTo(404);
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + other))).isEqualTo(404);
        assertThat(status(api.delete(assistant, "/v1/listing-drafts/" + draft))).as("不能丢弃所有者的草稿").isEqualTo(404);
        assertThat(api.ok(api.get(assistant, "/v1/listing-drafts"))).as("我的草稿里没有别人的").isEmpty();

        JsonNode ownerView = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
        assertThat(ownerView.path("assisted").asBoolean()).isTrue();
        assertThat(ownerView.path("items").get(0).path("draft").path("editedByAssistant").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("4. 所有者检查后发布：seller 与 published_by 都是所有者，assisted_by 记录协助人；协助人事后不能编辑，也看不到订单与确认码")
    void ownerPublishes() throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", single("生活用品", "待协助发布", 30)).path("id").asText();
        String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(draft)))).path("id").asText();
        User assistant = api.register();
        Invite invite = invite(owner, Map.of("batchId", batch));
        redeem(assistant, invite);
        Map<String, Object> edit = single("生活用品", "协助后发布", 28);
        edit.remove("contact");
        api.ok(api.saveDraft(assistant, draft, 1, edit, null));

        String productId = api.ok(api.publish(owner, batch, "owner-publish-key")).path("productIds").get(0).asText();
        Map<String, Object> product = jdbc.queryForMap("SELECT seller_id::text AS seller, published_by::text AS pub, assisted_by::text AS assist, contact FROM products WHERE id=?::uuid", productId);
        assertThat(product.get("seller")).isEqualTo(owner.id());
        assertThat(product.get("pub")).isEqualTo(owner.id());
        assertThat(product.get("assist")).isEqualTo(assistant.id());
        assertThat(product.get("contact")).isEqualTo("13800000000");
        assertThat(api.ok(api.get(owner, "/v1/listing-assist-invites/" + invite.id() + "/events")).toString())
                .contains("INVITE_REDEEMED").contains("ASSIST_DRAFT_EDITED").contains("PUBLISHED_AFTER_ASSIST");

        assertThat(status(api.saveDraft(assistant, draft, 2, Map.of("title", "发布后再改"), null))).isIn(404, 409);
        User buyer = api.register();
        String orderId = api.order(buyer, productId);
        assertThat(status(api.get(assistant, "/v1/orders/" + orderId + "/flow"))).isIn(403, 404);
        assertThat(api.ok(api.get(assistant, "/v1/orders?role=all")).toString()).doesNotContain(orderId);
        assertThat(status(api.patch(assistant, "/v1/products/" + productId, Map.of("title", "协助人改商品")))).isIn(403, 404);
        assertThat(api.ok(api.get(assistant, "/v1/me/trade-history")).toString()).doesNotContain(productId);
    }

    @Test
    @DisplayName("5. 撤销立即生效（幂等）；过期同样失效；草稿移出被授权的批次后协助人失去访问")
    void revokeAndExpire() throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", Map.of("title", "会撤销")).path("id").asText();
        User assistant = api.register();
        Invite invite = invite(owner, Map.of("draftId", draft));
        redeem(assistant, invite);
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + draft))).isEqualTo(200);
        assertThat(api.ok(api.post(owner, "/v1/listing-assist-invites/" + invite.id() + "/revoke", Map.of())).path("status").asText()).isEqualTo("REVOKED");
        assertThat(api.ok(api.post(owner, "/v1/listing-assist-invites/" + invite.id() + "/revoke", Map.of())).path("status").asText()).isEqualTo("REVOKED");
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + draft))).isEqualTo(404);
        assertThat(status(api.saveDraft(assistant, draft, 1, Map.of("title", "撤销后写入"), null))).isEqualTo(404);
        assertThat(status(api.post(assistant, "/v1/listing-assist-invites/" + invite.id() + "/revoke", Map.of()))).as("协助人不能撤销").isEqualTo(404);

        String second = api.createDraft(owner, "SINGLE", Map.of("title", "会过期")).path("id").asText();
        Invite expiring = invite(owner, Map.of("draftId", second));
        redeem(assistant, expiring);
        jdbc.update("UPDATE listing_assist_invites SET created_at = now() - interval '2 hours', redeemed_at = now() - interval '90 minutes', "
                + "expires_at = now() - interval '1 hour' WHERE id=?::uuid", expiring.id());
        assertThat(status(api.saveDraft(assistant, second, 1, Map.of("title", "过期后写入"), null))).isEqualTo(404);
        assertThat(api.ok(api.get(owner, "/v1/listing-assist-invites")).toString()).contains("EXPIRED");

        String inBatch = api.createDraft(owner, "SINGLE", Map.of("title", "批次里的")).path("id").asText();
        String outside = api.createDraft(owner, "SINGLE", Map.of("title", "批次外的")).path("id").asText();
        String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(inBatch)))).path("id").asText();
        redeem(assistant, invite(owner, Map.of("batchId", batch)));
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + inBatch))).isEqualTo(200);
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + outside))).isEqualTo(404);
        api.ok(api.patch(owner, "/v1/listing-batches/" + batch, Map.of("expectedVersion", 1, "draftIds", List.of())));
        assertThat(status(api.get(assistant, "/v1/listing-drafts/" + inBatch))).isEqualTo(404);
    }

    @Test
    @DisplayName("6. 所有者与协助人同时编辑：同一版本只有一个成功，另一个 409，不静默合并")
    void concurrentEdits() throws Exception {
        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", Map.of("title", "两人同时改")).path("id").asText();
        User assistant = api.register();
        redeem(assistant, invite(owner, Map.of("draftId", draft)));
        MvcResult mine = api.saveDraft(owner, draft, 1, Map.of("title", "所有者的版本"), null);
        MvcResult theirs = api.saveDraft(assistant, draft, 1, Map.of("title", "协助人的版本"), null);
        assertThat(List.of(status(mine), status(theirs))).containsExactly(200, 409);
        assertThat(api.ok(api.get(owner, "/v1/listing-drafts/" + draft)).path("payload").path("title").asText()).isEqualTo("所有者的版本");
    }

    @Test
    @DisplayName("7. 限流：兑换失败按账号计数，超出 429 带 Retry-After 与 requestId；创建邀请同样限流")
    void rateLimits() throws Exception {
        User guesser = api.register();
        MvcResult last = null;
        for (int i = 0; i < 6; i++) last = api.post(guesser, "/v1/listing-assist-invites/redeem", Map.of("token", "guess-" + i));
        assertThat(status(last)).isEqualTo(429);
        assertThat(last.getResponse().getHeader("Retry-After")).matches("[1-9][0-9]*");
        assertThat(api.body(last).path("requestId").asText()).isNotBlank();

        User owner = api.register();
        String draft = api.createDraft(owner, "SINGLE", Map.of("title", "发很多邀请")).path("id").asText();
        List<Integer> statuses = new ArrayList<>();
        for (int i = 0; i < 9; i++) statuses.add(status(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draft))));
        assertThat(statuses.subList(0, 8)).containsOnly(200);
        assertThat(statuses.get(8)).isEqualTo(429);
    }

    // ------------------------------------------------------------------

    private static long hoursBetween(JsonNode invite) {
        return Math.round((invite.path("expiresAt").asLong() - invite.path("createdAt").asLong()) / 3_600_000.0);
    }

    private Invite invite(User owner, Map<String, Object> scope) throws Exception {
        JsonNode created = api.ok(api.post(owner, "/v1/listing-assist-invites", scope));
        return new Invite(created.path("invite").path("id").asText(), created.path("token").asText());
    }

    private void redeem(User assistant, Invite invite) throws Exception {
        api.ok(api.post(assistant, "/v1/listing-assist-invites/redeem", Map.of("token", invite.token())));
    }

    private static String sha256(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }
}
