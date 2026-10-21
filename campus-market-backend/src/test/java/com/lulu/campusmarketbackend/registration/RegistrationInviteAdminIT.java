package com.lulu.campusmarketbackend.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.support.SupplyApi;
import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
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
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.support.SupplyApi.status;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V23：后台注册邀请码。学校管理员签发 / 撤销 / 查看，只读审计员只能查看，审核员与普通用户 403，他校 404；
 * 明文只在签发响应里出现一次；列表筛选与分页；撤销幂等；校验消息；按工作人员限流；读取留痕；数据库守卫。
 * 每个用例只用本用例新建的工作人员，与执行顺序无关。限流窗口设得足够长，避免跨越窗口边界导致计数清零（不依赖时间）。
 */
@Testcontainers
@SpringBootTest(properties = {
        "campus-market.schools.packs=aust",
        "campus-market.rate-limit.admin-read.limit=25",
        "campus-market.rate-limit.admin-read.window-seconds=1000000000",
        "campus-market.rate-limit.admin-write.limit=15",
        "campus-market.rate-limit.admin-write.window-seconds=1000000000",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@ExtendWith(OutputCaptureExtension.class)
class RegistrationInviteAdminIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("spring.flyway.enabled", () -> "true");
    }

    private static final String BASE = "/v1/admin/registration-invites";
    private static final String CODE = "[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired RegistrationInvites invites;
    SupplyApi api;

    @BeforeEach void setUp() { api = new SupplyApi(mvc, json); }

    private User staff(String role) throws Exception {
        return staff("pilot", "东校区", role);
    }
    private User staff(String school, String campus, String role) throws Exception {
        User user = api.register(campus);
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, ?, ?)", user.id(), school, role);
        return user;
    }
    private static Map<String, Object> body(Object maxUses, Object days, Object note) {
        Map<String, Object> b = new HashMap<>();
        if (maxUses != null) b.put("maxUses", maxUses);
        if (days != null) b.put("expiresInDays", days);
        if (note != null) b.put("note", note);
        return b;
    }
    private JsonNode create(User who, int maxUses, int days) throws Exception {
        return api.ok(api.post(who, BASE, body(maxUses, days, null)));
    }
    private String message(MvcResult r) throws Exception {
        return api.body(r).path("message").asText();
    }
    private static List<String> ids(JsonNode list) {
        List<String> ids = new ArrayList<>();
        list.path("items").forEach(item -> ids.add(item.path("id").asText()));
        return ids;
    }
    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    // ---------------- 权限 ----------------

    @Test void onlySchoolAdminsIssueAndRevokeAuditorsOnlyReadAndOthersAreForbidden() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), auditor = staff("AUDITOR"), moderator = staff("MODERATOR"), senior = staff("SENIOR_MODERATOR");
        User plain = api.register();
        assertThat(api.ok(api.get(admin, "/v1/admin/me")).path("permissions").toString())
                .contains("\"registration-invites:read\"", "\"registration-invites:write\"");
        assertThat(api.ok(api.get(auditor, "/v1/admin/me")).path("permissions").toString())
                .contains("\"registration-invites:read\"").doesNotContain("registration-invites:write");
        String id = create(admin, 2, 7).path("id").asText();

        assertThat(status(api.get(auditor, BASE))).isEqualTo(200);
        assertThat(status(api.get(auditor, BASE + "/" + id))).isEqualTo(200);
        assertThat(status(api.post(auditor, BASE, body(1, 1, null)))).as("只读审计员不能签发").isEqualTo(403);
        assertThat(status(api.post(auditor, BASE + "/" + id + "/revoke", Map.of()))).as("只读审计员不能撤销").isEqualTo(403);
        for (User other : List.of(moderator, senior, plain)) {
            assertThat(status(api.get(other, BASE))).isEqualTo(403);
            assertThat(status(api.get(other, BASE + "/" + id))).isEqualTo(403);
            assertThat(status(api.post(other, BASE, body(1, 1, null)))).isEqualTo(403);
            assertThat(status(api.post(other, BASE + "/" + id + "/revoke", Map.of()))).isEqualTo(403);
        }
        assertThat(status(api.get(null, BASE))).isEqualTo(401);
        assertThat(status(api.post(null, BASE, body(1, 1, null)))).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invites WHERE created_by IN (?::uuid, ?::uuid, ?::uuid, ?::uuid)",
                Integer.class, auditor.id(), moderator.id(), senior.id(), plain.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT revoked_at IS NULL FROM registration_invites WHERE id = ?::uuid", Boolean.class, id)).isTrue();
        assertThat(api.ok(api.post(admin, BASE + "/" + id + "/revoke", Map.of())).path("status").asText()).isEqualTo("REVOKED");
    }

    @Test void staffOnlySeeTheirOwnSchoolsInvites() throws Exception {
        User pilotAdmin = staff("SCHOOL_ADMIN"), austAdmin = staff("aust", "aust-huainan", "SCHOOL_ADMIN");
        String pilotInvite = create(pilotAdmin, 1, 7).path("id").asText();
        JsonNode austInvite = create(austAdmin, 1, 7);
        assertThat(status(api.get(austAdmin, BASE + "/" + pilotInvite))).isEqualTo(404);
        assertThat(message(api.get(austAdmin, BASE + "/" + pilotInvite))).isEqualTo("邀请码不存在");
        assertThat(status(api.post(austAdmin, BASE + "/" + pilotInvite + "/revoke", Map.of()))).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT revoked_at IS NULL FROM registration_invites WHERE id = ?::uuid", Boolean.class, pilotInvite))
                .as("他校撤销无效").isTrue();
        List<String> austIds = ids(api.ok(api.get(austAdmin, BASE + "?size=50")));
        assertThat(austIds).contains(austInvite.path("id").asText()).doesNotContain(pilotInvite);
        assertThat(ids(api.ok(api.get(pilotAdmin, BASE + "?size=50")))).contains(pilotInvite).doesNotContain(austInvite.path("id").asText());
        assertThat(jdbc.queryForObject("SELECT school_id FROM registration_invites WHERE id = ?::uuid", String.class, austInvite.path("id").asText()))
                .as("学校由工作人员身份决定").isEqualTo("aust");
    }

    // ---------------- 明文只出现一次 ----------------

    @Test void thePlainCodeAppearsOnlyInTheCreateResponse(CapturedOutput output) throws Exception {
        User admin = staff("SCHOOL_ADMIN");
        String nickname = jdbc.queryForObject("SELECT nickname FROM users WHERE id = ?::uuid", String.class, admin.id());
        JsonNode created = api.ok(api.post(admin, BASE, body(3, 5, "  发给社团负责人  ")));
        String code = created.path("code").asText();
        String plain = code.replace("-", "");
        assertThat(code).matches(CODE);
        assertThat(created.path("codeHint").asText()).isEqualTo(plain.substring(8));
        assertThat(created.path("maxUses").asInt()).isEqualTo(3);
        assertThat(created.path("usedCount").asInt()).isZero();
        assertThat(created.path("status").asText()).isEqualTo("ACTIVE");
        assertThat(created.path("note").asText()).isEqualTo("发给社团负责人");
        assertThat(created.path("createdBy").asText()).isEqualTo(nickname);
        assertThat(created.path("revokedAt").isNull()).isTrue();
        assertThat(created.path("expiresAt").asLong() - created.path("createdAt").asLong()).isEqualTo(5 * 86_400_000L);
        String id = created.path("id").asText();

        MvcResult list = api.get(admin, BASE);
        MvcResult detail = api.get(admin, BASE + "/" + id);
        MvcResult revoked = api.post(admin, BASE + "/" + id + "/revoke", Map.of());
        for (MvcResult r : List.of(list, detail, revoked)) {
            assertThat(status(r)).isEqualTo(200);
            assertThat(r.getResponse().getContentAsString()).doesNotContain(code).doesNotContain(plain);
            assertThat(api.data(r).toString()).as("没有 code 字段（信封的 code 是状态码）").doesNotContain("\"code\"");
        }
        assertThat(api.data(detail).path("codeHint").asText()).isEqualTo(plain.substring(8));
        assertThat(api.data(detail).path("uses")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT code_hash FROM registration_invites WHERE id = ?::uuid", String.class, id)).isEqualTo(sha256(plain));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invites WHERE code_hash LIKE ? OR note LIKE ? OR code_hint LIKE ?",
                Integer.class, "%" + plain + "%", "%" + plain + "%", "%" + plain + "%")).as("库里没有明文").isZero();
        assertThat(output.getAll()).as("不写日志").doesNotContain(code).doesNotContain(plain);
    }

    // ---------------- 列表、筛选、分页 ----------------

    @Test void listFiltersByStatusPagesAndShowsWhoIssuedEachCode() throws Exception {
        User admin = staff("SCHOOL_ADMIN");
        String active = create(admin, 2, 7).path("id").asText();
        String revoked = create(admin, 2, 7).path("id").asText();
        api.ok(api.post(admin, BASE + "/" + revoked + "/revoke", Map.of()));
        String usedUp = create(admin, 1, 7).path("id").asText();
        jdbc.update("UPDATE registration_invites SET used_count = used_count + 1 WHERE id = ?::uuid", usedUp);
        UUID expired = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO registration_invites(id, school_id, code_hash, code_hint, max_uses, expires_at, created_by, created_at)
                VALUES (?, 'pilot', ?, 'ABCD', 3, now() - interval '1 hour', ?::uuid, now() - interval '2 days')
                """, expired, sha256(UUID.randomUUID().toString()), admin.id());
        String cli = invites.issue("pilot", 1, 7, null, null).id().toString();

        Map<String, String> expected = Map.of(active, "ACTIVE", revoked, "REVOKED", usedUp, "USED_UP", expired.toString(), "EXPIRED", cli, "ACTIVE");
        for (String status : List.of("ACTIVE", "USED_UP", "EXPIRED", "REVOKED")) {
            JsonNode page = api.ok(api.get(admin, BASE + "?status=" + status + "&size=50"));
            page.path("items").forEach(item -> assertThat(item.path("status").asText()).isEqualTo(status));
            List<String> ids = ids(page);
            expected.forEach((id, s) -> {
                if (s.equals(status)) assertThat(ids).as("%s 出现在 %s", id, status).contains(id);
                else assertThat(ids).as("%s 不出现在 %s", id, status).doesNotContain(id);
            });
        }
        JsonNode all = api.ok(api.get(admin, BASE + "?size=50"));
        assertThat(ids(all)).containsAll(expected.keySet());
        all.path("items").forEach(item -> {
            if (item.path("id").asText().equals(cli)) assertThat(item.path("createdBy").isNull()).as("命令行签发").isTrue();
            if (item.path("id").asText().equals(active)) assertThat(item.path("createdBy").asText()).isNotBlank();
        });
        assertThat(all.path("items").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "codeHint", "maxUses", "usedCount", "expiresAt", "revokedAt", "note", "createdBy", "createdAt", "status");

        JsonNode first = api.ok(api.get(admin, BASE + "?size=1&page=1"));
        assertThat(first.path("items")).hasSize(1);
        assertThat(first.path("total").asLong()).isGreaterThanOrEqualTo(5);
        assertThat(first.path("page").asInt()).isEqualTo(1);
        assertThat(first.path("size").asInt()).isEqualTo(1);
        assertThat(ids(api.ok(api.get(admin, BASE + "?size=1&page=2")))).hasSize(1).doesNotContainAnyElementsOf(ids(first));

        assertThat(message(api.get(admin, BASE + "?size=51"))).isEqualTo("分页参数无效");
        assertThat(message(api.get(admin, BASE + "?page=0"))).isEqualTo("分页参数无效");
        assertThat(message(api.get(admin, BASE + "?status=DELETED"))).isEqualTo("邀请码状态无效");
        assertThat(message(api.get(admin, BASE + "?schoolId=aust"))).isEqualTo("查询参数无效");
        assertThat(status(api.get(admin, BASE + "/not-a-uuid"))).isEqualTo(400);
        assertThat(status(api.get(admin, BASE + "/" + UUID.randomUUID()))).isEqualTo(404);
    }

    // ---------------- 撤销 ----------------

    @Test void revokingIsIdempotentAndRecordsWhoRevoked() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), second = staff("SCHOOL_ADMIN");
        String id = create(admin, 5, 7).path("id").asText();
        JsonNode once = api.ok(api.post(admin, BASE + "/" + id + "/revoke", Map.of()));
        assertThat(once.path("status").asText()).isEqualTo("REVOKED");
        assertThat(once.path("revokedAt").asLong()).isPositive();
        JsonNode twice = api.ok(api.post(second, BASE + "/" + id + "/revoke", null));
        assertThat(twice.path("status").asText()).isEqualTo("REVOKED");
        assertThat(twice.path("revokedAt").asLong()).as("第二次不改变撤销时间").isEqualTo(once.path("revokedAt").asLong());
        assertThat(jdbc.queryForObject("SELECT revoked_by FROM registration_invites WHERE id = ?::uuid", UUID.class, id))
                .as("记录第一次撤销的人").isEqualTo(UUID.fromString(admin.id()));
        assertThat(message(api.post(admin, BASE + "/" + id + "/revoke", Map.of("note", "x")))).isEqualTo("请求包含不支持的字段：note");
        assertThat(status(api.post(admin, BASE + "/" + UUID.randomUUID() + "/revoke", Map.of()))).isEqualTo(404);
        assertThat(message(api.post(admin, BASE + "/nope/revoke", Map.of()))).isEqualTo("编号无效");
    }

    // ---------------- 校验 ----------------

    @Test void createValidatesItsInputWithClearMessages() throws Exception {
        User admin = staff("SCHOOL_ADMIN");
        String uses = "可用次数需为 1～500 的整数", days = "有效天数需为 1～90 的整数";
        for (Object bad : new Object[] {0, 501, "5", 2.5}) {
            MvcResult r = api.post(admin, BASE, body(bad, 7, null));
            assertThat(status(r)).isEqualTo(400);
            assertThat(message(r)).as("maxUses=%s", bad).isEqualTo(uses);
        }
        assertThat(message(api.post(admin, BASE, body(null, 7, null)))).isEqualTo(uses);
        for (Object bad : new Object[] {0, 91}) assertThat(message(api.post(admin, BASE, body(1, bad, null)))).as("days=%s", bad).isEqualTo(days);
        assertThat(message(api.post(admin, BASE, body(1, null, null)))).isEqualTo(days);
        assertThat(message(api.post(admin, BASE, body(1, 7, "长".repeat(101))))).isEqualTo("备注最多 100 个字");
        assertThat(message(api.post(admin, BASE, body(1, 7, 123)))).isEqualTo("备注格式无效");
        assertThat(message(api.post(admin, BASE, Map.of("maxUses", 1, "expiresInDays", 7, "schoolId", "aust")))).isEqualTo("请求包含不支持的字段：schoolId");
        JsonNode edge = api.ok(api.post(admin, BASE, body(500, 90, "长".repeat(100))));
        assertThat(edge.path("maxUses").asInt()).isEqualTo(500);
        assertThat(edge.path("expiresAt").asLong() - edge.path("createdAt").asLong()).isEqualTo(90 * 86_400_000L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invites WHERE created_by = ?::uuid", Integer.class, admin.id()))
                .as("只有最后一次合法请求落库").isEqualTo(1);
    }

    // ---------------- 限流与读取留痕 ----------------

    @Test void readsAndWritesAreRateLimitedPerStaffMember() throws Exception {
        User reader = staff("AUDITOR"), other = staff("AUDITOR");
        for (int i = 0; i < 25; i++) assertThat(status(api.get(reader, BASE + "?size=1"))).isEqualTo(200);
        MvcResult limited = api.get(reader, BASE);
        assertThat(status(limited)).isEqualTo(429);
        assertThat(limited.getResponse().getHeader("Retry-After")).isNotNull();
        assertThat(status(api.get(other, BASE))).as("按工作人员分别计数").isEqualTo(200);

        User writer = staff("SCHOOL_ADMIN");
        String id = create(writer, 1, 1).path("id").asText();
        for (int i = 1; i < 15; i++) create(writer, 1, 1);
        assertThat(status(api.post(writer, BASE, body(1, 1, null)))).isEqualTo(429);
        assertThat(status(api.post(writer, BASE + "/" + id + "/revoke", Map.of()))).as("签发与撤销共用写入限额").isEqualTo(429);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM registration_invites WHERE created_by = ?::uuid", Integer.class, writer.id())).isEqualTo(15);
    }

    @Test void listAndDetailReadsAreAudited() throws Exception {
        User admin = staff("SCHOOL_ADMIN"), auditor = staff("AUDITOR");
        String id = create(admin, 1, 7).path("id").asText();
        int listed = api.ok(api.get(auditor, BASE + "?size=5")).path("items").size();
        api.ok(api.get(auditor, BASE + "/" + id));
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT school_id, resource, record_id, result_count, request_id FROM admin_read_audit WHERE staff_user_id = ?::uuid ORDER BY id", auditor.id());
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0)).containsEntry("school_id", "pilot").containsEntry("resource", "registration-invites").containsEntry("result_count", listed);
        assertThat(rows.get(0).get("record_id")).isNull();
        assertThat(rows.get(1)).containsEntry("resource", "registration-invites").containsEntry("record_id", UUID.fromString(id));
        assertThat(rows.get(1).get("result_count")).isNull();
        assertThat(String.valueOf(rows.get(1).get("request_id"))).isNotBlank();
        assertThat(status(api.get(auditor, BASE + "?status=BOGUS"))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_read_audit WHERE staff_user_id = ?::uuid", Integer.class, auditor.id()))
                .as("被拒的请求不留痕").isEqualTo(2);
        JsonNode trail = api.ok(api.get(auditor, "/v1/admin/read-audit?perPage=5"));
        assertThat(trail.path("items").toString()).contains("registration-invites");
    }

    // ---------------- 数据库守卫 ----------------

    @Test void theDatabaseOnlyAllowsCountingUsesAndRevoking() throws Exception {
        User admin = staff("SCHOOL_ADMIN");
        String id = create(admin, 2, 7).path("id").asText();
        String user = api.register().id();
        for (String sql : List.of(
                "UPDATE registration_invites SET code_hash = repeat('a', 64) WHERE id = ?::uuid",
                "UPDATE registration_invites SET max_uses = 500 WHERE id = ?::uuid",
                "UPDATE registration_invites SET expires_at = expires_at + interval '1 day' WHERE id = ?::uuid",
                "UPDATE registration_invites SET school_id = 'aust' WHERE id = ?::uuid",
                "UPDATE registration_invites SET used_count = used_count + 2 WHERE id = ?::uuid",
                "DELETE FROM registration_invites WHERE id = ?::uuid")) {
            assertThatThrownBy(() -> jdbc.update(sql, id)).as(sql).isInstanceOf(DataAccessException.class);
        }
        assertThat(jdbc.update("UPDATE registration_invites SET used_count = used_count + 1 WHERE id = ?::uuid", id)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("UPDATE registration_invites SET used_count = used_count - 1 WHERE id = ?::uuid", id))
                .as("次数不能回退").isInstanceOf(DataAccessException.class);
        jdbc.update("INSERT INTO registration_invite_uses(invite_id, user_id) VALUES (?::uuid, ?::uuid)", id, user);
        String another = api.register().id();
        assertThatThrownBy(() -> jdbc.update("INSERT INTO registration_invite_uses(invite_id, user_id) VALUES (?::uuid, ?::uuid)", id, another))
                .as("使用记录必须对应一次已计数的使用").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE registration_invite_uses SET used_at = now() WHERE invite_id = ?::uuid", id))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM registration_invite_uses WHERE invite_id = ?::uuid", id))
                .isInstanceOf(DataAccessException.class);

        api.ok(api.post(admin, BASE + "/" + id + "/revoke", Map.of()));
        assertThatThrownBy(() -> jdbc.update("UPDATE registration_invites SET revoked_at = NULL, revoked_by = NULL WHERE id = ?::uuid", id))
                .as("撤销是终态").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE registration_invites SET used_count = used_count + 1 WHERE id = ?::uuid", id))
                .as("撤销后不能再使用").isInstanceOf(DataAccessException.class);
        for (String table : List.of("registration_invites", "registration_invite_uses")) {
            assertThatThrownBy(() -> jdbc.execute("TRUNCATE " + table + " CASCADE")).as(table).isInstanceOf(DataAccessException.class);
        }
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO registration_invites(id, school_id, code_hash, code_hint, max_uses, expires_at)
                VALUES (gen_random_uuid(), 'pilot', repeat('b', 64), 'ABCD', 501, now() + interval '1 day')
                """)).as("最多 500 次").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO registration_invites(id, school_id, code_hash, code_hint, max_uses, expires_at)
                VALUES (gen_random_uuid(), 'pilot', repeat('c', 64), 'ABCD', 1, now() + interval '91 days')
                """)).as("最长 90 天").isInstanceOf(DataAccessException.class);
    }
}
