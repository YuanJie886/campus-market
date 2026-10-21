package com.lulu.campusmarketbackend.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.CampusMarketBackendApplication;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ConfigurableApplicationContext;
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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * V23：邀请制注册（REGISTRATION_INVITE_REQUIRED=true）。缺少邀请码、无效 / 过期 / 撤销 / 他校 / 用完一律同一句话；
 * 规范化（小写、空格、连字符）；注册失败不占用；并发只成功一个；使用记录；命令行引导签发。
 * 每个用例只用本用例新签发的邀请码与新账号，与执行顺序无关。
 */
@Testcontainers
@SpringBootTest(properties = {
        "campus-market.registration.invite-required=true",
        "campus-market.schools.packs=aust",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class RegistrationInviteRequiredIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
    }

    private static final String INVALID = "邀请码无效或已用完";
    private static final Pattern CODE = Pattern.compile("[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}");

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired RegistrationInvites invites;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    // ---------------- helpers ----------------

    private String issue(String school, int maxUses) {
        return invites.issue(school, maxUses, 7, "测试", null).code();
    }
    private Map<String, Object> form(String account, String campus, Object inviteCode) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", account);
        b.put("password", "test-password-2026");
        b.put("nickname", "邀请注册");
        b.put("campus", campus);
        if (inviteCode != null) b.put("inviteCode", inviteCode);
        return b;
    }
    private static String account() {
        return "iv" + UUID.randomUUID().toString().replace("-", "");
    }
    private MvcResult register(String campus, Object inviteCode) throws Exception {
        return register(account(), campus, inviteCode);
    }
    private MvcResult register(String account, String campus, Object inviteCode) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(form(account, campus, inviteCode)))).andReturn();
    }
    private String message(MvcResult r) throws Exception {
        return api.body(r).path("message").asText();
    }
    private int usedCount(String code) {
        return jdbc.queryForObject("SELECT used_count FROM registration_invites WHERE code_hash = encode(sha256(convert_to(?, 'UTF8')), 'hex')",
                Integer.class, code.replace("-", ""));
    }
    private UUID inviteId(String code) {
        return jdbc.queryForObject("SELECT id FROM registration_invites WHERE code_hash = encode(sha256(convert_to(?, 'UTF8')), 'hex')",
                UUID.class, code.replace("-", ""));
    }
    private int uses(String code) {
        return jdbc.queryForObject("SELECT count(*) FROM registration_invite_uses WHERE invite_id = ?", Integer.class, inviteId(code));
    }
    private User registered(String campus) throws Exception {
        JsonNode d = api.ok(register(campus, issue(campusSchool(campus), 1)));
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }
    private String campusSchool(String campus) {
        return jdbc.queryForObject("SELECT school_id FROM campuses WHERE id = ?", String.class, campus);
    }

    // ---------------- 缺少 / 有效 / 用完 ----------------

    @Test void aMissingOrBlankInviteCodeIsRejectedBeforeAnythingIsCreated() throws Exception {
        String account = account();
        MvcResult missing = register(account, "东校区", null);
        assertThat(status(missing)).isEqualTo(400);
        assertThat(message(missing)).isEqualTo("请输入邀请码");
        MvcResult blank = register(account, "东校区", "   ");
        assertThat(status(blank)).isEqualTo(400);
        assertThat(message(blank)).isEqualTo("请输入邀请码");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE account = ?", Integer.class, account)).isZero();
    }

    @Test void aValidCodeRegistersConsumesOneUseAndRecordsTheUse() throws Exception {
        String code = issue("pilot", 3);
        JsonNode session = api.ok(register("东校区", code));
        String userId = session.path("user").path("id").asText();
        assertThat(session.path("accessToken").asText()).isNotBlank();
        assertThat(usedCount(code)).isEqualTo(1);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT invite_id, user_id, used_at FROM registration_invite_uses WHERE user_id = ?::uuid", userId);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("invite_id")).isEqualTo(inviteId(code));
        assertThat(rows.get(0).get("used_at")).isNotNull();
    }

    @Test void aCodeStopsWorkingOnceAllUsesAreTakenWithTheSameMessage() throws Exception {
        String code = issue("pilot", 2);
        api.ok(register("东校区", code));
        api.ok(register("西校区", code));
        MvcResult third = register("东校区", code);
        assertThat(status(third)).isEqualTo(400);
        assertThat(message(third)).isEqualTo(INVALID);
        assertThat(usedCount(code)).isEqualTo(2);
        assertThat(uses(code)).isEqualTo(2);
    }

    @Test void expiredRevokedWrongSchoolUnknownAndGarbageCodesAllGetTheSameMessageAndConsumeNothing() throws Exception {
        String expired = "EXPD-EXPD-EXP2";
        jdbc.update("""
                INSERT INTO registration_invites(id, school_id, code_hash, code_hint, max_uses, expires_at, note, created_at)
                VALUES (gen_random_uuid(), 'pilot', encode(sha256(convert_to('EXPDEXPDEXP2', 'UTF8')), 'hex'), 'EXP2', 5,
                        now() - interval '1 day', '过期', now() - interval '3 days')
                """);
        String revoked = issue("pilot", 5);
        User admin = registered("东校区");
        jdbc.update("UPDATE registration_invites SET revoked_at = clock_timestamp(), revoked_by = ?::uuid WHERE id = ?", admin.id(), inviteId(revoked));
        String otherSchool = issue("aust", 5);
        String unknown = "ABCD-EFGH-JKMN";
        List<Object> attempts = List.of(expired, revoked, otherSchool, unknown, "not-a-code", "ABCD-EFGH-JKM0", "x".repeat(300), 12345678);
        for (Object attempt : attempts) {
            MvcResult r = register("东校区", attempt);
            assertThat(status(r)).as("邀请码 %s", attempt).isEqualTo(400);
            assertThat(message(r)).as("邀请码 %s：不透露是哪一种无效", attempt).isEqualTo(INVALID);
        }
        assertThat(usedCount(expired)).isZero();
        assertThat(usedCount(revoked)).isZero();
        assertThat(usedCount(otherSchool)).as("他校的邀请码在本校校区不可用").isZero();
        // 同一张他校邀请码在它自己的学校可以用
        api.ok(register("aust-huainan", otherSchool));
        assertThat(usedCount(otherSchool)).isEqualTo(1);
    }

    @Test void codesAreNormalisedLowercaseSpacesAndHyphens() throws Exception {
        String code = issue("pilot", 3);
        String plain = code.replace("-", "");
        api.ok(register("东校区", code.toLowerCase()));
        api.ok(register("东校区", " " + plain.substring(0, 4) + " " + plain.substring(4, 8).toLowerCase() + " - " + plain.substring(8) + " "));
        api.ok(register("东校区", plain));
        assertThat(usedCount(code)).isEqualTo(3);
    }

    // ---------------- 失败不占用 / 并发 ----------------

    @Test void aFailedRegistrationDoesNotConsumeAUse() throws Exception {
        String account = account();
        api.ok(register(account, "东校区", issue("pilot", 1)));
        String code = issue("pilot", 1);
        MvcResult duplicate = register(account, "东校区", code);
        assertThat(status(duplicate)).as("账号已存在").isEqualTo(409);
        assertThat(usedCount(code)).as("注册失败回滚，不占用次数").isZero();
        assertThat(uses(code)).isZero();
        api.ok(register("东校区", code));
        assertThat(usedCount(code)).isEqualTo(1);
    }

    @Test void concurrentRegistrationsOnAOneUseCodeLetExactlyOneThrough() throws Exception {
        String code = issue("pilot", 1);
        int threads = 5;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<MvcResult>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return register("东校区", code);
                }));
            }
            gate.countDown();
            int ok = 0;
            for (Future<MvcResult> f : futures) {
                MvcResult r = f.get(120, TimeUnit.SECONDS);
                // 任何先后顺序都合法：成功的那一个可以是任意线程，其余一律 400 同一句话，不允许 5xx
                if (status(r) == 200) {
                    ok++;
                } else {
                    assertThat(status(r)).as(r.getResponse().getContentAsString()).isEqualTo(400);
                    assertThat(message(r)).isEqualTo(INVALID);
                }
            }
            assertThat(ok).isEqualTo(1);
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(usedCount(code)).isEqualTo(1);
        assertThat(uses(code)).isEqualTo(1);
    }

    // ---------------- 后台详情里的使用记录 / 公开配置 ----------------

    @Test void theAdminDetailListsWhoUsedTheCode() throws Exception {
        User admin = registered("东校区");
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'SCHOOL_ADMIN')", admin.id());
        JsonNode created = api.ok(api.post(admin, "/v1/admin/registration-invites", Map.of("maxUses", 2, "expiresInDays", 3)));
        String code = created.path("code").asText();
        JsonNode first = api.ok(register("东校区", code));
        JsonNode detail = api.ok(api.get(admin, "/v1/admin/registration-invites/" + created.path("id").asText()));
        assertThat(detail.path("usedCount").asInt()).isEqualTo(1);
        assertThat(detail.path("status").asText()).isEqualTo("ACTIVE");
        assertThat(detail.path("uses")).hasSize(1);
        assertThat(detail.path("uses").get(0).path("userId").asText()).isEqualTo(first.path("user").path("id").asText());
        assertThat(detail.path("uses").get(0).path("nickname").asText()).isEqualTo("邀请注册");
        assertThat(detail.path("uses").get(0).path("usedAt").asLong()).isPositive();
        assertThat(detail.has("code")).isFalse();
        api.ok(register("东校区", code));
        JsonNode usedUp = api.ok(api.get(admin, "/v1/admin/registration-invites/" + created.path("id").asText()));
        assertThat(usedUp.path("status").asText()).isEqualTo("USED_UP");
        assertThat(usedUp.path("uses")).hasSize(2);
    }

    @Test void publicConfigSaysInvitesAreRequired() throws Exception {
        JsonNode data = api.ok(api.get(null, "/v1/config"));
        assertThat(data.path("registration").toString()).isEqualTo("{\"inviteRequired\":true}");
        assertThat(data.path("messages").toString()).isEqualTo("{\"freeTextEnabled\":false}");
        assertThat(data.path("images").path("maxCount").asInt()).isEqualTo(9);
    }

    // ---------------- 命令行引导签发 ----------------

    private String[] cliArgs(String... extra) {
        return Stream.concat(Stream.of(
                "--spring.profiles.active=test",
                "--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                "--spring.datasource.username=" + POSTGRES.getUsername(),
                "--spring.datasource.password=" + POSTGRES.getPassword(),
                "--spring.datasource.driver-class-name=org.postgresql.Driver",
                "--spring.flyway.enabled=true",
                "--campus-market.schools.packs=aust"), Arrays.stream(extra)).toArray(String[]::new);
    }

    /** 命令行上下文会把日志降到 WARN；跑完恢复，避免影响同一 JVM 里后续的测试。 */
    private void restoreLogLevels() {
        LoggingSystem logging = LoggingSystem.get(getClass().getClassLoader());
        logging.setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.INFO);
        logging.setLogLevel("com.lulu.campusmarketbackend", LogLevel.INFO);
    }

    private static List<String> inviteLines(String stdout) {
        return stdout.lines().filter(line -> line.startsWith("邀请码：")).toList();
    }

    @Test void theBootstrapCommandIssuesAUsableCodeWithoutStartingTheWebServer(CapturedOutput output) throws Exception {
        String[] args = cliArgs("--campus-market.cli.issue-invite.school=aust", "--campus-market.cli.issue-invite.max-uses=2",
                "--campus-market.cli.issue-invite.days=3", "--campus-market.cli.issue-invite.note=首批管理员");
        assertThat(IssueInviteCommand.requested(args)).isTrue();
        assertThat(IssueInviteCommand.requested(new String[] {"--server.port=3000"})).isFalse();
        int before = output.getOut().length();
        SpringApplication app = IssueInviteCommand.application(CampusMarketBackendApplication.class);
        assertThat(app.getWebApplicationType()).isEqualTo(WebApplicationType.NONE);
        int exit;
        try {
            ConfigurableApplicationContext context = app.run(args);
            assertThat(context).as("不启动 Web 服务").isNotInstanceOf(WebServerApplicationContext.class);
            exit = SpringApplication.exit(context);
        } finally {
            restoreLogLevels();
        }
        assertThat(exit).isZero();

        List<String> lines = inviteLines(output.getOut().substring(before));
        assertThat(lines).as("标准输出只有一行邀请码").hasSize(1);
        assertThat(output.getOut().substring(before).lines().filter(line -> !line.isBlank() && !line.contains(" WARN ") && !line.contains(" INFO ")).toList())
                .as("除日志外（命令行模式只有 WARN）标准输出只有邀请码这一行：没有 Spring / MyBatis-Plus 横幅").containsExactly(lines.get(0));
        Matcher m = Pattern.compile("^邀请码：(" + CODE.pattern() + ")（2 次，至 \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}）$").matcher(lines.get(0));
        assertThat(m.matches()).as(lines.get(0)).isTrue();
        String code = m.group(1);

        Map<String, Object> row = jdbc.queryForMap("SELECT school_id, created_by, max_uses, note, EXTRACT(EPOCH FROM expires_at - created_at)::bigint AS ttl FROM registration_invites WHERE id = ?",
                inviteId(code));
        assertThat(row.get("school_id")).isEqualTo("aust");
        assertThat(row.get("created_by")).as("命令行签发").isNull();
        assertThat(row.get("max_uses")).isEqualTo(2);
        assertThat(row.get("note")).isEqualTo("首批管理员");
        assertThat(((Number) row.get("ttl")).longValue()).as("3 天").isEqualTo(3 * 86400L);
        assertThat(output.getAll().replace(lines.get(0), "")).as("明文只出现在那一行，不写日志").doesNotContain(code).doesNotContain(code.replace("-", ""));

        api.ok(register("aust-hefei", code));
        assertThat(usedCount(code)).isEqualTo(1);
    }

    @Test void theBootstrapCommandUsesDefaultsAndFailsClearlyForUnknownOrInactiveSchools(CapturedOutput output) throws Exception {
        jdbc.update("INSERT INTO schools(id, name, active) VALUES ('cli-closed', '已停用学校', false) ON CONFLICT DO NOTHING");
        int before = output.getOut().length(), beforeErr = output.getErr().length();
        int unknown, inactive, badUses, defaults;
        try {
            unknown = IssueInviteCommand.run(CampusMarketBackendApplication.class, cliArgs("--campus-market.cli.issue-invite.school=no-such-school"));
            inactive = IssueInviteCommand.run(CampusMarketBackendApplication.class, cliArgs("--campus-market.cli.issue-invite.school=cli-closed"));
            badUses = IssueInviteCommand.run(CampusMarketBackendApplication.class,
                    cliArgs("--campus-market.cli.issue-invite.school=aust", "--campus-market.cli.issue-invite.max-uses=501"));
            defaults = IssueInviteCommand.run(CampusMarketBackendApplication.class, cliArgs("--campus-market.cli.issue-invite.school=aust"));
        } finally {
            restoreLogLevels();
        }
        assertThat(unknown).isEqualTo(IssueInviteCommand.FAILED);
        assertThat(inactive).isEqualTo(IssueInviteCommand.FAILED);
        assertThat(badUses).isEqualTo(IssueInviteCommand.FAILED);
        String err = output.getErr().substring(beforeErr);
        assertThat(err).contains("签发邀请码失败：学校「no-such-school」不存在或已停用")
                .contains("签发邀请码失败：学校「cli-closed」不存在或已停用")
                .contains("签发邀请码失败：可用次数需为 1～500 的整数");
        assertThat(defaults).isZero();
        List<String> lines = inviteLines(output.getOut().substring(before));
        assertThat(lines).as("三次失败都没有输出邀请码，只有默认参数那一次").hasSize(1);
        assertThat(lines.get(0)).matches("^邀请码：" + CODE.pattern() + "（1 次，至 \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}）$");
        String code = lines.get(0).substring(4, 18);
        assertThat(jdbc.queryForObject("SELECT EXTRACT(EPOCH FROM expires_at - created_at)::bigint FROM registration_invites WHERE id = ?",
                Long.class, inviteId(code))).as("默认 7 天").isEqualTo(7 * 86400L);
        assertThat(jdbc.queryForObject("SELECT max_uses FROM registration_invites WHERE id = ?", Integer.class, inviteId(code))).as("默认 1 次").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invites WHERE school_id = 'cli-closed'", Integer.class)).isZero();
    }
}
