package com.lulu.campusmarketbackend;

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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V3 楼栋数据模型的结构验证（1.1）。
 *
 * <p>楼栋是参考数据，一旦被商品和用户资料引用就很难再改结构。这里把类型、
 * 约束、索引与种子数据全部钉死，避免后续迁移悄悄漂移。
 *
 * <p>特别验证「类型与既有参考数据一致」：schools / campuses / meeting_points
 * 的主键都是 text，buildings 也必须是 text。混用 uuid 或 bigint 会让每一处
 * JOIN 都需要显式转换，是难以回头的决定。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class BuildingSchemaIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName("campus_market_bld")
            .withUsername("campus_bld").withPassword("campus_bld_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "building-schema-it-secret-0123456789");
    }

    @Autowired private JdbcTemplate jdbc;

    @Test
    @DisplayName("1. buildings 列类型与既有参考数据一致（id/campus_id 为 text，坐标为 double precision）")
    void columnTypesMatchExistingReferenceData() {
        Map<String, String> types = columnTypes("buildings");
        assertThat(types).containsEntry("id", "text")
                .containsEntry("campus_id", "text")
                .containsEntry("zone", "text")
                .containsEntry("name", "text")
                .containsEntry("latitude", "double precision")
                .containsEntry("longitude", "double precision")
                .containsEntry("active", "boolean")
                .containsEntry("sort_order", "integer")
                .containsEntry("created_at", "timestamp with time zone");

        // 与 campuses.id 同类型，否则外键 JOIN 处处要转换
        assertThat(types.get("campus_id")).isEqualTo(columnTypes("campuses").get("id"));

        // 关联列必须与 buildings.id 同类型
        assertThat(columnTypes("users").get("dorm_building_id")).isEqualTo("text");
        assertThat(columnTypes("products").get("building_id")).isEqualTo("text");
    }

    @Test
    @DisplayName("2. 外键：buildings→campuses，users/products→buildings")
    void foreignKeysPointAtTheRightTables() {
        assertThat(foreignKeyTargets("buildings", "campus_id")).contains("campuses");
        assertThat(foreignKeyTargets("users", "dorm_building_id")).contains("buildings");
        assertThat(foreignKeyTargets("products", "building_id")).contains("buildings");
    }

    @Test
    @DisplayName("3. 同校区内楼栋名唯一，跨校区可同名")
    void buildingNameIsUniquePerCampus() {
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name) VALUES ('t-dup-1','东校区','测试园','重名楼')");
        // 同校区同名：拒绝
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO buildings(id,campus_id,zone,name) VALUES ('t-dup-2','东校区','另一园','重名楼')"))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 不同校区同名：允许
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name) VALUES ('t-dup-3','西校区','测试园','重名楼')");

        jdbc.update("DELETE FROM buildings WHERE id IN ('t-dup-1','t-dup-3')");
    }

    @Test
    @DisplayName("4. CHECK：经纬度范围、sort_order 非负、zone/name 非空")
    void checkConstraintsRejectInvalidValues() {
        assertThatThrownBy(() -> insertBuilding("t-lat", 91.0, 121.0, 0, "园", "楼"))
                .as("纬度超界应被拒绝").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertBuilding("t-lng", 31.0, 181.0, 0, "园", "楼"))
                .as("经度超界应被拒绝").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertBuilding("t-sort", 31.0, 121.0, -1, "园", "楼"))
                .as("sort_order 不得为负").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertBuilding("t-zone", 31.0, 121.0, 0, "   ", "楼"))
                .as("zone 不得为空白").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertBuilding("t-name", 31.0, 121.0, 0, "园", "  "))
                .as("name 不得为空白").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("5. active 默认 true；坐标可空（允许先录楼栋后补坐标）")
    void activeDefaultsToTrueAndCoordinatesAreOptional() {
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name) VALUES ('t-def','东校区','默认园','默认楼')");
        Map<String, Object> row = jdbc.queryForMap("SELECT active, latitude, longitude FROM buildings WHERE id='t-def'");
        assertThat(row.get("active")).isEqualTo(Boolean.TRUE);
        assertThat(row.get("latitude")).isNull();
        assertThat(row.get("longitude")).isNull();
        jdbc.update("DELETE FROM buildings WHERE id='t-def'");
    }

    @Test
    @DisplayName("6. 被引用的楼栋不能物理删除，只能 active=false 停用")
    void referencedBuildingCannotBeDeleted() {
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name) VALUES ('t-ref','东校区','引用园','引用楼')");
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus,dorm_building_id) "
                + "VALUES (?,?,?,?,?,?)", userId, "bld" + userId, "x", "楼栋测试", "东校区", "t-ref");

        assertThatThrownBy(() -> jdbc.update("DELETE FROM buildings WHERE id='t-ref'"))
                .as("仍被引用的楼栋不得物理删除").isInstanceOf(DataIntegrityViolationException.class);

        // 停用是受支持的路径
        jdbc.update("UPDATE buildings SET active=false WHERE id='t-ref'");
        assertThat(jdbc.queryForObject("SELECT active FROM buildings WHERE id='t-ref'", Boolean.class)).isFalse();

        jdbc.update("DELETE FROM users WHERE id=?", userId);
        jdbc.update("DELETE FROM buildings WHERE id='t-ref'");
    }

    @Test
    @DisplayName("7. 种子楼栋：4 个校区、每校区 ≥2 园区、总数 ≥16，坐标齐备且 id 稳定")
    void seedBuildingsAreDeterministic() {
        Integer total = jdbc.queryForObject("SELECT count(*) FROM buildings", Integer.class);
        assertThat(total).as("演示楼栋总数应达到要求").isGreaterThanOrEqualTo(16);

        List<Map<String, Object>> perCampus = jdbc.queryForList(
                "SELECT campus_id, count(DISTINCT zone) AS zones, count(*) AS total "
                        + "FROM buildings GROUP BY campus_id ORDER BY campus_id");
        assertThat(perCampus).as("四个演示校区都应有楼栋").hasSize(4);
        assertThat(perCampus).allSatisfy(row -> {
            assertThat(((Number) row.get("zones")).intValue())
                    .as("%s 至少 2 个园区", row.get("campus_id")).isGreaterThanOrEqualTo(2);
            assertThat(((Number) row.get("total")).intValue())
                    .as("%s 至少 4 栋", row.get("campus_id")).isGreaterThanOrEqualTo(4);
        });

        Integer missingCoords = jdbc.queryForObject(
                "SELECT count(*) FROM buildings WHERE latitude IS NULL OR longitude IS NULL", Integer.class);
        assertThat(missingCoords).as("种子楼栋应全部带演示坐标").isZero();

        // id 稳定：可以被测试与文档直接引用
        assertThat(jdbc.queryForObject(
                "SELECT name FROM buildings WHERE id='east-qinyuan-1'", String.class)).isEqualTo("1号楼");

        // V3 的种子全部启用；V4 另加了一栋停用的演示楼栋，用来演示停用规则
        List<String> inactive = jdbc.queryForList("SELECT id FROM buildings WHERE NOT active", String.class);
        assertThat(inactive).as("只有 V4 的那一栋是停用的").containsExactly("east-songyuan-6");
    }

    @Test
    @DisplayName("8. 12 个稳定面交点全部补齐坐标，且落在对应校区楼栋群附近")
    void meetingPointsHaveCoordinates() {
        Integer total = jdbc.queryForObject("SELECT count(*) FROM meeting_points", Integer.class);
        assertThat(total).as("V1 的 12 个稳定面交点数量不变").isEqualTo(12);

        Integer missing = jdbc.queryForObject(
                "SELECT count(*) FROM meeting_points WHERE latitude IS NULL OR longitude IS NULL", Integer.class);
        assertThat(missing).as("坐标应全部补齐").isZero();

        // 面交点应落在同校区楼栋的包围盒附近（各放宽 0.01 度，约 1 公里）
        Integer misplaced = jdbc.queryForObject("""
                SELECT count(*) FROM meeting_points m
                JOIN (SELECT campus_id, min(latitude) lo_lat, max(latitude) hi_lat,
                             min(longitude) lo_lng, max(longitude) hi_lng
                      FROM buildings GROUP BY campus_id) b ON b.campus_id = m.campus_id
                WHERE m.latitude  NOT BETWEEN b.lo_lat - 0.01 AND b.hi_lat + 0.01
                   OR m.longitude NOT BETWEEN b.lo_lng - 0.01 AND b.hi_lng + 0.01
                """, Integer.class);
        assertThat(misplaced).as("面交点不应落在本校区之外").isZero();
    }

    @Test
    @DisplayName("9. 迁移不推断任何用户宿舍楼，也不给旧商品分配楼栋")
    void migrationNeverGuessesAssociations() {
        Integer usersWithDorm = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE dorm_building_id IS NOT NULL", Integer.class);
        assertThat(usersWithDorm).as("V3 不得替任何用户填写宿舍楼").isZero();

        Integer productsWithBuilding = jdbc.queryForObject(
                "SELECT count(*) FROM products WHERE building_id IS NOT NULL", Integer.class);
        assertThat(productsWithBuilding).as("V3 不得替任何旧商品分配取货楼栋").isZero();
    }

    @Test
    @DisplayName("10. 旧 campus 字段保留，未被楼栋替换")
    void legacyCampusColumnsSurvive() {
        assertThat(columnTypes("users")).containsKey("campus");
        assertThat(columnTypes("products")).containsKey("campus");
    }

    @Test
    @DisplayName("11. V3 索引全部创建，且未重复已有索引")
    void indexesExistWithoutDuplication() {
        List<String> indexes = jdbc.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname='public'", String.class);
        assertThat(indexes).contains(
                "buildings_campus_active_sort", "buildings_campus_zone",
                "products_building_status", "users_dorm_building", "meeting_points_campus");

        // 同一组列不应被建两次索引。V4 为复合外键加的 buildings(id, campus_id) 唯一约束
        // 与主键 (id) 列组合不同，不算重复
        List<Map<String, Object>> duplicates = jdbc.queryForList("""
                SELECT indrelid::regclass AS tbl, indkey::text AS cols, count(*) AS n
                FROM pg_index
                JOIN pg_class c ON c.oid = pg_index.indexrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND indpred IS NULL
                GROUP BY 1, 2 HAVING count(*) > 1
                """);
        assertThat(duplicates).as("不应存在列组合完全相同的重复索引").isEmpty();
    }

    @Test
    @DisplayName("12. V3 只执行一次")
    void migrationIsAppliedExactlyOnce() {
        Integer v3Count = jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version='3'", Integer.class);
        assertThat(v3Count).as("V3 只应执行一次").isEqualTo(1);

        String latest = jdbc.queryForObject(
                "SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1",
                String.class);
        // 最新版本随后续迁移前进（V4 起为需求雷达），这里只要求 V3 位于历史中且成功
        assertThat(Integer.parseInt(latest)).as("最新版本不低于 3").isGreaterThanOrEqualTo(3);
    }

    // ==================================================================

    private void insertBuilding(String id, double lat, double lng, int sort, String zone, String name) {
        jdbc.update("INSERT INTO buildings(id,campus_id,zone,name,latitude,longitude,sort_order) "
                + "VALUES (?,?,?,?,?,?,?)", id, "东校区", zone, name, lat, lng, sort);
    }

    private Map<String, String> columnTypes(String table) {
        return jdbc.queryForList(
                        "SELECT column_name, data_type FROM information_schema.columns "
                                + "WHERE table_schema='public' AND table_name=?", table)
                .stream()
                .collect(java.util.stream.Collectors.toMap(
                        r -> (String) r.get("column_name"), r -> (String) r.get("data_type")));
    }

    private List<String> foreignKeyTargets(String table, String column) {
        return jdbc.queryForList("""
                SELECT ccu.table_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_name = ? AND kcu.column_name = ?
                """, String.class, table, column);
    }
}
