package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.image.ImageUrlSigner;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.CRC32;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** 阶段 4：真实图片上传——格式与尺寸、去元数据与缩放、签名地址、商品只能引用本人图片、注销后失效、限流。 */
@Testcontainers
@SpringBootTest(properties = "campus-market.rate-limit.image-upload.limit=12")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UploadedImagesIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final java.nio.file.Path IMAGE_DIR;
    static {
        try { IMAGE_DIR = Files.createTempDirectory("cm-images-it-"); } catch (Exception e) { throw new IllegalStateException(e); }
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
    @Autowired ImageUrlSigner signer;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private static byte[] png(int width, int height, boolean transparent) throws Exception {
        BufferedImage image = new BufferedImage(width, height, transparent ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(transparent ? new Color(255, 0, 0, 0) : Color.BLUE);
        g.fillRect(0, 0, width, height);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    /** 一张带 EXIF（APP1，含一段可识别的「定位」标记）的 JPEG。 */
    private static byte[] jpegWithExif(String marker) throws Exception {
        BufferedImage image = new BufferedImage(200, 100, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "jpeg", out);
        byte[] plain = out.toByteArray();
        byte[] payload = ("Exif\0\0" + marker).getBytes(StandardCharsets.ISO_8859_1);
        ByteBuffer app1 = ByteBuffer.allocate(4 + payload.length);
        app1.put((byte) 0xFF).put((byte) 0xE1).putShort((short) (payload.length + 2)).put(payload);
        ByteArrayOutputStream withExif = new ByteArrayOutputStream();
        withExif.write(plain, 0, 2);
        withExif.write(app1.array());
        withExif.write(plain, 2, plain.length - 2);
        return withExif.toByteArray();
    }

    /** 只有文件头的 PNG：IHDR 声称 7000×7000（不解码像素就应该被拒绝）。 */
    private static byte[] pngHeaderOnly(int width, int height) {
        ByteBuffer ihdr = ByteBuffer.allocate(13).putInt(width).putInt(height).put((byte) 8).put((byte) 2).put((byte) 0).put((byte) 0).put((byte) 0);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A});
        writeChunk(out, "IHDR", ihdr.array());
        writeChunk(out, "IEND", new byte[0]);
        return out.toByteArray();
    }

    private static void writeChunk(ByteArrayOutputStream out, String type, byte[] data) {
        out.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        out.writeBytes(typeBytes);
        out.writeBytes(data);
        CRC32 crc = new CRC32();
        crc.update(typeBytes);
        crc.update(data);
        out.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }

    private MvcResult upload(User who, byte[] bytes, String filename, String contentType) throws Exception {
        var request = multipart("/v1/images").file(new MockMultipartFile("file", filename, contentType, bytes));
        return mvc.perform(who == null ? request : request.header("Authorization", "Bearer " + who.token())).andReturn();
    }

    private MvcResult fetch(String url) throws Exception {
        return mvc.perform(get(url)).andReturn();
    }

    @Test void uploadsAreReencodedWithoutMetadataAndServedOnlyThroughSignedUrls() throws Exception {
        User seller = api.register();
        MvcResult uploaded = upload(seller, jpegWithExif("GPS:31.2304N,121.4737E"), "photo.jpg", "image/jpeg");
        assertThat(status(uploaded)).as(uploaded.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode image = api.data(uploaded);
        String id = image.path("id").asText();
        assertThat(image.path("ref").asText()).isEqualTo("upload:" + id);
        String url = image.path("url").asText();
        assertThat(url).startsWith("/v1/images/" + id + "?exp=").contains("&sig=");

        MvcResult served = fetch(url);
        assertThat(status(served)).as("签名地址不需要登录").isEqualTo(200);
        assertThat(served.getResponse().getContentType()).isEqualTo("image/jpeg");
        assertThat(served.getResponse().getHeader("Cache-Control")).contains("private");
        byte[] body = served.getResponse().getContentAsByteArray();
        String text = new String(body, StandardCharsets.ISO_8859_1);
        assertThat(text).as("重新编码后没有 EXIF / 定位").doesNotContain("Exif").doesNotContain("GPS:31.2304N");
        assertThat(ImageIO.read(new ByteArrayInputStream(body)).getWidth()).isEqualTo(200);

        assertThat(status(fetch(url.replaceAll("sig=[^&]+", "sig=AAAA")))).as("伪造签名").isEqualTo(404);
        assertThat(status(fetch("/v1/images/" + id))).as("没有签名").isEqualTo(404);
        assertThat(status(fetch(signer.sign(UUID.fromString(id), System.currentTimeMillis() / 1000 - 1)))).as("过期").isEqualTo(404);
        assertThat(status(fetch(signer.sign(UUID.randomUUID(), System.currentTimeMillis() / 1000 + 60)))).as("不存在").isEqualTo(404);
        Map<String, Object> row = jdbc.queryForMap("SELECT owner_user_id::text AS owner, width, height, byte_size, content_type FROM uploaded_images WHERE id=?::uuid", id);
        assertThat(row.get("owner")).isEqualTo(seller.id());
        assertThat(row.get("content_type")).isEqualTo("image/jpeg");
    }

    @Test void onlyRealJpegOrPngWithinLimitsIsAccepted() throws Exception {
        User user = api.register();
        assertThat(status(upload(null, png(10, 10, false), "a.png", "image/png"))).isEqualTo(401);
        assertThat(status(upload(user, "not an image at all".getBytes(StandardCharsets.UTF_8), "a.png", "image/png"))).as("看文件头，不看扩展名").isEqualTo(400);
        assertThat(status(upload(user, "GIF89a....".getBytes(StandardCharsets.US_ASCII), "a.gif", "image/gif"))).isEqualTo(400);
        assertThat(status(upload(user, pngHeaderOnly(7000, 7000), "bomb.png", "image/png"))).as("只读文件头就拒绝超大尺寸").isEqualTo(400);
        byte[] tooBig = new byte[5 * 1024 * 1024 + 1];
        tooBig[0] = (byte) 0xFF; tooBig[1] = (byte) 0xD8; tooBig[2] = (byte) 0xFF;
        assertThat(status(upload(user, tooBig, "big.jpg", "image/jpeg"))).isEqualTo(413);
        byte[] corrupt = new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0, 1, 2, 3};
        assertThat(status(upload(user, corrupt, "broken.jpg", "image/jpeg"))).isEqualTo(400);

        JsonNode wide = api.data(upload(user, png(3000, 1000, false), "wide.png", "image/png"));
        assertThat(wide.path("width").asInt()).as("最长边缩到 1600").isEqualTo(1600);
        assertThat(wide.path("height").asInt()).isEqualTo(533);
        JsonNode transparent = api.data(upload(user, png(40, 40, true), "t.png", "image/png"));
        BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(fetch(transparent.path("url").asText()).getResponse().getContentAsByteArray()));
        assertThat(decoded.getRGB(5, 5) & 0xFFFFFF).as("透明背景铺白").isEqualTo(0xFFFFFF);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM uploaded_images WHERE owner_user_id=?::uuid", Integer.class, user.id())).isEqualTo(2);
    }

    @Test void productsMayOnlyUseTheSellersOwnActiveUploadsAndResponsesCarrySignedUrls() throws Exception {
        User seller = api.register(), stranger = api.register(), viewer = api.register();
        String mine = api.data(upload(seller, png(50, 50, false), "mine.png", "image/png")).path("ref").asText();
        String theirs = api.data(upload(stranger, png(50, 50, false), "theirs.png", "image/png")).path("ref").asText();
        Map<String, Object> body = SupplyApi.single("其他", "带真实图片的商品", 20);
        body.put("images", List.of(mine, "https://example.invalid/a.png"));
        JsonNode product = api.ok(api.post(seller, "/v1/products", body));
        String productId = product.path("id").asText();
        String signed = api.ok(api.get(viewer, "/v1/products/" + productId)).path("images").get(0).asText();
        assertThat(signed).startsWith("/v1/images/" + mine.substring(7) + "?exp=");
        assertThat(api.ok(api.get(viewer, "/v1/products/" + productId)).path("images").get(1).asText()).as("外部示例图原样").isEqualTo("https://example.invalid/a.png");
        assertThat(status(fetch(signed))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT images->>0 FROM products WHERE id=?::uuid", String.class, productId)).as("库里只存引用").isEqualTo(mine);

        body.put("images", List.of(theirs));
        MvcResult foreign = api.post(seller, "/v1/products", body);
        assertThat(status(foreign)).isEqualTo(400);
        assertThat(api.body(foreign).path("message").asText()).isEqualTo("只能使用自己上传的图片，请重新上传");
        assertThat(status(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of(theirs))))).isEqualTo(400);
        assertThat(status(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of("upload:not-a-uuid"))))).isEqualTo(400);

        // 绕过接口直接写库：提交时由数据库约束触发器拒绝
        assertThatThrownBy(() -> new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(t ->
                jdbc.update("UPDATE products SET images=jsonb_build_array(?) WHERE id=?::uuid", theirs, productId)))
                .hasStackTraceContaining("only use active images uploaded by the seller");
        assertThat(jdbc.queryForObject("SELECT images->>0 FROM products WHERE id=?::uuid", String.class, productId)).isEqualTo(mine);

        // 图片被注销（或治理删除）后：已发出的签名地址同样失效
        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", mine.substring(7));
        assertThat(status(fetch(signed))).isEqualTo(404);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM uploaded_images WHERE id=?::uuid", mine.substring(7)))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    private List<String> stored(String sql, String id) throws Exception {
        return json.readValue(jdbc.queryForObject(sql, String.class, id), new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
    }

    private List<String> productImages(String productId) throws Exception {
        return stored("SELECT images::text FROM products WHERE id=?::uuid", productId);
    }

    private List<String> draftImages(String draftId) throws Exception {
        return stored("SELECT (payload->'images')::text FROM listing_drafts WHERE id=?::uuid", draftId);
    }

    private List<String> strings(JsonNode array) {
        return json.convertValue(array, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(JsonNode node) {
        return json.convertValue(node, Map.class);
    }

    /** 公开配置：不需要登录、普通信封；数值与校验实际执行的上限一致（9 张可以、10 张 400）。 */
    @Test void publicConfigIsAnonymousAndMatchesTheLimitsTheValidatorsEnforce() throws Exception {
        MvcResult result = api.get(null, "/v1/config");
        assertThat(status(result)).isEqualTo(200);
        JsonNode body = api.body(result);
        assertThat(body.path("code").asInt()).isZero();
        assertThat(body.path("message").asText()).isEqualTo("ok");
        assertThat(body.path("requestId").asText()).isNotBlank();
        assertThat(body.path("data").toString())
                .isEqualTo("{\"images\":{\"maxCount\":9,\"maxBytes\":5242880,\"accept\":[\"image/jpeg\",\"image/png\"],\"externalAllowed\":true}}");

        User seller = api.register();
        JsonNode images = body.path("data").path("images");
        Map<String, Object> product = SupplyApi.single("其他", "图片数量上限", 20);
        product.put("images", java.util.Collections.nCopies(images.path("maxCount").asInt(), "https://example.invalid/a.png"));
        assertThat(status(api.post(seller, "/v1/products", product))).as("maxCount 张可以").isEqualTo(200);
        product.put("images", java.util.Collections.nCopies(images.path("maxCount").asInt() + 1, "https://example.invalid/a.png"));
        assertThat(status(api.post(seller, "/v1/products", product))).as("多一张 400").isEqualTo(400);
        Map<String, Object> draft = new java.util.LinkedHashMap<>(Map.of("draftType", "SINGLE", "payload", Map.of("images",
                java.util.Collections.nCopies(images.path("maxCount").asInt() + 1, "https://example.invalid/a.png"))));
        assertThat(status(api.post(seller, "/v1/listing-drafts", draft))).as("草稿同一上限").isEqualTo(400);
        byte[] tooBig = new byte[images.path("maxBytes").asInt() + 1];
        tooBig[0] = (byte) 0xFF; tooBig[1] = (byte) 0xD8; tooBig[2] = (byte) 0xFF;
        assertThat(status(upload(seller, tooBig, "big.jpg", "image/jpeg"))).as("maxBytes + 1 字节 413").isEqualTo(413);
        assertThat(status(upload(seller, "GIF89a....".getBytes(StandardCharsets.US_ASCII), "a.gif", "image/gif"))).as("accept 以外的格式 400").isEqualTo(400);
    }

    /** 商品（单件、打包、批量发布）接受平台自己签发的图片地址，还原成 upload:<id> 保存；GET → PATCH 原样回写不改变库里的引用。 */
    @Test void productImagesAcceptThePlatformsOwnSignedUrlsAndStoreOnlyRefs() throws Exception {
        User seller = api.register(), stranger = api.register();
        JsonNode a = api.data(upload(seller, png(20, 20, false), "a.png", "image/png"));
        JsonNode b = api.data(upload(seller, png(21, 21, false), "b.png", "image/png"));
        String refA = a.path("ref").asText(), refB = b.path("ref").asText();
        Map<String, Object> body = SupplyApi.single("其他", "签名地址回写", 20);
        body.put("images", List.of(a.path("url").asText(),
                "https://market.example.com/api/v1/images/" + b.path("id").asText().toUpperCase() + "?exp=1&sig=forged",
                "https://example.invalid/x.png"));
        String productId = api.ok(api.post(seller, "/v1/products", body)).path("id").asText();
        assertThat(productImages(productId)).as("相对与绝对签名地址都还原成引用，签名是否有效无关").containsExactly(refA, refB, "https://example.invalid/x.png");

        JsonNode got = api.ok(api.get(seller, "/v1/products/" + productId));
        List<String> signed = strings(got.path("images"));
        assertThat(signed.get(0)).startsWith("/v1/images/" + a.path("id").asText() + "?exp=");
        assertThat(signed.get(1)).startsWith("/v1/images/" + b.path("id").asText() + "?exp=");
        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("images", signed)));
        assertThat(productImages(productId)).as("GET → PATCH 原样回写，库里的引用不变").containsExactly(refA, refB, "https://example.invalid/x.png");

        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of("/v1/images/" + b.path("id").asText()))));
        assertThat(productImages(productId)).as("不带查询串的相对路径").containsExactly(refB);

        String strangerUrl = api.data(upload(stranger, png(22, 22, false), "s.png", "image/png")).path("url").asText();
        MvcResult foreign = api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of(strangerUrl)));
        assertThat(status(foreign)).as("别人的签名地址：还原后仍按上传人拒绝").isEqualTo(400);
        assertThat(api.body(foreign).path("message").asText()).isEqualTo("只能使用自己上传的图片，请重新上传");
        assertThat(productImages(productId)).containsExactly(refB);

        Map<String, Object> bundle = SupplyApi.bundle("签名地址打包", 30, 2);
        bundle.put("images", List.of(a.path("url").asText()));
        assertThat(productImages(api.ok(api.post(seller, "/v1/products", bundle)).path("id").asText())).as("整套打包").containsExactly(refA);

        Map<String, Object> draftPayload = SupplyApi.single("其他", "签名地址批量发布", 20);
        draftPayload.put("images", List.of(b.path("url").asText()));
        String draftId = api.createDraft(seller, "SINGLE", draftPayload).path("id").asText();
        assertThat(draftImages(draftId)).as("草稿里同样只存引用").containsExactly(refB);
        String batch = api.ok(api.post(seller, "/v1/listing-batches", Map.of("draftIds", List.of(draftId)))).path("id").asText();
        String published = api.ok(api.publish(seller, batch, "signed-url-batch-key")).path("productIds").get(0).asText();
        assertThat(productImages(published)).as("批量发布").containsExactly(refB);
    }

    /**
     * 草稿响应与商品响应一样给图片签名（所有者与协助人都能预览）；只给所有者本人上传、仍有效的图片签名，
     * 其他引用原样返回。GET → PATCH 原样回写（所有者与协助人）都不改变库里的引用。
     */
    @Test void draftResponsesSignOwnUploadsLikeProductsAndSavingThemBackKeepsRefs() throws Exception {
        User owner = api.register(), stranger = api.register(), assistant = api.register();
        JsonNode mine = api.data(upload(owner, png(30, 20, false), "m.png", "image/png"));
        String theirs = api.data(upload(stranger, png(30, 20, false), "t.png", "image/png")).path("ref").asText();
        String ref = mine.path("ref").asText();
        Map<String, Object> payload = SupplyApi.single("其他", "草稿图片预览", 20);
        payload.put("images", List.of(ref, "https://example.invalid/d.png", theirs));
        JsonNode created = api.createDraft(owner, "SINGLE", payload);
        String draftId = created.path("id").asText();
        List<String> createdImages = strings(created.path("payload").path("images"));
        assertThat(createdImages.get(0)).startsWith("/v1/images/" + mine.path("id").asText() + "?exp=").contains("&sig=");
        assertThat(createdImages.subList(1, 3)).as("外部地址原样；别人的图片不签名").containsExactly("https://example.invalid/d.png", theirs);
        assertThat(status(fetch(createdImages.get(0)))).isEqualTo(200);

        JsonNode got = api.ok(api.get(owner, "/v1/listing-drafts/" + draftId));
        assertThat(strings(got.path("payload").path("images")).get(0)).startsWith("/v1/images/" + mine.path("id").asText() + "?exp=");
        JsonNode listed = api.ok(api.get(owner, "/v1/listing-drafts"));
        assertThat(listed.findValues("payload").stream().map(p -> p.path("images").path(0).asText()))
                .anyMatch(u -> u.startsWith("/v1/images/" + mine.path("id").asText() + "?exp="));
        assertThat(status(api.get(stranger, "/v1/listing-drafts/" + draftId))).as("别人读不到草稿").isEqualTo(404);

        JsonNode saved = api.ok(api.saveDraft(owner, draftId, got.path("version").asInt(), asMap(got.path("payload")), null));
        assertThat(draftImages(draftId)).as("所有者 GET → PATCH 原样回写").containsExactly(ref, "https://example.invalid/d.png", theirs);
        assertThat(strings(saved.path("payload").path("images")).get(0)).startsWith("/v1/images/");

        String token = api.ok(api.post(owner, "/v1/listing-assist-invites", Map.of("draftId", draftId))).path("token").asText();
        api.ok(api.post(assistant, "/v1/listing-assist-invites/redeem", Map.of("token", token)));
        JsonNode asAssistant = api.ok(api.get(assistant, "/v1/listing-drafts/" + draftId));
        assertThat(strings(asAssistant.path("payload").path("images")).get(0)).as("协助人同样能预览").startsWith("/v1/images/" + mine.path("id").asText() + "?exp=");
        assertThat(api.ok(api.get(assistant, "/v1/listing-drafts/assisting")).toString()).contains("/v1/images/" + mine.path("id").asText() + "?exp=");
        Map<String, Object> tidy = asMap(asAssistant.path("payload"));
        tidy.put("title", "协助人整理后的标题");
        api.ok(api.saveDraft(assistant, draftId, asAssistant.path("version").asInt(), tidy, null));
        assertThat(draftImages(draftId)).as("协助人原样带回签名地址不算改动图片，引用不变").containsExactly(ref, "https://example.invalid/d.png", theirs);

        String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(draftId)))).path("id").asText();
        JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
        assertThat(detail.path("items").get(0).path("draft").path("payload").path("images").get(0).asText()).as("批次详情同样签名")
                .startsWith("/v1/images/" + mine.path("id").asText() + "?exp=");

        jdbc.update("UPDATE uploaded_images SET status='HIDDEN' WHERE id=?::uuid", mine.path("id").asText());
        assertThat(strings(api.ok(api.get(owner, "/v1/listing-drafts/" + draftId)).path("payload").path("images")).get(0))
                .as("图片失效后不再签名，原样返回引用").isEqualTo(ref);
    }

    @Test void deletingTheAccountMakesItsImagesUnreadable() throws Exception {
        User user = api.register();
        String url = api.data(upload(user, png(30, 30, false), "x.png", "image/png")).path("url").asText();
        assertThat(status(fetch(url))).isEqualTo(200);
        assertThat(status(api.post(user, "/v1/auth/me/deletion", Map.of("password", "test-password-2026", "confirmation", "确认注销")))).isEqualTo(200);
        assertThat(status(fetch(url))).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT status FROM uploaded_images WHERE owner_user_id=?::uuid", String.class, user.id())).isEqualTo("DELETED");
    }

    @Test void uploadsAreRateLimitedPerUser() throws Exception {
        User user = api.register(), other = api.register();
        byte[] tiny = png(8, 8, false);
        for (int i = 0; i < 12; i++) assertThat(status(upload(user, tiny, "t.png", "image/png"))).isEqualTo(200);
        MvcResult limited = upload(user, tiny, "t.png", "image/png");
        assertThat(status(limited)).isEqualTo(429);
        assertThat(status(upload(other, tiny, "t.png", "image/png"))).isEqualTo(200);
    }
}
