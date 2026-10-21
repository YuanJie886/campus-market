package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.LegacyOrders;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;

/**
 * 头像契约（PATCH /v1/auth/me 的 avatar 与所有带头像的响应）。外部链接开关使用默认值 true；
 * 开关关闭时的行为见 {@link AvatarExternalDisabledIT}。
 *
 * <p>商品详情、留言、会话、圈子成员、后台交易里的头像：商品 / 留言 / 会话响应本身只带用户 id（sellerId / userId / buyerId），
 * 客户端用 GET /v1/users/{id} 取对方的公开资料与头像；圈子成员与后台交易直接带头像字段。
 */
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AvatarIT {
    static final String INVALID = "头像无效";
    static final String NOT_MINE = "只能使用自己上传的图片，请重新上传";

    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final java.nio.file.Path IMAGE_DIR;
    static {
        try { IMAGE_DIR = Files.createTempDirectory("cm-avatar-it-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("campus-market.images.dir", IMAGE_DIR::toString);
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    // ---------------- 辅助 ----------------

    /** 上传一张图片，返回 {id, ref, url, ...} */
    private JsonNode upload(User who) throws Exception {
        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        MvcResult r = mvc.perform(multipart("/v1/images").file(new MockMultipartFile("file", "a.png", "image/png", out.toByteArray()))
                .header("Authorization", "Bearer " + who.token())).andReturn();
        return api.ok(r);
    }

    private MvcResult setAvatar(User who, Object avatar) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("avatar", avatar);
        return api.patch(who, "/v1/auth/me", body);
    }

    private String stored(User who) {
        return jdbc.queryForObject("SELECT avatar FROM users WHERE id=?::uuid", String.class, who.id());
    }

    private String meAvatar(User who) throws Exception {
        return api.ok(api.get(who, "/v1/auth/me")).path("avatar").asText();
    }

    private String publicAvatar(User viewer, String userId) throws Exception {
        return api.ok(api.get(viewer, "/v1/users/" + userId)).path("avatar").asText();
    }

    private void assertRejected(MvcResult r, String message) throws Exception {
        assertThat(status(r)).as(r.getResponse().getContentAsString()).isEqualTo(400);
        assertThat(api.body(r).path("message").asText()).isEqualTo(message);
    }

    /** 签名地址：/v1/images/<id>?exp=…&sig=…，并且确实能取到图片 */
    private void assertSigned(String avatar, String imageId) throws Exception {
        assertThat(avatar).startsWith("/v1/images/" + imageId + "?exp=").contains("&sig=");
        assertThat(mvc.perform(get(avatar)).andReturn().getResponse().getStatus()).as("签名地址可读").isEqualTo(200);
    }

    // ---------------- 写入 ----------------

    @Test void registrationDefaultsToNoAvatar() throws Exception {
        User user = api.register();
        assertThat(stored(user)).isEqualTo("");
        assertThat(meAvatar(user)).isEqualTo("");
    }

    @Test void acceptsEveryContractFormAndStoresTheReference() throws Exception {
        User user = api.register();

        for (String preset : List.of("preset:1", "preset:9", "preset:10", "preset:12")) {
            JsonNode me = api.ok(setAvatar(user, preset));
            assertThat(me.path("avatar").asText()).isEqualTo(preset);
            assertThat(stored(user)).isEqualTo(preset);
        }
        api.ok(setAvatar(user, "  preset:7  "));
        assertThat(stored(user)).as("与其他资料字段一样去掉首尾空白").isEqualTo("preset:7");

        JsonNode image = upload(user);
        String id = image.path("id").asText(), ref = image.path("ref").asText();
        JsonNode me = api.ok(setAvatar(user, ref));
        assertThat(stored(user)).isEqualTo("upload:" + id);
        assertSigned(me.path("avatar").asText(), id);
        assertSigned(meAvatar(user), id);

        api.ok(setAvatar(user, "upload:" + id.toUpperCase()));
        assertThat(stored(user)).as("引用规范化为小写 uuid").isEqualTo("upload:" + id);

        api.ok(setAvatar(user, "https://cdn.example.invalid/avatar.png"));
        assertThat(stored(user)).isEqualTo("https://cdn.example.invalid/avatar.png");
        assertThat(meAvatar(user)).as("外部地址原样返回").isEqualTo("https://cdn.example.invalid/avatar.png");
        api.ok(setAvatar(user, "http://cdn.example.invalid/avatar.png"));
        assertThat(stored(user)).isEqualTo("http://cdn.example.invalid/avatar.png");

        api.ok(setAvatar(user, ""));
        assertThat(stored(user)).isEqualTo("");
        assertThat(meAvatar(user)).isEqualTo("");
        api.ok(setAvatar(user, "preset:3"));
        api.ok(setAvatar(user, null));
        assertThat(stored(user)).as("null 与空串同为「无头像」（沿用资料字段的既有规则）").isEqualTo("");
    }

    @Test void invalidPresetsAndUnknownFormsAreRejected() throws Exception {
        User user = api.register();
        api.ok(setAvatar(user, "preset:5"));
        for (String bad : List.of("preset:0", "preset:13", "preset:01", "PRESET:1", "preset:x", "Preset:1", "preset:", "preset:1.0",
                "preset:-1", "preset: 1", "preset:12a", "upload:not-a-uuid", "upload:", "ftp://example.invalid/a.png",
                "data:image/png;base64,AAAA", "javascript:alert(1)", "//example.invalid/a.png", "/v1/images/not-a-uuid",
                "HTTPS://example.invalid/a.png", "avatar.png")) {
            assertRejected(setAvatar(user, bad), INVALID);
            assertThat(stored(user)).as(bad).isEqualTo("preset:5");
        }
    }

    @Test void anotherUsersUploadAndUnusableImagesAreRejected() throws Exception {
        User user = api.register(), other = api.register();
        api.ok(setAvatar(user, "preset:2"));
        JsonNode theirs = upload(other);
        assertRejected(setAvatar(user, theirs.path("ref").asText()), NOT_MINE);
        assertRejected(setAvatar(user, theirs.path("url").asText()), NOT_MINE);
        assertRejected(setAvatar(user, "https://market.example.com" + theirs.path("url").asText()), NOT_MINE);
        assertRejected(setAvatar(user, "upload:" + UUID.randomUUID()), NOT_MINE);

        JsonNode hidden = upload(user);
        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", hidden.path("id").asText());
        assertRejected(setAvatar(user, hidden.path("ref").asText()), NOT_MINE);
        assertThat(stored(user)).isEqualTo("preset:2");
    }

    @Test void signedUrlFromAResponseRoundTripsToTheReference() throws Exception {
        User user = api.register();
        JsonNode image = upload(user);
        String id = image.path("id").asText();
        api.ok(setAvatar(user, image.path("ref").asText()));

        // 客户端的典型流程：GET me → 修改昵称时把整份资料（含签名头像地址）原样 PATCH 回来
        JsonNode me = api.ok(api.get(user, "/v1/auth/me"));
        String signed = me.path("avatar").asText();
        assertSigned(signed, id);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("nickname", "改个昵称");
        body.put("avatar", signed);
        JsonNode updated = api.ok(api.patch(user, "/v1/auth/me", body));
        assertThat(stored(user)).isEqualTo("upload:" + id);
        assertSigned(updated.path("avatar").asText(), id);

        // 绝对地址形式（以平台路径结尾）与签名过期的地址同样还原
        api.ok(setAvatar(user, "https://market.example.com" + signed));
        assertThat(stored(user)).isEqualTo("upload:" + id);
        api.ok(setAvatar(user, "/v1/images/" + id + "?exp=1&sig=expired"));
        assertThat(stored(user)).isEqualTo("upload:" + id);
    }

    @Test void hiddenOrDeletedAvatarImagesRenderAsEmpty() throws Exception {
        User user = api.register(), viewer = api.register();
        JsonNode first = upload(user);
        api.ok(setAvatar(user, first.path("ref").asText()));
        assertSigned(publicAvatar(viewer, user.id()), first.path("id").asText());

        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", first.path("id").asText());
        assertThat(meAvatar(user)).isEqualTo("");
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("");
        assertThat(stored(user)).as("库里的引用保留，展示层返回空串").isEqualTo(first.path("ref").asText());

        JsonNode second = upload(user);
        api.ok(setAvatar(user, second.path("ref").asText()));
        assertSigned(meAvatar(user), second.path("id").asText());
        jdbc.update("UPDATE uploaded_images SET status='DELETED' WHERE id=?::uuid", second.path("id").asText());
        assertThat(meAvatar(user)).isEqualTo("");
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("");
    }

    @Test void presetExternalAndUnknownStoredValuesRenderPerContract() throws Exception {
        User user = api.register(), viewer = api.register();
        api.ok(setAvatar(user, "preset:11"));
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("preset:11");
        api.ok(setAvatar(user, "https://cdn.example.invalid/x.png"));
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("https://cdn.example.invalid/x.png");
        // 绕过接口写进库里的非法值不交给客户端
        jdbc.update("UPDATE users SET avatar='preset:99' WHERE id=?::uuid", user.id());
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("");
        jdbc.update("UPDATE users SET avatar='javascript:alert(1)' WHERE id=?::uuid", user.id());
        assertThat(meAvatar(user)).isEqualTo("");
        // 别人的图片（只可能来自绕过接口的写入）同样不签名
        JsonNode theirs = upload(viewer);
        jdbc.update("UPDATE users SET avatar=? WHERE id=?::uuid", theirs.path("ref").asText(), user.id());
        assertThat(publicAvatar(viewer, user.id())).isEqualTo("");
    }

    @Test void unknownFieldsAndMalformedValuesAreStillRejected() throws Exception {
        User user = api.register();
        api.ok(setAvatar(user, "preset:4"));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("avatar", "preset:6");
        body.put("avatarUrl", "https://example.invalid/a.png");
        MvcResult unknown = api.patch(user, "/v1/auth/me", body);
        assertRejected(unknown, "请求包含不支持的字段：avatarUrl");
        assertThat(stored(user)).isEqualTo("preset:4");

        MvcResult notText = mvc.perform(patch("/v1/auth/me").contentType(MediaType.APPLICATION_JSON).content("{\"avatar\":7}")
                .header("Authorization", "Bearer " + user.token())).andReturn();
        assertRejected(notText, "avatar 长度无效");
        assertRejected(setAvatar(user, "https://example.invalid/" + "a".repeat(2048)), "avatar 长度无效");
        assertThat(stored(user)).isEqualTo("preset:4");
    }

    // ---------------- 展示 ----------------

    @Test void uploadedAvatarIsSignedWhereverSellerCommenterOrChatPartnerIsShown() throws Exception {
        User seller = api.register(), buyer = api.register();
        JsonNode sellerImage = upload(seller), buyerImage = upload(buyer);
        api.ok(setAvatar(seller, sellerImage.path("ref").asText()));
        api.ok(setAvatar(buyer, buyerImage.path("url").asText()));
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "头像测试台灯", 30))).path("id").asText();

        // 商品详情 → 卖家资料
        String sellerId = api.ok(api.get(buyer, "/v1/products/" + product)).path("sellerId").asText();
        assertThat(sellerId).isEqualTo(seller.id());
        assertSigned(publicAvatar(buyer, sellerId), sellerImage.path("id").asText());

        // 留言 → 留言人资料
        api.ok(api.post(buyer, "/v1/products/" + product + "/comments", Map.of("content", "请问还在吗")));
        JsonNode comments = api.ok(api.get(seller, "/v1/products/" + product + "/comments"));
        String commenter = comments.get(0).path("userId").asText();
        assertThat(commenter).isEqualTo(buyer.id());
        assertSigned(publicAvatar(seller, commenter), buyerImage.path("id").asText());

        // 会话 → 对方资料（双向）
        api.ok(api.post(buyer, "/v1/conversations", Map.of("productId", product)));
        JsonNode conversation = api.ok(api.get(seller, "/v1/conversations")).get(0);
        assertSigned(publicAvatar(seller, conversation.path("buyerId").asText()), buyerImage.path("id").asText());
        JsonNode mine = api.ok(api.get(buyer, "/v1/conversations")).get(0);
        assertSigned(publicAvatar(buyer, mine.path("sellerId").asText()), sellerImage.path("id").asText());

        // 图片失效后所有入口一起变成空串
        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", sellerImage.path("id").asText());
        assertThat(publicAvatar(buyer, sellerId)).isEqualTo("");
    }

    @Test void circleMemberListSignsUploadedAvatarsAndKeepsPresets() throws Exception {
        User owner = api.register(), member = api.register(), presetMember = api.register();
        JsonNode image = upload(member);
        api.ok(setAvatar(member, image.path("ref").asText()));
        api.ok(setAvatar(presetMember, "preset:8"));
        String circle = api.createCircle(owner, "头像测试圈", "PRIVATE");
        api.join(owner, circle, member);
        api.join(owner, circle, presetMember);

        Map<String, String> avatars = new LinkedHashMap<>();
        for (JsonNode m : api.ok(api.get(owner, "/v1/circles/" + circle + "/members")).path("items")) {
            avatars.put(m.path("userId").asText(), m.path("avatar").asText());
        }
        assertSigned(avatars.get(member.id()), image.path("id").asText());
        assertThat(avatars.get(presetMember.id())).isEqualTo("preset:8");
        assertThat(avatars.get(owner.id())).isEqualTo("");

        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", image.path("id").asText());
        for (JsonNode m : api.ok(api.get(owner, "/v1/circles/" + circle + "/members")).path("items")) {
            if (m.path("userId").asText().equals(member.id())) assertThat(m.path("avatar").asText()).isEqualTo("");
        }
    }

    @Test void adminOrderRecordsSignBuyerAndSellerAvatars() throws Exception {
        User admin = api.register(), buyer = api.register(), seller = api.register();
        jdbc.update("INSERT INTO staff_members(user_id,school_id,role) VALUES (?,'pilot','SCHOOL_ADMIN')", UUID.fromString(admin.id()));
        JsonNode image = upload(buyer);
        api.ok(setAvatar(buyer, image.path("ref").asText()));
        api.ok(setAvatar(seller, "preset:12"));
        String product = api.ok(api.post(seller, "/v1/products", SupplyApi.single("生活用品", "头像后台订单", 40))).path("id").asText();
        String order = LegacyOrders.expired(jdbc, buyer, product);

        JsonNode detail = api.ok(api.get(admin, "/v1/admin/orders/" + order));
        assertSigned(detail.path("buyerAvatar").asText(), image.path("id").asText());
        assertThat(detail.path("sellerAvatar").asText()).isEqualTo("preset:12");
        JsonNode row = null;
        for (JsonNode item : api.ok(api.get(admin, "/v1/admin/orders?q=" + order)).path("items")) {
            if (item.path("id").asText().equals(order)) row = item;
        }
        assertThat(row).isNotNull();
        assertSigned(row.path("buyerAvatar").asText(), image.path("id").asText());
        assertThat(row.path("sellerAvatar").asText()).isEqualTo("preset:12");
    }

    // ---------------- 注销 ----------------

    @Test void accountDeletionClearsTheAvatarAndDeletesTheUploadedImage() throws Exception {
        User user = api.register();
        JsonNode image = upload(user);
        api.ok(setAvatar(user, image.path("ref").asText()));
        String signed = meAvatar(user);
        assertSigned(signed, image.path("id").asText());

        assertThat(status(api.post(user, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "确认注销")))).isEqualTo(200);
        assertThat(stored(user)).isEqualTo("");
        assertThat(jdbc.queryForObject("SELECT status FROM uploaded_images WHERE id=?::uuid", String.class, image.path("id").asText())).isEqualTo("DELETED");
        assertThat(mvc.perform(get(signed)).andReturn().getResponse().getStatus()).as("已发出的签名地址失效").isEqualTo(404);
        User viewer = api.register();
        assertThat(publicAvatar(viewer, user.id())).as("注销后的公开资料不再有头像").isEqualTo("");
    }
}
