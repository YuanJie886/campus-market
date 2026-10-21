package com.lulu.campusmarketbackend.school;

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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * DEMO_SCHOOL_ENABLED=false（生产配置）：演示学校 'pilot' 不出现在学校列表，不能注册、不能把资料改到它的校区，
 * 楼栋列表为空；已经属于演示学校的老用户照常登录、改昵称、发布。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.schools.packs=aust",
        "campus-market.schools.demo-school-enabled=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DemoSchoolHiddenIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_demo").withUsername("campus_demo").withPassword("campus_demo_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "demo-school-hidden-it-secret-0123456789");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    private MvcResult register(String account, String campus) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", account);
        b.put("password", "test-password-2026");
        b.put("nickname", "演示");
        b.put("campus", campus);
        return mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
    }

    /** 演示学校隐藏之前就注册的老用户：直接写库（隐藏后已无法经接口注册），再走正常登录。 */
    private User legacyPilotUser() throws Exception {
        String account = "legacy" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?, ?, ?, '老用户', '东校区')",
                UUID.randomUUID(), account, new BCryptPasswordEncoder(4).encode("legacy-password-2026"));
        MvcResult login = mockMvc.perform(post("/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("account", account, "password", "legacy-password-2026")))).andReturn();
        JsonNode data = api.ok(login);
        return new User(data.path("user").path("id").asText(), data.path("accessToken").asText());
    }

    private static List<String> ids(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode n : array) out.add(n.path("id").asText());
        return out;
    }

    @Test
    @DisplayName("1. GET /v1/schools 不含演示学校，只有启用的数据包学校")
    void demoSchoolHiddenFromDirectory() throws Exception {
        JsonNode schools = api.ok(mockMvc.perform(get("/v1/schools")).andReturn());
        assertThat(ids(schools)).containsExactly("aust");
        assertThat(ids(schools.get(0).path("campuses"))).containsExactly("aust-huainan", "aust-hefei");
        assertThat(schools.toString()).doesNotContain("东校区", "pilot");
    }

    @Test
    @DisplayName("2. 注册：演示学校校区 400 校区无效；安理工校区可以注册")
    void registrationRejectsDemoCampus() throws Exception {
        MvcResult demo = register("demo" + UUID.randomUUID().toString().substring(0, 8), "东校区");
        assertThat(status(demo)).isEqualTo(400);
        assertThat(api.body(demo).path("message").asText()).isEqualTo("校区无效");
        assertThat(status(register("aust" + UUID.randomUUID().toString().substring(0, 8), "aust-hefei"))).isEqualTo(200);
    }

    @Test
    @DisplayName("3. 楼栋列表：演示学校校区返回空数组（不存在的校区仍是 400）")
    void buildingsEmptyForHiddenCampus() throws Exception {
        MvcResult hidden = mockMvc.perform(get("/v1/buildings").param("campus", "东校区")).andReturn();
        assertThat(status(hidden)).isEqualTo(200);
        assertThat(api.data(hidden).isArray()).isTrue();
        assertThat(api.data(hidden)).isEmpty();
        assertThat(status(mockMvc.perform(get("/v1/buildings").param("campus", "不存在校区")).andReturn())).isEqualTo(400);
    }

    @Test
    @DisplayName("4. 演示学校老用户照常使用：登录、读资料、改昵称（附带当前校区）、发布；但不能换校区，安理工用户也不能改到演示校区")
    void existingDemoUsersKeepWorking() throws Exception {
        User legacy = legacyPilotUser();
        assertThat(api.ok(api.get(legacy, "/v1/auth/me")).path("campus").asText()).isEqualTo("东校区");
        JsonNode updated = api.ok(api.patch(legacy, "/v1/auth/me", Map.of("nickname", "老用户改名", "campus", "东校区")));
        assertThat(updated.path("nickname").asText()).isEqualTo("老用户改名");

        MvcResult move = api.patch(legacy, "/v1/auth/me", Map.of("campus", "西校区"));
        assertThat(status(move)).isEqualTo(400);
        assertThat(api.body(move).path("message").asText()).isEqualTo("校区无效");

        Map<String, Object> product = SupplyApi.single("生活用品", "老用户照常发布", 20);
        String productId = api.ok(api.post(legacy, "/v1/products", product)).path("id").asText();
        assertThat(api.ok(api.get(legacy, "/v1/products/" + productId)).path("campus").asText()).isEqualTo("东校区");

        User aust = api.register("aust-huainan");
        assertThat(status(api.get(aust, "/v1/products/" + productId))).as("跨校不可见").isEqualTo(404);
        MvcResult austMove = api.patch(aust, "/v1/auth/me", Map.of("campus", "东校区"));
        assertThat(status(austMove)).isEqualTo(400);
        assertThat(api.body(austMove).path("message").asText()).isEqualTo("校区无效");
    }
}
