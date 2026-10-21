package com.lulu.campusmarketbackend;

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
import java.util.List;
import java.util.Map;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/**
 * 外部图片开关关闭（campus-market.images.allow-external=false）时的头像：新的 http(s) 头像一律 400，
 * 预设、本人上传、平台签名地址（含以平台路径结尾的绝对地址）照常可用；库里已有的外部头像展示时原样返回。
 */
@Testcontainers
@SpringBootTest(properties = "campus-market.images.allow-external=false")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AvatarExternalDisabledIT {
    static final String MESSAGE = "不支持外部头像链接，请选择预设头像或上传图片";

    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    static final java.nio.file.Path IMAGE_DIR;
    static {
        try { IMAGE_DIR = Files.createTempDirectory("cm-avatar-external-it-"); } catch (Exception e) { throw new IllegalStateException(e); }
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
        MvcResult r = mvc.perform(multipart("/v1/images").file(new MockMultipartFile("file", "a.png", "image/png", out.toByteArray()))
                .header("Authorization", "Bearer " + who.token())).andReturn();
        return api.ok(r);
    }

    private String stored(User who) {
        return jdbc.queryForObject("SELECT avatar FROM users WHERE id=?::uuid", String.class, who.id());
    }

    @Test void externalAvatarUrlsAreRejected() throws Exception {
        User user = api.register();
        api.ok(api.patch(user, "/v1/auth/me", Map.of("avatar", "preset:1")));
        for (String external : List.of("https://picsum.photos/seed/x/200/200", "http://cdn.example.invalid/a.png", "https://example.invalid/v1/images/not-a-uuid")) {
            MvcResult r = api.patch(user, "/v1/auth/me", Map.of("avatar", external));
            assertThat(status(r)).as(r.getResponse().getContentAsString()).isEqualTo(400);
            assertThat(api.body(r).path("message").asText()).isEqualTo(MESSAGE);
            assertThat(stored(user)).isEqualTo("preset:1");
        }
        // 非法预设仍是「头像无效」，不是外部链接提示
        MvcResult bad = api.patch(user, "/v1/auth/me", Map.of("avatar", "preset:13"));
        assertThat(status(bad)).isEqualTo(400);
        assertThat(api.body(bad).path("message").asText()).isEqualTo("头像无效");
    }

    @Test void presetsUploadsAndPlatformSignedUrlsStillWork() throws Exception {
        User user = api.register();
        assertThat(api.ok(api.patch(user, "/v1/auth/me", Map.of("avatar", "preset:12"))).path("avatar").asText()).isEqualTo("preset:12");
        JsonNode image = upload(user);
        String id = image.path("id").asText();
        api.ok(api.patch(user, "/v1/auth/me", Map.of("avatar", image.path("ref").asText())));
        assertThat(stored(user)).isEqualTo("upload:" + id);
        String signed = api.ok(api.get(user, "/v1/auth/me")).path("avatar").asText();
        assertThat(signed).startsWith("/v1/images/" + id + "?exp=");
        // 以平台路径结尾的 https 绝对地址是平台自己的签名地址，不算外部链接
        api.ok(api.patch(user, "/v1/auth/me", Map.of("avatar", "")));
        api.ok(api.patch(user, "/v1/auth/me", Map.of("avatar", "https://market.example.com" + signed)));
        assertThat(stored(user)).isEqualTo("upload:" + id);
    }

    @Test void legacyExternalAvatarsAreStillDisplayedUnchanged() throws Exception {
        User user = api.register(), viewer = api.register();
        jdbc.update("UPDATE users SET avatar='https://legacy.example.invalid/me.png' WHERE id=?::uuid", user.id());
        assertThat(api.ok(api.get(viewer, "/v1/users/" + user.id())).path("avatar").asText()).isEqualTo("https://legacy.example.invalid/me.png");
        // 修改其他资料不受影响；原样提交旧外部头像按契约同样拒绝
        api.ok(api.patch(user, "/v1/auth/me", Map.of("nickname", "旧头像用户")));
        assertThat(stored(user)).isEqualTo("https://legacy.example.invalid/me.png");
        MvcResult resubmit = api.patch(user, "/v1/auth/me", Map.of("avatar", "https://legacy.example.invalid/me.png"));
        assertThat(status(resubmit)).isEqualTo(400);
        assertThat(api.body(resubmit).path("message").asText()).isEqualTo(MESSAGE);
    }
}
