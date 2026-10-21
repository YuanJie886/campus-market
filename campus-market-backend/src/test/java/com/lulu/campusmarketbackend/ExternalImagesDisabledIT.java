package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
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

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/**
 * 外部图片开关关闭（campus-market.images.allow-external=false，即 ALLOW_EXTERNAL_IMAGES=false）：
 * 新提交的 http(s) 图片在单件、打包、草稿、批量发布里一律 400；编辑时这件商品 / 这份草稿原有的外部地址可以保留；
 * 上传图片的引用与平台自己的签名地址不受影响；后台编辑不接受图片字段。
 */
@Testcontainers
@SpringBootTest(properties = "campus-market.images.allow-external=false")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ExternalImagesDisabledIT {
    static final String MESSAGE = "不支持外部图片链接，请先上传图片";
    static final String LEGACY = "https://legacy.example.invalid/old.png";

    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final java.nio.file.Path IMAGE_DIR;
    static {
        try { IMAGE_DIR = Files.createTempDirectory("cm-images-external-it-"); } catch (Exception e) { throw new IllegalStateException(e); }
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

    private JsonNode upload(User who) throws Exception {
        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        MvcResult r = mvc.perform(multipart("/v1/images").file(new MockMultipartFile("file", "x.png", "image/png", out.toByteArray()))
                .header("Authorization", "Bearer " + who.token())).andReturn();
        return api.ok(r);
    }

    private List<String> stored(String sql, String id) throws Exception {
        return json.readValue(jdbc.queryForObject(sql, String.class, id), new TypeReference<List<String>>() {});
    }

    private List<String> productImages(String productId) throws Exception {
        return stored("SELECT images::text FROM products WHERE id=?::uuid", productId);
    }

    private List<String> draftImages(String draftId) throws Exception {
        return stored("SELECT (payload->'images')::text FROM listing_drafts WHERE id=?::uuid", draftId);
    }

    private void assertExternalRejected(MvcResult result) throws Exception {
        assertThat(status(result)).as(result.getResponse().getContentAsString()).isEqualTo(400);
        assertThat(api.body(result).path("message").asText()).isEqualTo(MESSAGE);
    }

    private Map<String, Object> single(String title, List<String> images) {
        Map<String, Object> body = SupplyApi.single("其他", title, 20);
        body.put("images", images);
        return body;
    }

    @Test void configReportsTheSwitch() throws Exception {
        JsonNode images = api.ok(api.get(null, "/v1/config")).path("images");
        assertThat(images.path("externalAllowed").asBoolean()).isFalse();
        assertThat(images.path("maxCount").asInt()).isEqualTo(9);
    }

    @Test void newExternalImagesAreRejectedEverywhereButUploadsAndSignedUrlsStillWork() throws Exception {
        User seller = api.register();
        JsonNode mine = upload(seller);
        String ref = mine.path("ref").asText();

        assertExternalRejected(api.post(seller, "/v1/products", single("外部图片单件", List.of(ref, "https://example.invalid/a.png"))));
        assertExternalRejected(api.post(seller, "/v1/products", single("外部图片单件 http", List.of("http://example.invalid/a.png"))));
        assertExternalRejected(api.post(seller, "/v1/products", SupplyApi.bundle("外部图片打包", 30, 2)));
        Map<String, Object> draft = new LinkedHashMap<>();
        draft.put("draftType", "SINGLE");
        draft.put("payload", single("外部图片草稿", List.of("https://example.invalid/a.png")));
        assertExternalRejected(api.post(seller, "/v1/listing-drafts", draft));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE seller_id=?::uuid", Integer.class, seller.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM listing_drafts WHERE owner_user_id=?::uuid", Integer.class, seller.id())).isZero();

        // 上传引用、相对签名地址、以平台路径结尾的绝对签名地址都不算外部图片
        String a = api.ok(api.post(seller, "/v1/products", single("上传图片单件", List.of(ref)))).path("id").asText();
        assertThat(productImages(a)).containsExactly(ref);
        String b = api.ok(api.post(seller, "/v1/products", single("签名地址单件", List.of(mine.path("url").asText())))).path("id").asText();
        assertThat(productImages(b)).containsExactly(ref);
        String c = api.ok(api.post(seller, "/v1/products", single("绝对签名地址单件",
                List.of("https://market.example.com/v1/images/" + mine.path("id").asText() + "?exp=1&sig=x")))).path("id").asText();
        assertThat(productImages(c)).containsExactly(ref);
        Map<String, Object> bundle = SupplyApi.bundle("上传图片打包", 30, 2);
        bundle.put("images", List.of(ref));
        assertThat(status(api.post(seller, "/v1/products", bundle))).isEqualTo(200);

        // 编辑：加入新的外部地址同样 400，库里不变
        assertExternalRejected(api.patch(seller, "/v1/products/" + a, Map.of("images", List.of(ref, "https://example.invalid/new.png"))));
        assertThat(productImages(a)).containsExactly(ref);

        // 草稿：上传引用照常保存；保存时加入新的外部地址 400
        JsonNode saved = api.createDraft(seller, "SINGLE", single("上传图片草稿", List.of(ref)));
        String draftId = saved.path("id").asText();
        assertExternalRejected(api.saveDraft(seller, draftId, saved.path("version").asInt(), single("上传图片草稿", List.of(ref, "https://example.invalid/n.png")), null));
        assertThat(draftImages(draftId)).containsExactly(ref);
    }

    @Test void legacyExternalImagesStayEditableOnTheSameListingOnly() throws Exception {
        User seller = api.register();
        JsonNode mine = upload(seller);
        String ref = mine.path("ref").asText();
        String productId = api.ok(api.post(seller, "/v1/products", single("开关关闭前发布的商品", List.of(ref)))).path("id").asText();
        String other = api.ok(api.post(seller, "/v1/products", single("另一件商品", List.of(ref)))).path("id").asText();
        // 模拟开关关闭之前就已经存在的外部图片
        jdbc.update("UPDATE products SET images=jsonb_build_array(?, ?) WHERE id=?::uuid", LEGACY, ref, productId);

        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("title", "只改标题")));
        assertThat(productImages(productId)).as("不碰图片的编辑照常").containsExactly(LEGACY, ref);

        List<String> fromGet = json.convertValue(api.ok(api.get(seller, "/v1/products/" + productId)).path("images"), new TypeReference<List<String>>() {});
        assertThat(fromGet.get(0)).isEqualTo(LEGACY);
        assertThat(fromGet.get(1)).startsWith("/v1/images/");
        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("images", fromGet)));
        assertThat(productImages(productId)).as("GET → PATCH 原样回写：原有外部地址保留，签名地址还原成引用").containsExactly(LEGACY, ref);
        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of(ref, LEGACY))));
        assertThat(productImages(productId)).as("调整顺序也可以").containsExactly(ref, LEGACY);

        assertExternalRejected(api.patch(seller, "/v1/products/" + other, Map.of("images", List.of(LEGACY))));
        assertThat(productImages(other)).as("别的商品不能借用这个外部地址").containsExactly(ref);

        api.ok(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of(ref))));
        assertExternalRejected(api.patch(seller, "/v1/products/" + productId, Map.of("images", List.of(ref, LEGACY))));
        assertThat(productImages(productId)).as("移除之后就不再是原有图片，不能再加回").containsExactly(ref);
    }

    @Test void legacyExternalImagesInDraftsCanBeKeptButNotPublished() throws Exception {
        User owner = api.register();
        String ref = upload(owner).path("ref").asText();
        JsonNode created = api.createDraft(owner, "SINGLE", single("开关关闭前的草稿", List.of(ref)));
        String draftId = created.path("id").asText();
        jdbc.update("UPDATE listing_drafts SET payload = jsonb_set(payload, '{images}', jsonb_build_array(?, ?)) WHERE id=?::uuid", LEGACY, ref, draftId);

        JsonNode got = api.ok(api.get(owner, "/v1/listing-drafts/" + draftId));
        @SuppressWarnings("unchecked") Map<String, Object> payload = json.convertValue(got.path("payload"), Map.class);
        payload.put("title", "草稿照常保存");
        api.ok(api.saveDraft(owner, draftId, got.path("version").asInt(), payload, null));
        assertThat(draftImages(draftId)).as("草稿原有的外部地址可以保留").containsExactly(LEGACY, ref);

        MvcResult ready = api.saveDraft(owner, draftId, got.path("version").asInt() + 1, payload, "READY");
        assertThat(status(ready)).isEqualTo(400);
        assertThat(api.body(ready).path("data").path("code").asText()).isEqualTo("INVALID_FIELD");
        assertThat(api.body(ready).path("message").asText()).contains(MESSAGE);

        String batch = api.ok(api.post(owner, "/v1/listing-batches", Map.of("draftIds", List.of(draftId)))).path("id").asText();
        JsonNode detail = api.ok(api.get(owner, "/v1/listing-batches/" + batch));
        assertThat(detail.path("allValid").asBoolean()).isFalse();
        assertThat(detail.path("items").get(0).path("validation").path("message").asText()).isEqualTo(MESSAGE);
        MvcResult publish = api.publish(owner, batch, "external-disabled-batch");
        assertThat(status(publish)).as("批量发布时同样拒绝").isEqualTo(400);
        assertThat(api.body(publish).path("data").path("items").get(0).path("message").asText()).isEqualTo(MESSAGE);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE seller_id=?::uuid", Integer.class, owner.id())).isZero();
    }

    @Test void adminEditsCannotSetImagesAndKeepLegacyOnes() throws Exception {
        User seller = api.register(), admin = api.register();
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'SCHOOL_ADMIN')", admin.id());
        String ref = upload(seller).path("ref").asText();
        String productId = api.ok(api.post(seller, "/v1/products", single("后台编辑的商品", List.of(ref)))).path("id").asText();
        jdbc.update("UPDATE products SET images=jsonb_build_array(?) WHERE id=?::uuid", LEGACY, productId);
        String version = api.ok(api.get(admin, "/v1/admin/products/" + productId)).path("version").asText();

        Map<String, Object> edit = new LinkedHashMap<>(Map.of("title", "后台核对后的标题", "description", "后台核对后的描述", "price", 18, "note", "核对", "version", version));
        edit.put("images", List.of("https://example.invalid/admin.png"));
        MvcResult withImages = api.patch(admin, "/v1/admin/products/" + productId, edit);
        assertThat(status(withImages)).as("后台编辑不接受图片字段").isEqualTo(400);
        assertThat(productImages(productId)).containsExactly(LEGACY);

        edit.remove("images");
        api.ok(api.patch(admin, "/v1/admin/products/" + productId, edit));
        assertThat(productImages(productId)).as("后台改文字不影响原有图片").containsExactly(LEGACY);
        assertThat(jdbc.queryForObject("SELECT title FROM products WHERE id=?::uuid", String.class, productId)).isEqualTo("后台核对后的标题");
    }
}
