package com.lulu.campusmarketbackend.school;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.CampusMarketBackendApplication;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
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
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 学校数据包：启动导入、校验和跳过、变更与停用、非法数据包启动失败、多个数据包、GET /v1/schools、
 * 安徽理工大学注册、演示学校与安理工的隔离、停用校区的楼栋列表。
 *
 * <p>本上下文启用 aust（内置）与 tpu（临时目录里的测试数据包）。「重启」用同一个数据库再启动一个
 * 不带 Web 服务的应用实例来模拟，和生产环境重启走的是同一条启动路径。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
        "campus-market.schools.packs=aust,tpu",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SchoolPackImportIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_packs").withUsername("campus_packs").withPassword("campus_packs_only");

    static final String SECRET = "school-pack-import-it-secret-0123456789";
    static final Path PACKS = tempDir("packs");

    static final String TPU = """
            {"id":"tpu","name":"测试大学","shortName":"测大","coordinateSystem":"GCJ-02","sortOrder":5,
             "campuses":[
              {"id":"tpu-north","name":"北苑","sortOrder":2,"buildings":[]},
              {"id":"tpu-main","name":"主校区","sortOrder":1,"buildings":[
                {"id":"tpu-main-1","zone":"东区","name":"1号楼","latitude":32.61,"longitude":116.98,"sortOrder":1},
                {"id":"tpu-main-2","zone":"东区","name":"2号楼","sortOrder":2}]}]}
            """;

    static {
        write(PACKS, "tpu", TPU);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> SECRET);
        registry.add("campus-market.schools.packs-dir", PACKS::toString);
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired SchoolPackImporter importer;
    SupplyApi api;

    @BeforeEach
    void setUp() {
        api = new SupplyApi(mockMvc, json);
    }

    // ------------------------------------------------------------------ helpers

    static Path tempDir(String prefix) {
        try {
            return Files.createTempDirectory("school-" + prefix);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static void write(Path dir, String id, String content) {
        try {
            Files.writeString(dir.resolve(id + ".json"), content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 用同一个数据库启动一个新的应用实例（不启动 Web 服务），等同于重启 / 第二个实例启动。 */
    static ConfigurableApplicationContext boot(String packs, Path dir) {
        return new SpringApplicationBuilder(CampusMarketBackendApplication.class)
                .web(WebApplicationType.NONE)
                .profiles("test")
                .run("--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "--spring.datasource.username=" + POSTGRES.getUsername(),
                        "--spring.datasource.password=" + POSTGRES.getPassword(),
                        "--spring.datasource.driver-class-name=org.postgresql.Driver",
                        "--spring.flyway.enabled=true",
                        "--campus-market.jwt-secret=" + SECRET,
                        "--campus-market.schools.packs=" + packs,
                        "--campus-market.schools.packs-dir=" + dir);
    }

    static String messages(Throwable t) {
        StringBuilder all = new StringBuilder();
        for (Throwable c = t; c != null; c = c.getCause()) all.append(c.getMessage()).append('\n');
        return all.toString();
    }

    int imports(String school) {
        return jdbc.queryForObject("SELECT count(*) FROM school_pack_imports WHERE school_id = ?", Integer.class, school);
    }

    JsonNode lastSummary(String school) throws Exception {
        return json.readTree(jdbc.queryForObject(
                "SELECT summary::text FROM school_pack_imports WHERE school_id = ? ORDER BY id DESC LIMIT 1", String.class, school));
    }

    MvcResult register(String campus) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "pk" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "数据包");
        b.put("campus", campus);
        return mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
    }

    String userSchool(String userId) {
        return jdbc.queryForObject("SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = ?::uuid",
                String.class, userId);
    }

    MvcResult publish(User seller, String campus, String title, String buildingId) throws Exception {
        Map<String, Object> b = SupplyApi.single("生活用品", title, 30);
        b.put("campus", campus);
        if (buildingId != null) b.put("buildingId", buildingId);
        return api.post(seller, "/v1/products", b);
    }

    String message(MvcResult r) throws Exception {
        return api.body(r).path("message").asText();
    }

    static List<String> ids(JsonNode array, String field) {
        List<String> out = new ArrayList<>();
        for (JsonNode n : array) out.add(n.path(field).asText());
        return out;
    }

    // ------------------------------------------------------------------ tests

    @Test
    @DisplayName("1. 启动导入：学校 / 校区 / 楼栋写入数据库，每个数据包记一条导入记录（校验和 + 摘要）；导入记录只增不改")
    void startupImportCreatesRows() throws Exception {
        Map<String, Object> aust = jdbc.queryForMap("SELECT name, short_name, active, sort_order FROM schools WHERE id = 'aust'");
        assertThat(aust).containsEntry("name", "安徽理工大学").containsEntry("short_name", "安理工")
                .containsEntry("active", true).containsEntry("sort_order", 0);
        assertThat(jdbc.queryForList("SELECT id, name, sort_order, active FROM campuses WHERE school_id = 'aust' ORDER BY sort_order"))
                .containsExactly(
                        Map.of("id", "aust-huainan", "name", "淮南校区", "sort_order", 1, "active", true),
                        Map.of("id", "aust-hefei", "name", "合肥校区", "sort_order", 2, "active", true));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM buildings b JOIN campuses c ON c.id = b.campus_id WHERE c.school_id = 'aust'",
                Integer.class)).as("安理工楼栋数据尚未取得，不得编造").isZero();

        Map<String, Object> b1 = jdbc.queryForMap("SELECT campus_id, zone, name, latitude, longitude, sort_order, active FROM buildings WHERE id = 'tpu-main-1'");
        assertThat(b1).containsEntry("campus_id", "tpu-main").containsEntry("zone", "东区").containsEntry("name", "1号楼")
                .containsEntry("latitude", 32.61).containsEntry("longitude", 116.98).containsEntry("sort_order", 1).containsEntry("active", true);
        Map<String, Object> b2 = jdbc.queryForMap("SELECT latitude, longitude FROM buildings WHERE id = 'tpu-main-2'");
        assertThat(b2.get("latitude")).isNull();
        assertThat(b2.get("longitude")).isNull();

        assertThat(imports("aust")).isEqualTo(1);
        assertThat(imports("tpu")).isEqualTo(1);
        String expected = SchoolPackValidator.sha256(Files.readAllBytes(PACKS.resolve("tpu.json")));
        assertThat(jdbc.queryForObject("SELECT checksum FROM school_pack_imports WHERE school_id = 'tpu'", String.class)).isEqualTo(expected);
        JsonNode summary = lastSummary("tpu");
        assertThat(summary.path("school").asText()).isEqualTo("inserted");
        assertThat(summary.path("coordinateSystem").asText()).isEqualTo("GCJ-02");
        assertThat(summary.path("campuses").path("inserted").asInt()).isEqualTo(2);
        assertThat(summary.path("buildings").path("inserted").asInt()).isEqualTo(2);
        assertThat(summary.path("buildingsWithCoordinates").asInt()).isEqualTo(1);
        assertThat(lastSummary("aust").path("source").asText()).isEqualTo("classpath:schools/aust.json");

        assertThatThrownBy(() -> jdbc.update("UPDATE school_pack_imports SET checksum = repeat('0', 64)")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM school_pack_imports")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.execute("TRUNCATE school_pack_imports")).isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("2. 重启且数据包校验和未变：不再导入（不覆盖库中数据、不新增导入记录）")
    void restartWithSameChecksumSkips() {
        int austBefore = imports("aust"), tpuBefore = imports("tpu");
        jdbc.update("UPDATE campuses SET name = '人工改名' WHERE id = 'tpu-north'");
        try {
            try (ConfigurableApplicationContext ignored = boot("aust,tpu", PACKS)) {
                assertThat(imports("aust")).isEqualTo(austBefore);
                assertThat(imports("tpu")).isEqualTo(tpuBefore);
                assertThat(jdbc.queryForObject("SELECT name FROM campuses WHERE id = 'tpu-north'", String.class))
                        .as("校验和相同就跳过，不重新写入").isEqualTo("人工改名");
            }
            assertThat(importer.importConfigured()).allSatisfy(r -> assertThat(r.imported()).isFalse());
        } finally {
            jdbc.update("UPDATE campuses SET name = '北苑' WHERE id = 'tpu-north'");
        }
    }

    @Test
    @DisplayName("3. 数据包变更后重启：改名改坐标、新增楼栋可沿用已删楼栋的名字、删掉的楼栋与校区停用但保留，旧商品与资料照常引用；停用校区的楼栋列表为空")
    void changedPackUpdatesAndDeactivates() throws Exception {
        Path dir = tempDir("chg");
        write(dir, "chg-u", """
                {"id":"chg-u","name":"变更大学","coordinateSystem":"WGS-84","campuses":[
                  {"id":"chg-a","name":"甲校区","sortOrder":1,"buildings":[
                    {"id":"chg-a-1","zone":"一区","name":"1号楼","latitude":31.1,"longitude":117.1,"sortOrder":1},
                    {"id":"chg-a-2","zone":"一区","name":"2号楼","latitude":31.2,"longitude":117.2,"sortOrder":2},
                    {"id":"chg-a-3","zone":"二区","name":"3号楼","latitude":31.3,"longitude":117.3,"sortOrder":3}]},
                  {"id":"chg-b","name":"乙校区","sortOrder":2,"buildings":[
                    {"id":"chg-b-1","zone":"南区","name":"1号楼","sortOrder":1}]}]}
                """);
        try (ConfigurableApplicationContext ignored = boot("chg-u", dir)) {
            assertThat(imports("chg-u")).isEqualTo(1);
        }

        // 用户住在 3 号楼、在 3 号楼发布商品
        MvcResult reg = register("chg-a");
        assertThat(status(reg)).as(reg.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode session = api.data(reg);
        User seller = new User(session.path("user").path("id").asText(), session.path("accessToken").asText());
        assertThat(userSchool(seller.id())).isEqualTo("chg-u");
        api.ok(api.patch(seller, "/v1/auth/me", Map.of("dormBuildingId", "chg-a-3")));
        String productId = api.ok(publish(seller, "chg-a", "变更前发布", "chg-a-3")).path("id").asText();

        // v2：1 号楼改名、2 号楼改坐标、删掉 3 号楼并新增一栋沿用「3号楼」这个名字、整个乙校区删掉
        write(dir, "chg-u", """
                {"id":"chg-u","name":"变更大学（新名）","shortName":"变大","coordinateSystem":"WGS-84","campuses":[
                  {"id":"chg-a","name":"甲校区","sortOrder":1,"buildings":[
                    {"id":"chg-a-1","zone":"一区","name":"一号楼","latitude":31.1,"longitude":117.1,"sortOrder":1},
                    {"id":"chg-a-2","zone":"一区","name":"2号楼","latitude":31.25,"longitude":117.25,"sortOrder":2},
                    {"id":"chg-a-4","zone":"二区","name":"3号楼","sortOrder":4}]}]}
                """);
        try (ConfigurableApplicationContext ignored = boot("chg-u", dir)) {
            assertThat(imports("chg-u")).isEqualTo(2);
        }

        assertThat(jdbc.queryForMap("SELECT name, short_name FROM schools WHERE id = 'chg-u'"))
                .containsEntry("name", "变更大学（新名）").containsEntry("short_name", "变大");
        assertThat(jdbc.queryForObject("SELECT name FROM buildings WHERE id = 'chg-a-1'", String.class)).isEqualTo("一号楼");
        assertThat(jdbc.queryForMap("SELECT latitude, longitude FROM buildings WHERE id = 'chg-a-2'"))
                .containsEntry("latitude", 31.25).containsEntry("longitude", 117.25);
        assertThat(jdbc.queryForMap("SELECT name, active FROM buildings WHERE id = 'chg-a-3'"))
                .as("删掉的楼栋只停用，不删除").containsEntry("name", "3号楼").containsEntry("active", false);
        assertThat(jdbc.queryForObject("SELECT active FROM buildings WHERE id = 'chg-b-1'", Boolean.class)).isFalse();
        assertThat(jdbc.queryForObject("SELECT active FROM campuses WHERE id = 'chg-b'", Boolean.class)).isFalse();

        JsonNode summary = lastSummary("chg-u");
        assertThat(summary.path("school").asText()).isEqualTo("updated");
        assertThat(summary.path("campuses").path("deactivated").asInt()).isEqualTo(1);
        assertThat(summary.path("campuses").path("unchanged").asInt()).isEqualTo(1);
        assertThat(summary.path("buildings").path("inserted").asInt()).isEqualTo(1);
        assertThat(summary.path("buildings").path("updated").asInt()).isEqualTo(2);
        assertThat(summary.path("buildings").path("deactivated").asInt()).isEqualTo(2);

        // 仍被引用的停用楼栋：商品与资料照常读取
        JsonNode product = api.ok(api.get(seller, "/v1/products/" + productId));
        assertThat(product.path("buildingId").asText()).isEqualTo("chg-a-3");
        assertThat(product.path("buildingName").asText()).isEqualTo("3号楼");
        assertThat(api.ok(api.get(seller, "/v1/auth/me")).path("dormBuildingId").asText()).isEqualTo("chg-a-3");
        // 但不能再新选停用楼栋
        assertThat(status(publish(seller, "chg-a", "选停用楼栋", "chg-a-3"))).isEqualTo(400);

        JsonNode buildings = api.data(mockMvc.perform(get("/v1/buildings").param("campus", "chg-a")).andReturn());
        assertThat(ids(buildings, "id")).containsExactlyInAnyOrder("chg-a-1", "chg-a-2", "chg-a-4");
        MvcResult inactive = mockMvc.perform(get("/v1/buildings").param("campus", "chg-b")).andReturn();
        assertThat(status(inactive)).isEqualTo(200);
        assertThat(api.data(inactive)).as("停用校区的楼栋列表为空").isEmpty();

        // 停用校区：不能注册、不能发布、不能把资料改过去；GET /v1/schools 不再列出
        MvcResult regInactive = register("chg-b");
        assertThat(status(regInactive)).isEqualTo(400);
        assertThat(message(regInactive)).isEqualTo("校区无效");
        MvcResult pubInactive = publish(seller, "chg-b", "停用校区", null);
        assertThat(status(pubInactive)).isEqualTo(400);
        assertThat(message(pubInactive)).isEqualTo("校区无效");
        assertThat(status(api.patch(seller, "/v1/auth/me", Map.of("campus", "chg-b")))).isEqualTo(400);
        JsonNode schools = api.data(mockMvc.perform(get("/v1/schools")).andReturn());
        for (JsonNode s : schools) {
            if (s.path("id").asText().equals("chg-u")) assertThat(ids(s.path("campuses"), "id")).containsExactly("chg-a");
        }
        // 同一份数据包再次重启不会重复导入
        try (ConfigurableApplicationContext ignored = boot("chg-u", dir)) {
            assertThat(imports("chg-u")).isEqualTo(2);
        }
    }

    @Test
    @DisplayName("4. 非法数据包：应用启动失败，消息写明文件与字段；与其他学校的 id 冲突同样启动失败，且整个导入回滚")
    void invalidPackFailsStartup() {
        Path dir = tempDir("bad");
        write(dir, "bad-u", """
                {"id":"bad-u","name":"坏数据大学","coordinateSystem":"GCJ-02","campuses":[
                  {"id":"bad-a","name":"甲校区","buildings":[
                    {"id":"bad-a-1","zone":"一区","name":"1号楼","latitude":60.5,"longitude":117.1}]}]}
                """);
        assertThatThrownBy(() -> boot("bad-u", dir).close())
                .satisfies(e -> assertThat(messages(e)).contains("bad-u.json", "campuses[0].buildings[0].latitude", "不在中国范围内"));

        write(dir, "missing-field", "{\"id\":\"missing-field\",\"name\":\"x\",\"campuses\":[]}");
        assertThatThrownBy(() -> boot("missing-field", dir).close())
                .satisfies(e -> assertThat(messages(e)).contains("missing-field.json", "coordinateSystem", "必填"));

        // 同一事务：第一个数据包合法、第二个的校区 id 已属于 tpu → 两个都不写入
        write(dir, "ok-u", """
                {"id":"ok-u","name":"合法大学","coordinateSystem":"GCJ-02","campuses":[{"id":"ok-a","name":"甲校区","buildings":[]}]}
                """);
        write(dir, "coll-u", """
                {"id":"coll-u","name":"冲突大学","coordinateSystem":"GCJ-02","campuses":[{"id":"tpu-main","name":"抢占","buildings":[]}]}
                """);
        assertThatThrownBy(() -> boot("ok-u,coll-u", dir).close())
                .satisfies(e -> assertThat(messages(e)).contains("coll-u.json", "campuses[0].id", "已属于学校 'tpu'"));
        write(dir, "coll-b", """
                {"id":"coll-b","name":"冲突大学乙","coordinateSystem":"GCJ-02","campuses":[{"id":"coll-b-a","name":"甲校区","buildings":[
                  {"id":"tpu-main-1","zone":"一区","name":"抢占楼"}]}]}
                """);
        assertThatThrownBy(() -> boot("coll-b", dir).close())
                .satisfies(e -> assertThat(messages(e)).contains("coll-b.json", "campuses[0].buildings[0].id", "已属于学校 'tpu'"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM schools WHERE id IN ('bad-u','missing-field','ok-u','coll-u','coll-b')", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM school_pack_imports WHERE school_id IN ('ok-u','coll-u','coll-b')", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT school_id FROM campuses WHERE id = 'tpu-main'", String.class)).isEqualTo("tpu");
        assertThat(jdbc.queryForObject("SELECT campus_id FROM buildings WHERE id = 'tpu-main-1'", String.class)).isEqualTo("tpu-main");
    }

    @Test
    @DisplayName("5. 两个数据包 + 演示学校：GET /v1/schools 无需登录，普通信封，字段与排序（sort_order → 名称）、hasBuildings 正确")
    void schoolsEndpointShapeOrderAndHasBuildings() throws Exception {
        MvcResult r = mockMvc.perform(get("/v1/schools")).andReturn();
        assertThat(status(r)).isEqualTo(200);
        JsonNode body = api.body(r);
        assertThat(body.path("code").asInt()).isZero();
        JsonNode schools = body.path("data");
        List<String> order = ids(schools, "id").stream().filter(List.of("aust", "pilot", "tpu")::contains).toList();
        assertThat(order).as("sort_order 相同（0）按名称码点序：安 < 试；tpu 的 sort_order=5 排最后").containsExactly("aust", "pilot", "tpu");

        Map<String, JsonNode> byId = new LinkedHashMap<>();
        for (JsonNode s : schools) byId.put(s.path("id").asText(), s);
        for (JsonNode s : schools) {
            assertThat(fieldNames(s)).containsExactly("id", "name", "shortName", "campuses");
            for (JsonNode c : s.path("campuses")) assertThat(fieldNames(c)).containsExactly("id", "name", "hasBuildings");
        }
        JsonNode aust = byId.get("aust");
        assertThat(aust.path("name").asText()).isEqualTo("安徽理工大学");
        assertThat(aust.path("shortName").asText()).isEqualTo("安理工");
        assertThat(ids(aust.path("campuses"), "id")).as("按 sort_order：淮南 1、合肥 2（而不是按名称）").containsExactly("aust-huainan", "aust-hefei");
        assertThat(ids(aust.path("campuses"), "name")).containsExactly("淮南校区", "合肥校区");
        assertThat(ids(aust.path("campuses"), "hasBuildings")).containsExactly("false", "false");

        JsonNode pilot = byId.get("pilot");
        assertThat(pilot.path("shortName").isNull()).isTrue();
        assertThat(ids(pilot.path("campuses"), "id")).containsExactly("东校区", "北校区", "南校区", "西校区");
        assertThat(ids(pilot.path("campuses"), "hasBuildings")).containsOnly("true");

        JsonNode tpu = byId.get("tpu");
        assertThat(ids(tpu.path("campuses"), "id")).containsExactly("tpu-main", "tpu-north");
        assertThat(ids(tpu.path("campuses"), "hasBuildings")).containsExactly("true", "false");

        // 楼栋全部停用后 hasBuildings 变为 false；停用的学校整个不列出
        jdbc.update("UPDATE buildings SET active = false WHERE campus_id = 'tpu-main'");
        jdbc.update("UPDATE schools SET active = false WHERE id = 'aust'");
        try {
            JsonNode after = api.data(mockMvc.perform(get("/v1/schools")).andReturn());
            assertThat(ids(after, "id")).doesNotContain("aust");
            for (JsonNode s : after) {
                if (s.path("id").asText().equals("tpu")) assertThat(ids(s.path("campuses"), "hasBuildings")).containsOnly("false");
            }
            assertThat(status(register("aust-huainan"))).as("停用学校的校区不能注册").isEqualTo(400);
        } finally {
            jdbc.update("UPDATE buildings SET active = true WHERE id IN ('tpu-main-1','tpu-main-2')");
            jdbc.update("UPDATE schools SET active = true WHERE id = 'aust'");
        }
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    @Test
    @DisplayName("6. 用安理工淮南校区注册：学校由校区推导为 aust；楼栋列表为空数组")
    void registerWithAustCampus() throws Exception {
        MvcResult r = register("aust-huainan");
        assertThat(status(r)).as(r.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode user = api.data(r).path("user");
        assertThat(user.path("campus").asText()).isEqualTo("aust-huainan");
        assertThat(userSchool(user.path("id").asText())).isEqualTo("aust");

        MvcResult buildings = mockMvc.perform(get("/v1/buildings").param("campus", "aust-huainan")).andReturn();
        assertThat(status(buildings)).isEqualTo(200);
        assertThat(api.data(buildings).isArray()).isTrue();
        assertThat(api.data(buildings)).isEmpty();
    }

    @Test
    @DisplayName("7. 演示学校与安理工隔离：商品互不可见；对方学校的校区作为发布 / 资料 / 需求 / 筛选输入一律 400 校区无效")
    void pilotAndAustAreIsolated() throws Exception {
        User pilot = api.register("东校区");
        User aust = api.register("aust-huainan");
        String tag = "隔离" + UUID.randomUUID().toString().substring(0, 8);
        String pilotProduct = api.ok(publish(pilot, "东校区", tag + " 试点", null)).path("id").asText();
        String austProduct = api.ok(publish(aust, "aust-hefei", tag + " 安理工", null)).path("id").asText();

        assertThat(ids(api.ok(api.get(pilot, "/v1/products?keyword=" + tag)).path("items"), "id")).containsExactly(pilotProduct);
        assertThat(ids(api.ok(api.get(aust, "/v1/products?keyword=" + tag)).path("items"), "id")).containsExactly(austProduct);
        assertThat(status(api.get(aust, "/v1/products/" + pilotProduct))).isEqualTo(404);
        assertThat(status(api.get(pilot, "/v1/products/" + austProduct))).isEqualTo(404);

        MvcResult crossPublish = publish(aust, "东校区", tag + " 跨校", null);
        assertThat(status(crossPublish)).isEqualTo(400);
        assertThat(message(crossPublish)).isEqualTo("校区无效");
        MvcResult crossPublish2 = publish(pilot, "aust-huainan", tag + " 跨校", null);
        assertThat(status(crossPublish2)).isEqualTo(400);
        assertThat(message(crossPublish2)).isEqualTo("校区无效");
        MvcResult crossProfile = api.patch(aust, "/v1/auth/me", Map.of("campus", "西校区"));
        assertThat(status(crossProfile)).isEqualTo(400);
        assertThat(message(crossProfile)).isEqualTo("校区无效");
        assertThat(status(api.patch(aust, "/v1/auth/me", Map.of("campus", "aust-hefei")))).as("本校校区之间可以切换").isEqualTo(200);
        MvcResult crossFilter = api.get(aust, "/v1/products?campus=东校区");
        assertThat(status(crossFilter)).isEqualTo(400);
        MvcResult crossDemand = api.post(aust, "/v1/demand-subscriptions",
                Map.of("keyword", "台灯", "geoScope", "CAMPUS", "campusId", "东校区"));
        assertThat(status(crossDemand)).isEqualTo(400);
        assertThat(status(api.post(aust, "/v1/demand-subscriptions",
                Map.of("keyword", "台灯", "geoScope", "CAMPUS", "campusId", "aust-huainan")))).isEqualTo(200);
    }

    @Test
    @DisplayName("8. 两个实例同时导入同一个新数据包：advisory lock 串行化，只导入一次、只记一条导入记录")
    void concurrentImportsAreSerialized() throws Exception {
        Path dir = tempDir("conc");
        write(dir, "conc-u", """
                {"id":"conc-u","name":"并发大学","coordinateSystem":"BD-09","campuses":[{"id":"conc-a","name":"甲校区","buildings":[
                  {"id":"conc-a-1","zone":"一区","name":"1号楼","latitude":31.0,"longitude":117.0}]}]}
                """);
        List<SchoolPack> packs = SchoolPackLoader.load(List.of("conc-u"), dir.toString());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<List<SchoolPackImporter.Result>>> futures = new ArrayList<>();
            for (int i = 0; i < 2; i++) futures.add(pool.submit(() -> { start.await(); return importer.importPacks(packs); }));
            start.countDown();
            List<Boolean> imported = new ArrayList<>();
            for (Future<List<SchoolPackImporter.Result>> f : futures) imported.add(f.get().get(0).imported());
            assertThat(imported).containsExactlyInAnyOrder(true, false);
        } finally {
            pool.shutdownNow();
        }
        assertThat(imports("conc-u")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM buildings WHERE campus_id = 'conc-a'", Integer.class)).isEqualTo(1);
    }
}
