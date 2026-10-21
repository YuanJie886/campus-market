package com.lulu.campusmarketbackend.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * V23：默认（REGISTRATION_INVITE_REQUIRED 未设置 = false）时注册行为不变：不带邀请码照常注册；
 * 带 inviteCode 字段照常接受但完全忽略（不校验、不占用任何邀请码）；公开配置报告 inviteRequired=false。
 */
@Testcontainers
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RegistrationInviteDefaultModeIT {
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
    @Autowired RegistrationInvites invites;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private MvcResult register(Object inviteCode, boolean includeField) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "df" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "默认注册");
        b.put("campus", "东校区");
        if (includeField) b.put("inviteCode", inviteCode);
        return mvc.perform(MockMvcRequestBuilders.post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
    }

    @Test void registeringWithoutAnInviteCodeStillWorks() throws Exception {
        assertThat(invites.required()).isFalse();
        JsonNode session = api.ok(register(null, false));
        assertThat(session.path("accessToken").asText()).isNotBlank();
        assertThat(session.path("user").path("nickname").asText()).isEqualTo("默认注册");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invite_uses", Integer.class)).isZero();
    }

    @Test void anInviteCodeIsAcceptedButIgnored() throws Exception {
        RegistrationInvites.Issued issued = invites.issue("pilot", 1, 7, null, null);
        for (Object code : new Object[] {issued.code(), "garbage", "", 42, null}) {
            assertThat(status(register(code, true))).as("inviteCode=%s", code).isEqualTo(200);
        }
        assertThat(jdbc.queryForObject("SELECT used_count FROM registration_invites WHERE id = ?", Integer.class, issued.id()))
                .as("不要求邀请码时不占用").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invite_uses", Integer.class)).isZero();
        MvcResult role = mvc.perform(MockMvcRequestBuilders.post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("account", "df-role-" + UUID.randomUUID().toString().substring(0, 8), "password", "test-password-2026",
                        "nickname", "默认注册", "campus", "东校区", "inviteCode", issued.code(), "role", "SCHOOL_ADMIN")))).andReturn();
        assertThat(status(role)).as("其他未知字段仍然 400").isEqualTo(400);
        assertThat(api.body(role).path("message").asText()).isEqualTo("请求包含不支持的字段：role");
    }

    @Test void publicConfigSaysInvitesAreNotRequiredAndKeepsTheOtherSections() throws Exception {
        JsonNode data = api.ok(api.get(null, "/v1/config"));
        assertThat(data.path("registration").toString()).isEqualTo("{\"inviteRequired\":false}");
        assertThat(data.path("messages").toString()).isEqualTo("{\"freeTextEnabled\":false}");
        assertThat(data.path("images").toString())
                .isEqualTo("{\"maxCount\":9,\"maxBytes\":5242880,\"accept\":[\"image/jpeg\",\"image/png\"],\"externalAllowed\":true}");
    }
}
