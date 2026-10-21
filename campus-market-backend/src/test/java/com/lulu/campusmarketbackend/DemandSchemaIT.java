package com.lulu.campusmarketbackend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V4 需求雷达的数据库层约束（2.1）。
 *
 * <p>服务层会做同样的校验，但约束必须在数据库里也成立：任何绕过服务层的写入
 * （手工修数据、将来的批处理、一个写错的新接口）都不能造出「跨校订阅」或
 * 「BUILDING 范围却没有楼栋」这种会让匹配引擎行为未定义的数据。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class DemandSchemaIT {

    private static final String FP = "a".repeat(64);

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_demand_schema")
            .withUsername("campus_ds").withPassword("campus_ds_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "demand-schema-it-secret-0123456789ab");
    }

    @Autowired private JdbcTemplate jdbc;
    private UUID user;

    @BeforeEach
    void createUser() {
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,?,?)",
                user, "ds" + user, "x", "schema", "东校区");
        // 另建一所学校与校区，用于验证跨校约束
        jdbc.update("INSERT INTO schools(id,name) VALUES ('other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('他校区','other-school','他校区') ON CONFLICT DO NOTHING");
    }

    /** 以合法默认值插入一条订阅；各参数可被单独改成非法值来测试某一条约束。 */
    private void insert(String keyword, String normalized, String category, BigDecimal min, BigDecimal max,
                        String scope, String campus, String building, String school, String fingerprint) {
        jdbc.update("""
                INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,category,
                    min_price,max_price,geo_scope,campus_id,building_id,fingerprint)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """, UUID.randomUUID(), user, school, keyword, normalized, category,
                min, max, scope, campus, building, fingerprint);
    }

    private void validSchool(String fingerprint) {
        insert("台灯", "台灯", null, null, null, "SCHOOL", null, null, "pilot", fingerprint);
    }

    @Test
    @DisplayName("1. 合法的四种范围都能写入")
    void validRowsForEveryScope() {
        validSchool("1".repeat(64));
        insert(null, null, "数码电子", null, null, "CAMPUS", "东校区", null, "pilot", "2".repeat(64));
        insert("台灯", "台灯", null, null, null, "ZONE", "东校区", "east-qinyuan-1", "pilot", "3".repeat(64));
        insert("台灯", "台灯", null, BigDecimal.ZERO, BigDecimal.TEN, "BUILDING", "东校区", "east-qinyuan-1", "pilot", "4".repeat(64));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE user_id=?", Integer.class, user))
                .isEqualTo(4);
    }

    @Test
    @DisplayName("2. 价格：负数拒绝；min > max 拒绝")
    void priceConstraints() {
        assertThatThrownBy(() -> insert("台灯", "台灯", null, new BigDecimal("-1"), null, "SCHOOL", null, null, "pilot", FP))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, new BigDecimal("-1"), "SCHOOL", null, null, "pilot", FP))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, BigDecimal.TEN, BigDecimal.ONE, "SCHOOL", null, null, "pilot", FP))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("3. geo_scope：未知值拒绝；每种范围的锚点必须齐全且不多余")
    void geoScopeShape() {
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "WORLD", null, null, "pilot", FP))
                .as("未知范围").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "BUILDING", "东校区", null, "pilot", FP))
                .as("BUILDING 缺楼栋").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "ZONE", "东校区", null, "pilot", FP))
                .as("ZONE 缺锚点楼栋").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "CAMPUS", null, null, "pilot", FP))
                .as("CAMPUS 缺校区").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "SCHOOL", "东校区", null, "pilot", FP))
                .as("SCHOOL 不应带校区").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "CAMPUS", "东校区", "east-qinyuan-1", "pilot", FP))
                .as("CAMPUS 不应带楼栋").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("4. 至少要有关键词或分类；关键词原文与规范化值同存同缺；规范化关键词长度受限")
    void keywordOrCategoryRequired() {
        assertThatThrownBy(() -> insert(null, null, null, null, null, "SCHOOL", null, null, "pilot", FP))
                .as("二者皆空").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insert("台灯", null, "数码电子", null, null, "SCHOOL", null, null, "pilot", FP))
                .as("只有原文没有规范化值").isInstanceOf(DataIntegrityViolationException.class);
        String tooLong = "长".repeat(41);
        assertThatThrownBy(() -> insert(tooLong, tooLong, null, null, null, "SCHOOL", null, null, "pilot", FP))
                .as("超过 40 字").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("5. 跨校：校区不属于订阅学校时被复合外键拒绝")
    void campusMustBelongToSchool() {
        assertThatThrownBy(() -> insert(null, null, "数码电子", null, null, "CAMPUS", "他校区", null, "pilot", FP))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("6. 楼栋必须属于订阅记录的校区（复合外键）")
    void buildingMustBelongToCampus() {
        assertThatThrownBy(() -> insert("台灯", "台灯", null, null, null, "BUILDING", "西校区", "east-qinyuan-1", "pilot", FP))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("7. 同一用户相同 active 条件不得重复；停用后可以再建")
    void activeFingerprintIsUnique() {
        String fp = "b".repeat(64);
        validSchool(fp);
        assertThatThrownBy(() -> validSchool(fp)).isInstanceOf(DataIntegrityViolationException.class);

        jdbc.update("UPDATE demand_subscriptions SET active=false WHERE user_id=? AND fingerprint=?", user, fp);
        validSchool(fp);   // 旧的已停用，不再占位
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM demand_subscriptions WHERE user_id=? AND fingerprint=?", Integer.class, user, fp))
                .isEqualTo(2);
    }

    @Test
    @DisplayName("8. fingerprint 必须是 64 位十六进制摘要")
    void fingerprintFormat() {
        assertThatThrownBy(() -> validSchool("not-a-digest"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("9. demand_matches：(订阅, 商品) 唯一；score 0～100；理由码限定在已知常量；时间不早于创建")
    void matchConstraints() {
        validSchool("c".repeat(64));
        UUID subscription = jdbc.queryForObject(
                "SELECT id FROM demand_subscriptions WHERE user_id=? AND fingerprint=?", UUID.class, user, "c".repeat(64));
        UUID product = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) "
                + "VALUES (?,?,?,?,?,?,?,?)", product, user, "台灯", "d", BigDecimal.ONE, "生活用品", "全新", "东校区");

        String ok = "INSERT INTO demand_matches(id,subscription_id,product_id,score,reason_codes) VALUES (?,?,?,?,?::text[])";
        jdbc.update(ok, UUID.randomUUID(), subscription, product, 40, "{KEYWORD_TITLE}");
        assertThatThrownBy(() -> jdbc.update(ok, UUID.randomUUID(), subscription, product, 40, "{KEYWORD_TITLE}"))
                .as("重复的 (订阅, 商品)").isInstanceOf(DataIntegrityViolationException.class);

        UUID other = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) "
                + "VALUES (?,?,?,?,?,?,?,?)", other, user, "台灯2", "d", BigDecimal.ONE, "生活用品", "全新", "东校区");
        assertThatThrownBy(() -> jdbc.update(ok, UUID.randomUUID(), subscription, other, 101, "{KEYWORD_TITLE}"))
                .as("score 超界").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(ok, UUID.randomUUID(), subscription, other, 10, "{}"))
                .as("理由码不能为空").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(ok, UUID.randomUUID(), subscription, other, 10, "{MADE_UP}"))
                .as("未知理由码").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO demand_matches(id,subscription_id,product_id,score,reason_codes,created_at,read_at) "
                        + "VALUES (?,?,?,10,'{CATEGORY}',now(),now() - interval '1 day')",
                UUID.randomUUID(), subscription, other))
                .as("已读时间早于创建").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("10. 表中没有任何队列位置或排队相关字段")
    void noQueuePositionColumns() {
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns "
                        + "WHERE table_name IN ('demand_subscriptions','demand_matches')", String.class);
        assertThat(columns).noneSatisfy(c -> assertThat(c).containsAnyOf("queue", "position", "rank"));
    }
}
