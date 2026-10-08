package com.lulu.campusmarketbackend;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Flyway 旧库接管（baseline）与未知非空库保护的集成测试。
 *
 * <p>本类<b>不</b>使用 {@code @SpringBootTest}：它要在 Spring 上下文之外、
 * 用 Flyway Java API 精确控制 {@code baselineOnMigrate} 的开关，
 * 以分别验证「显式开启时接管旧库」与「默认关闭时拒绝未知非空库」两种行为。
 *
 * <p>旧库不另存一份 SQL 副本，而是直接读取生产迁移
 * {@code db/migration/V1__initial_schema.sql} 并在 Flyway 运行前手工执行，
 * 从而模拟出「结构完整、有业务数据、但没有 flyway_schema_history」的旧 DatabaseInitializer 数据库。
 * 这样旧库结构永远与 V1 保持同源，不会产生第二个需要长期维护的 SQL 真值。
 *
 * <p>全部数据都在一次性 Testcontainer 中，不连接任何本地或生产数据库。
 */
@Testcontainers
class FlywayLegacyBaselineIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";
    private static final String MIGRATION_LOCATION = "classpath:db/migration";
    private static final String V1_RESOURCE = "db/migration/V1__initial_schema.sql";
    private static final String BASELINE_DESCRIPTION = "legacy-schema-v1";
    /** 最新迁移版本。新增迁移时只改这里（以及对应的新场景），各起点应执行的条数由它推出。 */
    private static final int LATEST = 13;

    /** 仅一次性容器使用的测试凭据，与项目 .env / 生产配置无关。 */
    private static final String TEST_DB = "campus_market_legacy";
    private static final String TEST_USER = "campus_legacy";
    private static final String TEST_PASSWORD = "campus_legacy_only";

    /**
     * 模拟旧库的一次性容器。与 PostgresSchemaIT 的容器相互独立，
     * 未启用复用（withReuse 默认 false），JVM 退出时由 Ryuk 清理。
     */
    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer LEGACY_POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName(TEST_DB)
            .withUsername(TEST_USER)
            .withPassword(TEST_PASSWORD);

    // ==================================================================
    // 场景 A：旧库（结构完整 + 有业务数据 + 无 flyway_schema_history）接管
    // ==================================================================

    @Test
    @DisplayName("A. 显式开启 baselineOnMigrate 可接管旧库，不重跑 V1，并顺序应用 V2～最新版本")
    void legacyDatabaseIsBaselinedWithoutTouchingData() throws SQLException {
        DataSource dataSource = dataSourceFor(LEGACY_POSTGRES, TEST_DB);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        // ---- 1) 在 Flyway 之前手工执行 V1，造出「旧 DatabaseInitializer 建好的库」 ----
        applyV1Manually(dataSource);

        assertThat(businessTableCount(jdbc)).as("旧库应已有 14 张业务表").isEqualTo(14);
        assertThat(hasFlywayHistory(jdbc)).as("旧库此时不应有 flyway_schema_history").isFalse();

        // ---- 2) 插入旧数据哨兵 ----
        UUID legacySeller = insertUser(jdbc, "legacy-seller");
        UUID legacyBuyer = insertUser(jdbc, "legacy-buyer");
        UUID legacyProduct = insertProduct(jdbc, legacySeller, "旧库遗留商品");
        UUID legacyOrder = insertOrder(jdbc, legacyProduct, legacyBuyer, legacySeller);

        long schoolsBefore = countOf(jdbc, "schools");
        long campusesBefore = countOf(jdbc, "campuses");
        long meetingPointsBefore = countOf(jdbc, "meeting_points");
        assertThat(schoolsBefore).isEqualTo(1);
        assertThat(campusesBefore).isEqualTo(4);
        assertThat(meetingPointsBefore).isEqualTo(12);

        // ---- 3) 用 baselineOnMigrate=true 接管 ----
        Flyway baselining = Flyway.configure()
                .dataSource(dataSource)
                .locations(MIGRATION_LOCATION)
                .baselineOnMigrate(true)
                .baselineVersion("1")
                .baselineDescription(BASELINE_DESCRIPTION)
                .cleanDisabled(true)
                .load();

        MigrateResult result = baselining.migrate();

        assertThat(result.success).as("接管应成功").isTrue();
        assertThat(result.migrationsExecuted)
                .as("旧库已基线到 1，V1 不得重复执行，但 V2～V%d 必须被应用", LATEST)
                .isEqualTo(LATEST - 1);
        assertThat(hasTable(jdbc, "rate_limit_counters"))
                .as("baseline 之后 V2 的限流表应已创建").isTrue();
        assertThat(hasTable(jdbc, "buildings"))
                .as("baseline 之后 V3 的楼栋表应已创建").isTrue();

        // ---- 4) 历史表应记录一条 version=1 的 BASELINE ----
        List<Map<String, Object>> history = jdbc.queryForList(
                "SELECT version, description, type, success FROM flyway_schema_history ORDER BY installed_rank");
        assertThat(history).as("一条 BASELINE + V2～最新的 SQL 迁移").hasSize(LATEST);
        assertThat(history.get(LATEST - 1).get("version")).isEqualTo(String.valueOf(LATEST));
        Map<String, Object> baselineRow = history.get(0);
        assertThat(baselineRow.get("version")).isEqualTo("1");
        assertThat((String) baselineRow.get("type"))
                .as("接管旧库产生的应是 BASELINE 记录，而不是 SQL 迁移")
                .isEqualTo("BASELINE");
        assertThat(baselineRow.get("description")).isEqualTo(BASELINE_DESCRIPTION);
        assertThat((Boolean) baselineRow.get("success")).isTrue();

        Map<String, Object> v2Row = history.get(1);
        assertThat(v2Row.get("version")).as("baseline 之后应执行 V2").isEqualTo("2");
        assertThat((String) v2Row.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v2Row.get("success")).isTrue();

        Map<String, Object> v3Row = history.get(2);
        assertThat(v3Row.get("version")).as("V2 之后应执行 V3").isEqualTo("3");
        assertThat((String) v3Row.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v3Row.get("success")).isTrue();

        Map<String, Object> v4Row = history.get(3);
        assertThat(v4Row.get("version")).as("V3 之后应执行 V4").isEqualTo("4");
        assertThat((String) v4Row.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v4Row.get("success")).isTrue();
        assertThat(hasTable(jdbc, "demand_subscriptions")).isTrue();
        assertThat(hasTable(jdbc, "demand_matches")).isTrue();
        assertThat(history.get(4).get("version")).as("V4 之后应执行 V5").isEqualTo("5");
        assertThat(hasTable(jdbc, "order_inspections")).isTrue();
        // 升级不得替旧订单伪造「已验货」「已到达」「已约定档期」
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_inspections", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_presence", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_meeting_proposals", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_inspection_disclosures", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT meeting_revision FROM orders WHERE id=?", Integer.class, legacyOrder))
                .as("旧订单的当前协议就是下单时的原始预约（版本 0）").isZero();
        assertThat(history.get(5).get("version")).as("V5 之后应执行 V6").isEqualTo("6");
        // V6 不替旧商品猜教材版本、不生成任何选课 / 订阅 / 建议
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_textbook_details", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_suggestions", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE textbook_edition_id IS NOT NULL", Integer.class)).isZero();
        assertThat(history.get(6).get("version")).as("V6 之后应执行 V7").isEqualTo("7");
        assertV7DidNotInventHistory(jdbc);

        // ---- 5) 哨兵数据完好无损 ----
        assertThat(exists(jdbc, "users", legacySeller)).as("旧卖家应保留").isTrue();
        assertThat(exists(jdbc, "users", legacyBuyer)).as("旧买家应保留").isTrue();
        assertThat(exists(jdbc, "products", legacyProduct)).as("旧商品应保留").isTrue();
        assertThat(exists(jdbc, "orders", legacyOrder)).as("旧订单应保留").isTrue();

        String orderStatus = jdbc.queryForObject(
                "SELECT status FROM orders WHERE id = ?", String.class, legacyOrder);
        assertThat(orderStatus).as("旧订单状态不应被改写").isEqualTo("PENDING_SELLER_CONFIRM");

        // ---- 6) 预置数据没有翻倍 ----
        assertThat(countOf(jdbc, "schools")).isEqualTo(schoolsBefore);
        assertThat(countOf(jdbc, "campuses")).isEqualTo(campusesBefore);
        assertThat(countOf(jdbc, "meeting_points")).isEqualTo(meetingPointsBefore);

        // ---- 7) 表与索引仍然正确 ----
        // businessTableCount 只统计 V1 的 14 张表，V3 的 buildings 在上面单独断言过
        assertThat(businessTableCount(jdbc)).as("V1 的 14 张业务表应原样保留").isEqualTo(14);
        assertThat(namedIndexCount(jdbc))
                .as("V1 的 6 个具名索引 + V3 的 5 个 + V4 的 8 个 + V5 的 7 个 + V6 的 12 个 + V7 的 8 个 + V8 新增 1 个、删除 V7 的 2 个 + V9 新增 10 个、删除 V8 的 1 个与 V6 的 match_plain").isEqualTo(53);

        // ---- 7b) V3 没有替旧数据猜楼栋 ----
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE dorm_building_id IS NOT NULL", Integer.class))
                .as("升级不得替旧用户填写宿舍楼").isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM products WHERE building_id IS NOT NULL", Integer.class))
                .as("升级不得替旧商品分配取货楼栋").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM buildings", Integer.class))
                .as("V3 的演示楼栋应被植入").isGreaterThanOrEqualTo(16);

        // ---- 8) 接管后用 baselineOnMigrate=false 再次 migrate：应成功且不执行任何迁移 ----
        Flyway normal = Flyway.configure()
                .dataSource(dataSource)
                .locations(MIGRATION_LOCATION)
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .load();

        MigrateResult second = normal.migrate();
        assertThat(second.success).isTrue();
        assertThat(second.migrationsExecuted)
                .as("第二次启动不得重复迁移")
                .isZero();

        // ---- 9) validate 通过 ----
        normal.validate();

        // 再次确认数据仍在
        assertThat(exists(jdbc, "orders", legacyOrder)).isTrue();
        assertThat(countOf(jdbc, "meeting_points")).isEqualTo(12);
    }

    // ==================================================================
    // 场景 C：已经在 V2 的库升级到 V3（0.9 → 1.0 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("C. 停在 V2 的库执行 V3～最新，既有数据与 V1/V2 的 checksum 均不变")
    void databaseAtV2OnlyAppliesV3() throws SQLException {
        // 用独立数据库，避免与场景 A 互相影响
        String db = "campus_market_v2_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        // ---- 1) 先迁到 V2，模拟阶段 0.9 结束时的生产库 ----
        Flyway toV2 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("2"))
                .cleanDisabled(true).load();
        assertThat(toV2.migrate().migrationsExecuted).as("空库到 V2 应执行两条").isEqualTo(2);
        assertThat(hasTable(jdbc, "buildings")).as("此时还不应有 buildings").isFalse();

        // 记录 V1/V2 的 checksum，升级后必须一字不差
        Map<String, Object> before = checksums(jdbc);

        // ---- 2) 写入业务哨兵数据 ----
        UUID seller = insertUser(jdbc, "v2-seller");
        UUID product = insertProduct(jdbc, seller, "V2 时期发布的商品");

        // ---- 3) 迁到最新 ----
        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("应执行 V3～最新").isEqualTo(LATEST - 2);

        // ---- 4) V3 的结构到位 ----
        assertThat(hasTable(jdbc, "buildings")).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM buildings", Integer.class))
                .isGreaterThanOrEqualTo(16);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM meeting_points WHERE latitude IS NOT NULL", Integer.class))
                .as("12 个面交点都应补上坐标").isEqualTo(12);
        assertThat(hasTable(jdbc, "demand_subscriptions")).isTrue();

        // ---- 5) 旧商品原样保留，且没有被塞进某个楼栋 ----
        assertThat(exists(jdbc, "products", product)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT building_id FROM products WHERE id = ?", String.class, product))
                .as("旧商品的取货楼栋必须保持未指定").isNull();
        assertThat(jdbc.queryForObject(
                "SELECT dorm_building_id FROM users WHERE id = ?", String.class, seller))
                .as("旧用户的宿舍楼必须保持未填写").isNull();

        // ---- 6) V1/V2 checksum 未变 ----
        assertThat(checksums(jdbc)).as("V3 不得改动 V1/V2 的任何内容").containsAllEntriesOf(before);

        // ---- 7) 再次 migrate 为 0 条 ----
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    /** 读取 flyway_schema_history 中 V1、V2 的 checksum。 */
    private static Map<String, Object> checksums(JdbcTemplate jdbc) {
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT version, checksum FROM flyway_schema_history WHERE version IN ('1','2')")) {
            result.put((String) row.get("version"), row.get("checksum"));
        }
        return result;
    }

    /**
     * 指向同一容器中<b>另一个</b>数据库的数据源。
     * dataSourceFor 固定使用容器的默认库，这里替换 JDBC URL 里的库名段。
     */
    private static DataSource dataSourceForDatabase(String name) {
        String url = LEGACY_POSTGRES.getJdbcUrl().replace("/" + TEST_DB, "/" + name);
        SimpleDriverDataSource dataSource = new SimpleDriverDataSource();
        dataSource.setDriverClass(org.postgresql.Driver.class);
        dataSource.setUrl(url);
        dataSource.setUsername(LEGACY_POSTGRES.getUsername());
        dataSource.setPassword(LEGACY_POSTGRES.getPassword());
        return dataSource;
    }

    /** 在同一个容器里另建一个空数据库，让不同场景互不干扰。 */
    private static void createDatabase(String name) throws SQLException {
        DataSource admin = dataSourceFor(LEGACY_POSTGRES, TEST_DB);
        try (Connection connection = admin.getConnection();
             java.sql.Statement statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + name);
            statement.execute("CREATE DATABASE " + name);
        }
    }

    // ==================================================================
    // 场景 D：已经在 V3 的库升级到 V4（模块 1 → 模块 2 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("D. 停在 V3 的库执行 V4～最新；楼栋、宿舍楼与取货楼栋数据原样保留，V1～V3 checksum 不变")
    void databaseAtV3OnlyAppliesV4() throws SQLException {
        String db = "campus_market_v3_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV3 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("3"))
                .cleanDisabled(true).load();
        assertThat(toV3.migrate().migrationsExecuted).isEqualTo(3);
        assertThat(hasTable(jdbc, "demand_subscriptions")).isFalse();

        Map<String, Object> before = checksumsUpTo(jdbc, "3");
        assertThat(before).as("V1～V3 的 checksum 均应已记录").hasSize(3);

        // 模块 1 时期的数据：设置了宿舍楼的用户与带取货楼栋的商品
        UUID seller = insertUser(jdbc, "v3-seller");
        jdbc.update("UPDATE users SET dorm_building_id='east-qinyuan-1' WHERE id=?", seller);
        UUID product = insertProduct(jdbc, seller, "V3 时期发布的商品");
        jdbc.update("UPDATE products SET building_id='east-qinyuan-1', campus='东校区' WHERE id=?", product);
        long buildingsBefore = jdbc.queryForObject("SELECT count(*) FROM buildings", Long.class);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION).cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("应执行 V4～最新").isEqualTo(LATEST - 3);

        // V4 结构
        assertThat(hasTable(jdbc, "demand_subscriptions")).isTrue();
        assertThat(hasTable(jdbc, "demand_matches")).isTrue();
        // 升级不伪造任何订阅或匹配
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches", Long.class)).isZero();

        // 模块 1 的数据原样保留；楼栋只多了 V4 那一栋停用的演示楼
        assertThat(jdbc.queryForObject("SELECT dorm_building_id FROM users WHERE id=?", String.class, seller))
                .isEqualTo("east-qinyuan-1");
        assertThat(jdbc.queryForObject("SELECT building_id FROM products WHERE id=?", String.class, product))
                .isEqualTo("east-qinyuan-1");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM buildings", Long.class)).isEqualTo(buildingsBefore + 1);

        assertThat(checksumsUpTo(jdbc, "3")).as("V4 不得改动 V1～V3 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 E：已经在 V4 的库升级到 V5（模块 2 → 模块 3 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("E. 停在 V4 的库执行 V5～最新；旧订单不被伪造验货/到达/档期，V1～V4 checksum 不变")
    void databaseAtV4OnlyAppliesV5() throws SQLException {
        String db = "campus_market_v4_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV4 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("4"))
                .cleanDisabled(true).load();
        assertThat(toV4.migrate().migrationsExecuted).isEqualTo(4);
        assertThat(hasTable(jdbc, "order_inspections")).isFalse();
        Map<String, Object> before = checksumsUpTo(jdbc, "4");
        assertThat(before).hasSize(4);

        // 模块 2 时期的数据：一笔进行中的订单、一件数码商品、一条需求订阅
        UUID seller = insertUser(jdbc, "v4-seller");
        UUID buyer = insertUser(jdbc, "v4-buyer");
        UUID product = insertProduct(jdbc, seller, "V4 时期发布的商品");
        jdbc.update("UPDATE products SET category='数码电子' WHERE id=?", product);
        UUID order = insertOrder(jdbc, product, buyer, seller);
        jdbc.update("UPDATE orders SET status='PENDING_MEETING' WHERE id=?", order);
        jdbc.update("INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,geo_scope,fingerprint) "
                + "VALUES (gen_random_uuid(), ?, 'pilot', '台灯', '台灯', 'SCHOOL', ?)", buyer, "f".repeat(64));
        Map<String, Object> orderBefore = jdbc.queryForMap(
                "SELECT status, meeting_point_id, meeting_at, expires_at FROM orders WHERE id=?", order);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION).cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("应执行 V5～最新").isEqualTo(LATEST - 4);

        // 结构到位，模板已植入
        for (String table : List.of("inspection_templates", "inspection_template_items", "product_inspection_disclosures",
                "order_inspections", "order_inspection_items", "order_meeting_proposals", "order_presence", "order_flow_events")) {
            assertThat(hasTable(jdbc, table)).as(table).isTrue();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM inspection_templates WHERE active", Integer.class)).isEqualTo(5);

        // 旧订单：原样保留，不伪造任何可信面交事实
        assertThat(jdbc.queryForMap("SELECT status, meeting_point_id, meeting_at, expires_at FROM orders WHERE id=?", order))
                .isEqualTo(orderBefore);
        assertThat(jdbc.queryForObject("SELECT meeting_revision FROM orders WHERE id=?", Integer.class, order)).isZero();
        assertThat(jdbc.queryForObject("SELECT meeting_ends_at FROM orders WHERE id=?", Object.class, order)).isNull();
        for (String table : List.of("order_inspections", "order_inspection_items", "order_presence",
                "order_meeting_proposals", "order_flow_events", "product_inspection_disclosures")) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class)).as(table).isZero();
        }
        // 旧商品没有被猜成「全部正常」；需求订阅原样保留
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions", Integer.class)).isEqualTo(1);
        // 既有面交点全部默认启用
        assertThat(jdbc.queryForObject("SELECT count(*) FROM meeting_points WHERE NOT active", Integer.class)).isZero();

        assertThat(checksumsUpTo(jdbc, "4")).as("V5 不得改动 V1～V4 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 F：已经在 V5 的库升级到 V6（模块 3 → 模块 4 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("F. 停在 V5 的库只执行 V6；旧商品不被猜教材版本，旧订阅指纹与数据原样保留，V1～V5 checksum 不变")
    void databaseAtV5OnlyAppliesV6() throws SQLException {
        String db = "campus_market_v5_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV5 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("5"))
                .cleanDisabled(true).load();
        assertThat(toV5.migrate().migrationsExecuted).isEqualTo(5);
        assertThat(hasTable(jdbc, "courses")).isFalse();
        Map<String, Object> before = checksumsUpTo(jdbc, "5");
        assertThat(before).hasSize(5);

        // 模块 3 时期的数据：一件教材书籍商品、一条关键词订阅（带一条旧理由码的匹配）
        UUID seller = insertUser(jdbc, "v5-seller");
        UUID buyer = insertUser(jdbc, "v5-buyer");
        UUID product = insertProduct(jdbc, seller, "V5 时期发布的微积分教材");
        jdbc.update("UPDATE products SET category='教材书籍' WHERE id=?", product);
        UUID subscription = UUID.randomUUID();
        jdbc.update("INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,category,geo_scope,fingerprint) "
                + "VALUES (?, ?, 'pilot', '微积分', '微积分', '教材书籍', 'SCHOOL', ?)", subscription, buyer, "a".repeat(64));
        jdbc.update("INSERT INTO demand_matches(id,subscription_id,product_id,score,reason_codes) "
                + "VALUES (gen_random_uuid(), ?, ?, 60, ARRAY['KEYWORD_TITLE','CATEGORY'])", subscription, product);
        Map<String, Object> subBefore = jdbc.queryForMap("SELECT * FROM demand_subscriptions WHERE id=?", subscription);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("6"))
                .cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("只应执行 V6 一条").isEqualTo(1);

        for (String table : List.of("courses", "course_offerings", "textbook_editions", "course_textbooks",
                "textbook_suggestions", "product_textbook_details")) {
            assertThat(hasTable(jdbc, table)).as(table).isTrue();
        }
        // 演示目录已植入且全部标记为演示
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses WHERE NOT is_demo", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_editions WHERE NOT is_demo", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses", Integer.class)).isEqualTo(5);

        // 旧商品没有被猜教材版本；没有任何建议或教材订阅被伪造
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_textbook_details", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_suggestions", Integer.class)).isZero();
        // 旧订阅整行不变（新增列为 NULL），指纹不变；旧匹配与旧理由码仍然合法
        Map<String, Object> subAfter = jdbc.queryForMap("SELECT * FROM demand_subscriptions WHERE id=?", subscription);
        assertThat(subAfter.get("textbook_edition_id")).isNull();
        subAfter.remove("textbook_edition_id");
        assertThat(subAfter).isEqualTo(subBefore);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_matches WHERE subscription_id=?", Integer.class, subscription)).isEqualTo(1);
        // 新理由码约束：TEXTBOOK_EXACT 可写，未知码仍被拒
        jdbc.update("UPDATE demand_matches SET reason_codes = ARRAY['TEXTBOOK_EXACT','CATEGORY'] WHERE subscription_id=?", subscription);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update(
                "UPDATE demand_matches SET reason_codes = ARRAY['TITLE_SIMILAR'] WHERE subscription_id=?", subscription))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);

        assertThat(checksumsUpTo(jdbc, "5")).as("V6 不得改动 V1～V5 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 G：已经在 V6 的库升级到 V7（模块 4 → 模块 5 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("G. 停在 V6 的库只执行 V7；只修正精确匹配的 5 条演示 ISMN，用户数据与被改过的演示行原样保留；旧商品 SINGLE、旧订单无价格快照；V1～V6 checksum 不变")
    void databaseAtV6OnlyAppliesV7() throws SQLException {
        String db = "campus_market_v6_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV6 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("6"))
                .cleanDisabled(true).load();
        assertThat(toV6.migrate().migrationsExecuted).isEqualTo(6);
        assertThat(hasTable(jdbc, "listing_drafts")).isFalse();
        Map<String, Object> before = checksumsUpTo(jdbc, "6");
        assertThat(before).hasSize(6);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_editions WHERE id LIKE 'demo-%' AND normalized_isbn LIKE '9790%'", Integer.class))
                .as("V6 的演示教材确实使用了 979-0 号段").isEqualTo(5);

        // 模块 4 时期的数据：
        //   * 一件关联了演示第 8 版的商品（快照里有 979-0 号码）；
        //   * 一条演示行被维护者改过书名（不再是精确的种子行，V7 不得碰它）；
        //   * 一条非演示的用户教材行，号码同样在 979-0 号段（真实数据，不得批量清空）；
        //   * 一笔已完成的旧订单（旧订单没有可信的成交价快照，不得补写）。
        UUID seller = insertUser(jdbc, "v6-seller");
        UUID buyer = insertUser(jdbc, "v6-buyer");
        UUID linked = insertProduct(jdbc, seller, "V6 时期关联演示版本的教材");
        jdbc.update("INSERT INTO product_textbook_details(product_id,school_id,textbook_edition_id,isbn_snapshot,title_snapshot,edition_snapshot,publisher_snapshot) "
                + "VALUES (?, 'pilot', 'demo-calculus-8', '9790000001022', '微积分教程（演示）', '第 8 版', '演示大学出版社')", linked);
        UUID linkedEdited = insertProduct(jdbc, seller, "V6 时期关联被改过的演示版本");
        jdbc.update("UPDATE textbook_editions SET title='大学物理（演示）· 上册（维护者修订）' WHERE id='demo-physics-5'");
        jdbc.update("INSERT INTO product_textbook_details(product_id,school_id,textbook_edition_id,isbn_snapshot,title_snapshot,edition_snapshot,publisher_snapshot) "
                + "VALUES (?, 'pilot', 'demo-physics-5', '9790000003019', '大学物理（演示）· 上册', '第 5 版', '演示大学出版社')", linkedEdited);
        jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label,is_demo) "
                + "VALUES ('user-sheet-music','pilot','9790000009998','9790000009998','用户录入的乐谱',ARRAY['a'],'p','第 1 版',false)");
        UUID sold = insertProduct(jdbc, seller, "V6 时期已成交的商品");
        UUID order = insertOrder(jdbc, sold, buyer, seller);
        jdbc.update("UPDATE orders SET status='COMPLETED' WHERE id=?", order);
        String editionRow = "SELECT id, school_id, isbn10, isbn13, normalized_isbn, no_isbn_fingerprint, title, array_to_string(authors, '|') AS authors, "
                + "publisher, edition_label, is_demo, updated_at FROM textbook_editions WHERE id=?";
        Map<String, Object> userRowBefore = jdbc.queryForMap(editionRow, "user-sheet-music");
        Map<String, Object> editedBefore = jdbc.queryForMap(editionRow, "demo-physics-5");
        Map<String, Object> orderBefore = jdbc.queryForMap("SELECT * FROM orders WHERE id=?", order);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("7"))
                .cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("只应执行 V7 一条").isEqualTo(1);

        // 4.8A：精确匹配的 4 条演示行改为无 ISBN + 稳定指纹；被改过的演示行、用户行一字不变
        assertThat(jdbc.queryForList("SELECT id FROM textbook_editions WHERE is_demo AND normalized_isbn IS NULL AND id IN "
                + "('demo-calculus-7','demo-calculus-8','demo-linear-algebra-3','demo-programming-2') AND no_isbn_fingerprint ~ '^[0-9a-f]{64}$'", String.class))
                .hasSize(4);
        assertThat(jdbc.queryForMap(editionRow, "demo-physics-5")).as("被维护者改过的演示行不是精确种子，不修正").isEqualTo(editedBefore);
        assertThat(jdbc.queryForMap(editionRow, "user-sheet-music")).as("非演示的用户数据不受影响").isEqualTo(userRowBefore);
        assertThat(jdbc.queryForObject("SELECT isbn_snapshot FROM product_textbook_details WHERE product_id=?", String.class, linked))
                .as("已修正版本的商品快照不再显示 ISMN").isNull();
        assertThat(jdbc.queryForObject("SELECT isbn_snapshot FROM product_textbook_details WHERE product_id=?", String.class, linkedEdited))
                .as("未被修正的版本，快照也原样保留").isEqualTo("9790000003019");
        // 快照保护触发器已恢复：版本不变时仍不能改写快照
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update(
                "UPDATE product_textbook_details SET title_snapshot='改写' WHERE product_id=?", linked))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);

        // 模块 5：旧商品一律单件；旧订单没有价格快照，且不能事后补写
        assertV7DidNotInventHistory(jdbc);
        Map<String, Object> orderAfter = jdbc.queryForMap("SELECT * FROM orders WHERE id=?", order);
        assertThat(orderAfter.get("price_snapshot")).isNull();
        assertThat(orderAfter.get("currency")).isNull();
        orderAfter.remove("price_snapshot");
        orderAfter.remove("currency");
        assertThat(orderAfter).isEqualTo(orderBefore);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update(
                "UPDATE orders SET price_snapshot=66.00, currency='CNY' WHERE id=?", order))
                .as("不得给旧订单补写成交价快照").isInstanceOf(org.springframework.dao.DataAccessException.class);

        assertThat(checksumsUpTo(jdbc, "6")).as("V7 不得改动 V1～V6 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 H：已经在 V7 的库升级到 V8（模块 5 → 5.7 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("H. 停在 V7 的库执行 V8：V7 时期的订单保留成交价快照、维度快照为空且不能补写；V1～V7 checksum 不变")
    void databaseAtV7AppliesV8() throws SQLException {
        String db = "campus_market_v7_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV7 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("7"))
                .cleanDisabled(true).load();
        assertThat(toV7.migrate().migrationsExecuted).isEqualTo(7);
        Map<String, Object> before = checksumsUpTo(jdbc, "7");
        assertThat(before).hasSize(7);

        // V7 时期下的单：有成交价快照（下单时写入），但还没有统计维度
        UUID seller = insertUser(jdbc, "v7-seller");
        UUID buyer = insertUser(jdbc, "v7-buyer");
        UUID product = insertProduct(jdbc, seller, "V7 时期成交的商品");
        UUID order = insertOrder(jdbc, product, buyer, seller);
        jdbc.update("UPDATE orders SET status='COMPLETED' WHERE id=?", order);
        UUID snapshotted = UUID.randomUUID();
        UUID product2 = insertProduct(jdbc, seller, "V7 时期带成交价快照的商品");
        OffsetDateTime at = OffsetDateTime.now(ZoneOffset.UTC).plusDays(2);
        jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, confirmation_code, "
                + "idempotency_key, request_hash, expires_at, price_snapshot, currency) VALUES (?,?,?,?,66.00,'COMPLETED','东校区-library',?,'13800000000',"
                + "'654321',?,'h',?,66.00,'CNY')", snapshotted, product2, buyer, seller, at, "v7-idem-" + snapshotted, at.plusDays(1));

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("8"))
                .cleanDisabled(true).load();
        // 场景 H 只验证 V8 本身（V9 见场景 I）
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("只应执行 V8 一条").isEqualTo(1);

        String dims = "SELECT price_snapshot, school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot, textbook_edition_id_snapshot FROM orders WHERE id=?";
        Map<String, Object> row = jdbc.queryForMap(dims, snapshotted);
        assertThat((java.math.BigDecimal) row.get("price_snapshot")).isEqualByComparingTo("66.00");
        for (String key : List.of("school_id_snapshot", "category_snapshot", "condition_snapshot", "listing_kind_snapshot", "textbook_edition_id_snapshot")) {
            assertThat(row.get(key)).as("旧订单不回填 " + key).isNull();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE school_id_snapshot IS NOT NULL", Integer.class)).as("没有任何订单被补写").isZero();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update(
                "UPDATE orders SET school_id_snapshot='pilot', category_snapshot='教材书籍', condition_snapshot='几乎全新', listing_kind_snapshot='SINGLE' WHERE id=?", snapshotted))
                .as("不得给旧订单补写维度").isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThat(hasIndex(jdbc, "orders_trade_guidance")).as("V8 的价格参考索引").isTrue();
        assertThat(hasIndex(jdbc, "orders_completed_price_snapshot")).as("旧口径索引已删除").isFalse();

        assertThat(checksumsUpTo(jdbc, "7")).as("V8 不得改动 V1～V7 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 I：已经在 V8 的库升级到 V9（模块 5.7 → 6 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("I. 停在 V8 的库执行 V9：旧商品全部 PUBLIC 且没有圈子关系；不创建任何圈子、成员或宿舍圈；旧订阅不绑圈子；旧订单可见性快照为空且不能补写；V1～V8 checksum 不变")
    void databaseAtV8AppliesV9() throws SQLException {
        String db = "campus_market_v8_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV8 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("8"))
                .cleanDisabled(true).load();
        assertThat(toV8.migrate().migrationsExecuted).isEqualTo(8);
        Map<String, Object> before = checksumsUpTo(jdbc, "8");
        assertThat(before).hasSize(8);

        UUID seller = insertUser(jdbc, "v8-seller");
        UUID buyer = insertUser(jdbc, "v8-buyer");
        UUID product = insertProduct(jdbc, seller, "V8 时期的商品");
        UUID order = insertOrder(jdbc, product, buyer, seller);
        jdbc.update("INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,geo_scope,fingerprint) "
                + "VALUES (gen_random_uuid(), ?, 'pilot', '台灯', '台灯', 'SCHOOL', ?)", buyer, "e".repeat(64));
        Map<String, Object> productBefore = jdbc.queryForMap("SELECT id, title, status, price FROM products WHERE id=?", product);

        // 场景 I 只验证 V9 本身（V10 见场景 J）
        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("9"))
                .cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("只应执行 V9 一条").isEqualTo(1);

        assertThat(jdbc.queryForObject("SELECT visibility FROM products WHERE id=?", String.class, product)).isEqualTo("PUBLIC");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE visibility <> 'PUBLIC'", Integer.class)).as("不把任何旧商品设为圈子商品").isZero();
        assertThat(jdbc.queryForMap("SELECT id, title, status, price FROM products WHERE id=?", product)).isEqualTo(productBefore);
        for (String table : List.of("circles", "circle_memberships", "circle_invites", "circle_events", "product_circle_visibility")) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class)).as("不伪造 " + table).isZero();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM demand_subscriptions WHERE circle_id IS NOT NULL", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT visibility_snapshot FROM orders WHERE id=?", String.class, order)).isNull();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> jdbc.update("UPDATE orders SET visibility_snapshot='PUBLIC' WHERE id=?", order))
                .as("不得给旧订单补写可见性快照").isInstanceOf(org.springframework.dao.DataAccessException.class);
        // 旧的公开商品照常可见（权威可见性函数）：未登录与任何人都可见
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, NULL) FROM products WHERE id=?", Boolean.class, product)).isTrue();

        assertThat(checksumsUpTo(jdbc, "8")).as("V9 不得改动 V1～V8 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 J：已经在 V9 的库升级到 V10（模块 6 → 6.1 / 7 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("J. 停在 V9 的库执行 V10：不植入工作人员、举报、案件、处罚或爽约；旧的已取消订单不补取消原因；公开商品改为本校可见；V1～V9 checksum 不变")
    void databaseAtV9AppliesV10() throws SQLException {
        String db = "campus_market_v9_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV9 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("9"))
                .cleanDisabled(true).load();
        assertThat(toV9.migrate().migrationsExecuted).isEqualTo(9);
        Map<String, Object> before = checksumsUpTo(jdbc, "9");
        assertThat(before).hasSize(9);

        UUID seller = insertUser(jdbc, "v9-seller");
        UUID buyer = insertUser(jdbc, "v9-buyer");
        UUID product = insertProduct(jdbc, seller, "V9 时期的商品");
        UUID cancelled = insertOrder(jdbc, product, buyer, seller);
        jdbc.update("UPDATE orders SET status='CANCELLED' WHERE id=?", cancelled);
        Map<String, Object> productBefore = jdbc.queryForMap("SELECT id, title, status, price, visibility FROM products WHERE id=?", product);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("10"))
                .cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("只应执行 V10 一条").isEqualTo(1);

        for (String table : List.of("staff_members", "moderation_cases", "moderation_reports", "moderation_actions",
                "moderation_appeals", "user_restrictions", "order_no_show_reports", "order_cancellations")) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class)).as("不伪造 " + table).isZero();
        }
        assertThat(jdbc.queryForMap("SELECT id, title, status, price, visibility FROM products WHERE id=?", product)).isEqualTo(productBefore);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE moderation_hidden_at IS NOT NULL", Integer.class)).isZero();
        // 迁移不给旧的已取消订单补写取消原因（不猜）
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_cancellations WHERE order_id=?", Integer.class, cancelled)).isZero();
        // 学校口径：同校登录用户可见、未登录不可见
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, ?) FROM products WHERE id=?", Boolean.class, buyer, product)).isTrue();
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, NULL) FROM products WHERE id=?", Boolean.class, product)).isFalse();

        assertThat(checksumsUpTo(jdbc, "9")).as("V10 不得改动 V1～V9 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    // ==================================================================
    // 场景 K：已经在 V10 的库升级到 V11（模块 7 → 7.1 的真实升级路径）
    // ==================================================================

    @Test
    @DisplayName("K. 停在 V10 的库执行 V11：旧原始预约不补结束时间、不生成快照且不能再确认爽约；被接受过的改约回填快照；"
            + "NO_SHOW_RULE 改名 SYSTEM_RULE 并补规则版本与依据；人工限制不变；V1～V10 checksum 不变")
    void databaseAtV10AppliesV11() throws SQLException {
        String db = "campus_market_v10_upgrade";
        createDatabase(db);
        DataSource dataSource = dataSourceForDatabase(db);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway toV10 = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION)
                .target(org.flywaydb.core.api.MigrationVersion.fromVersion("10"))
                .cleanDisabled(true).load();
        assertThat(toV10.migrate().migrationsExecuted).isEqualTo(10);
        Map<String, Object> before = checksumsUpTo(jdbc, "10");
        assertThat(before).hasSize(10);

        UUID seller = insertUser(jdbc, "v10-seller");
        UUID buyer = insertUser(jdbc, "v10-buyer");
        UUID staff = insertUser(jdbc, "v10-staff");
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?, 'pilot', 'MODERATOR')", staff);

        // ① V10 时期的原始预约：卖家已接单，但没有结束时间（revision 0），有一条待回应的爽约报告
        UUID legacy = insertOrder(jdbc, insertProduct(jdbc, seller, "旧原始预约"), buyer, seller);
        jdbc.update("UPDATE orders SET status='PENDING_MEETING', meeting_at = now() - interval '3 hours' WHERE id=?", legacy);
        UUID legacyReport = UUID.randomUUID();
        jdbc.update("INSERT INTO order_no_show_reports(id, order_id, meeting_revision, school_id, reporter_user_id, reported_user_id, reason_code) "
                + "VALUES (?,?,0,'pilot',?,?,'DID_NOT_ARRIVE')", legacyReport, legacy, seller, buyer);

        // ② V10 时期被接受过的改约（revision 1，有完整开始 / 结束时间），工作人员确认了一次爽约并按规则生成了限制
        UUID agreed = insertOrder(jdbc, insertProduct(jdbc, seller, "改约过的订单"), buyer, seller);
        jdbc.update("UPDATE orders SET status='PENDING_MEETING' WHERE id=?", agreed);
        UUID proposal = UUID.randomUUID();
        jdbc.update("INSERT INTO order_meeting_proposals(id, order_id, proposer_id, meeting_point_id, starts_at, ends_at, status) "
                + "VALUES (?,?,?,'东校区-library', now() - interval '5 hours', now() - interval '4 hours', 'PENDING')", proposal, agreed, buyer);
        jdbc.update("UPDATE order_meeting_proposals SET status='ACCEPTED', revision=1, responded_at=now(), responded_by=? WHERE id=?", seller, proposal);
        jdbc.update("UPDATE orders o SET meeting_at = p.starts_at, meeting_ends_at = p.ends_at, meeting_revision = 1 "
                + "FROM order_meeting_proposals p WHERE p.id=? AND o.id=?", proposal, agreed);
        UUID confirmed = UUID.randomUUID();
        jdbc.update("INSERT INTO order_no_show_reports(id, order_id, meeting_revision, school_id, reporter_user_id, reported_user_id, reason_code) "
                + "VALUES (?,?,1,'pilot',?,?,'DID_NOT_ARRIVE')", confirmed, agreed, seller, buyer);
        jdbc.update("UPDATE order_no_show_reports SET status='CONFIRMED', decided_at=now(), decided_by=?, confirmed_at=now() WHERE id=?", staff, confirmed);
        UUID ruleRestriction = UUID.randomUUID();
        jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, no_show_report_id, created_by, reason_code, starts_at, ends_at) "
                + "VALUES (?,?,'pilot','BOOKING','NO_SHOW_RULE',?,?,'CONFIRMED_NO_SHOW', now(), now() + interval '24 hours')", ruleRestriction, buyer, confirmed, staff);

        // ③ 人工限制（案件来源）
        UUID caseId = UUID.randomUUID();
        jdbc.update("INSERT INTO moderation_cases(id, school_id, target_type, target_id) VALUES (?, 'pilot', 'USER', ?)", caseId, seller);
        UUID caseRestriction = UUID.randomUUID();
        jdbc.update("INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, created_by, reason_code, starts_at, ends_at) "
                + "VALUES (?,?,'pilot','PUBLISHING','CASE',?,?,'OTHER', now(), now() + interval '2 days')", caseRestriction, seller, caseId, staff);
        Map<String, Object> caseBefore = jdbc.queryForMap("SELECT scope, source, case_id, created_by, starts_at, ends_at FROM user_restrictions WHERE id=?", caseRestriction);

        Flyway toLatest = Flyway.configure()
                .dataSource(dataSource).locations(MIGRATION_LOCATION).cleanDisabled(true).load();
        MigrateResult result = toLatest.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).as("应执行 V11～当前最新版本").isEqualTo(LATEST - 10);

        // ① 不猜：旧原始预约仍没有结束时间，也没有快照；它上面的报告不能再被承认 / 确认
        assertThat(jdbc.queryForObject("SELECT meeting_ends_at FROM orders WHERE id=?", Object.class, legacy)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM order_slot_agreements WHERE order_id=?", Integer.class, legacy)).isZero();
        assertThatThrownBy(() -> jdbc.update("UPDATE order_no_show_reports SET status='ACKNOWLEDGED', responded_at=now(), confirmed_at=now() WHERE id=?", legacyReport))
                .as("没有明确档期的旧报告不能被承认").isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET meeting_ends_at = meeting_at + interval '1 hour' WHERE id=?", legacy))
                .as("也不能事后给旧预约补一个结束时间（只能通过改约握手）").isInstanceOf(org.springframework.dao.DataAccessException.class);
        // 驳回 / 失效仍然可以（不产生处罚）
        jdbc.update("UPDATE order_no_show_reports SET status='EXPIRED' WHERE id=?", legacyReport);

        // ② 真实存在过的改约协议回填快照，时间与提议完全一致
        Map<String, Object> slot = jdbc.queryForMap("SELECT * FROM order_slot_agreements WHERE order_id=? AND meeting_revision=1", agreed);
        Map<String, Object> prop = jdbc.queryForMap("SELECT starts_at, ends_at FROM order_meeting_proposals WHERE id=?", proposal);
        assertThat(slot.get("source")).isEqualTo("LEGACY_ACCEPTED_PROPOSAL");
        assertThat(slot.get("starts_at")).isEqualTo(prop.get("starts_at"));
        assertThat(slot.get("ends_at")).isEqualTo(prop.get("ends_at"));
        Map<String, Object> rule = jdbc.queryForMap("SELECT * FROM user_restrictions WHERE id=?", ruleRestriction);
        assertThat(rule.get("source")).isEqualTo("SYSTEM_RULE");
        assertThat(rule.get("rule_version")).isEqualTo("NO_SHOW_V1");
        assertThat(rule.get("decided_at")).isEqualTo(rule.get("created_at"));
        assertThat(jdbc.queryForList("SELECT no_show_report_id FROM user_restriction_basis WHERE restriction_id=?", UUID.class, ruleRestriction))
                .containsExactly(confirmed);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restrictions WHERE source='NO_SHOW_RULE'", Integer.class)).isZero();

        // ③ 人工限制除补上决定时间外不变，也不带规则版本
        Map<String, Object> caseAfter = jdbc.queryForMap("SELECT scope, source, case_id, created_by, starts_at, ends_at FROM user_restrictions WHERE id=?", caseRestriction);
        assertThat(caseAfter).isEqualTo(caseBefore);
        assertThat(jdbc.queryForObject("SELECT rule_version FROM user_restrictions WHERE id=?", String.class, caseRestriction)).isNull();
        // 不植入纠正记录、不隐藏任何评论或私信
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_restriction_corrections", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM comments WHERE moderation_hidden_at IS NOT NULL", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM messages WHERE moderation_quarantined_at IS NOT NULL", Integer.class)).isZero();

        assertThat(checksumsUpTo(jdbc, "10")).as("V11 不得改动 V1～V10 的任何内容").isEqualTo(before);
        assertThat(toLatest.migrate().migrationsExecuted).as("第二次启动不得重复迁移").isZero();
        toLatest.validate();
    }

    private static boolean hasIndex(JdbcTemplate jdbc, String name) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname=?", Integer.class, name);
        return count != null && count > 0;
    }

    /** V7 只加结构：不生成草稿 / 批次 / 邀请 / 打包明细，旧商品都是 SINGLE，旧订单没有价格快照。 */
    private static void assertV7DidNotInventHistory(JdbcTemplate jdbc) {
        for (String table : List.of("listing_drafts", "listing_batches", "listing_batch_items", "listing_publish_requests",
                "bundle_items", "listing_assist_invites", "listing_assist_events")) {
            assertThat(hasTable(jdbc, table)).as(table).isTrue();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class)).as(table).isZero();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM products WHERE listing_kind <> 'SINGLE' OR published_by IS NOT NULL OR assisted_by IS NOT NULL", Integer.class))
                .as("旧商品一律单件，不伪造发布人 / 协助人").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE price_snapshot IS NOT NULL OR currency IS NOT NULL", Integer.class))
                .as("旧订单不猜成交价").isZero();
    }

    /** 读取 flyway_schema_history 中不高于指定版本的 checksum。 */
    private static Map<String, Object> checksumsUpTo(JdbcTemplate jdbc, String maxVersion) {
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT version, checksum FROM flyway_schema_history "
                        + "WHERE version IS NOT NULL AND version::int <= ?::int ORDER BY installed_rank", maxVersion)) {
            result.put((String) row.get("version"), row.get("checksum"));
        }
        return result;
    }

    // ==================================================================
    // 场景 B：未知非空库在默认配置下必须被拒绝
    // ==================================================================

    @Nested
    @Testcontainers
    @DisplayName("B. 未知非空库保护")
    class UnknownNonEmptyDatabase {

        private static final String UNKNOWN_DB = "campus_market_unknown";
        private static final String UNKNOWN_USER = "campus_unknown";
        private static final String UNKNOWN_PASSWORD = "campus_unknown_only";

        /** 与场景 A 完全独立的一次性容器，避免相互污染。 */
        @Container
        @SuppressWarnings("resource")
        static final PostgreSQLContainer UNKNOWN_POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
                .withDatabaseName(UNKNOWN_DB)
                .withUsername(UNKNOWN_USER)
                .withPassword(UNKNOWN_PASSWORD);

        @Test
        @DisplayName("baselineOnMigrate=false 时拒绝接管与本项目无关的非空库，且不破坏其中数据")
        void unknownNonEmptyDatabaseIsRejected() {
            DataSource dataSource = dataSourceFor(UNKNOWN_POSTGRES, UNKNOWN_DB);
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);

            // 造一张与校园集市毫无关系的表，且不创建 flyway_schema_history
            jdbc.execute("CREATE TABLE unknown_table(id integer PRIMARY KEY, payload text NOT NULL)");
            jdbc.update("INSERT INTO unknown_table(id, payload) VALUES (1, 'do-not-touch')");

            assertThat(hasFlywayHistory(jdbc)).isFalse();

            Flyway flyway = Flyway.configure()
                    .dataSource(dataSource)
                    .locations(MIGRATION_LOCATION)
                    .baselineOnMigrate(false)   // 生产默认值
                    .cleanDisabled(true)
                    .load();

            // 只断言 Flyway 异常类型与关键语义，不依赖完整英文错误文案
            FlywayException failure = assertThrows(FlywayException.class, flyway::migrate,
                    "默认配置不得接管未知非空数据库");
            assertThat(failure).isNotNull();

            // 没有建立任何校园集市业务表
            assertThat(businessTableCount(jdbc)).as("不得自动创建业务表").isZero();
            assertThat(hasTable(jdbc, "rate_limit_counters"))
                    .as("V2 不得放宽未知非空库的保护").isFalse();

            // 没有写入基线记录
            assertThat(hasFlywayHistory(jdbc)).as("不得自动创建基线记录").isFalse();

            // unknown_table 及其数据完好
            Integer unknownRows = jdbc.queryForObject("SELECT count(*) FROM unknown_table", Integer.class);
            assertThat(unknownRows).as("不得删除任何既有数据").isEqualTo(1);
            String payload = jdbc.queryForObject(
                    "SELECT payload FROM unknown_table WHERE id = 1", String.class);
            assertThat(payload).isEqualTo("do-not-touch");
        }
    }

    // ==================================================================
    // 辅助方法
    // ==================================================================

    /** 直接用容器的 JDBC 参数构造 DataSource，不经过 Spring 上下文。 */
    private static DataSource dataSourceFor(PostgreSQLContainer container, String unusedDbName) {
        SimpleDriverDataSource dataSource = new SimpleDriverDataSource();
        dataSource.setDriverClass(org.postgresql.Driver.class);
        dataSource.setUrl(container.getJdbcUrl());
        dataSource.setUsername(container.getUsername());
        dataSource.setPassword(container.getPassword());
        return dataSource;
    }

    /**
     * 在 Flyway 介入之前手工执行生产的 V1 脚本，制造出「旧库」。
     * 直接复用生产迁移资源，不维护第二份 SQL。
     */
    private static void applyV1Manually(DataSource dataSource) throws SQLException {
        try (Connection connection = dataSource.getConnection()) {
            ScriptUtils.executeSqlScript(connection, new ClassPathResource(V1_RESOURCE));
        }
    }

    private static long businessTableCount(JdbcTemplate jdbc) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                        + "AND table_name IN ('schools','campuses','meeting_points','users','sessions',"
                        + "'products','favorites','orders','order_events','reviews','comments',"
                        + "'conversations','messages','conversation_reads')",
                Long.class);
        return count == null ? 0 : count;
    }

    private static long namedIndexCount(JdbcTemplate jdbc) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN "
                        + "('one_active_order_per_product','products_campus_created','products_seller',"
                        + "'orders_buyer','orders_seller','messages_conversation_created',"
                        // V3
                        + "'buildings_campus_active_sort','buildings_campus_zone',"
                        + "'products_building_status','users_dorm_building','meeting_points_campus',"
                        // V4
                        + "'demand_subscriptions_active_fingerprint','demand_subscriptions_user_created',"
                        + "'demand_subscriptions_match_category','demand_subscriptions_match_building',"
                        + "'demand_subscriptions_match_campus','demand_matches_product',"
                        + "'demand_matches_subscription_created','demand_matches_unread',"
                        // V5
                        + "'inspection_templates_one_active','order_meeting_proposals_one_pending',"
                        + "'order_meeting_proposals_one_current','order_meeting_proposals_revision',"
                        + "'order_meeting_proposals_order_created','order_flow_events_order','order_events_order_created',"
                        // V6
                        + "'courses_school_code','course_offerings_dedupe','textbook_editions_school_isbn',"
                        + "'textbook_editions_school_fingerprint','textbook_editions_work','course_textbooks_edition_verified',"
                        + "'textbook_suggestions_pending_dedupe','textbook_suggestions_submitter','product_textbook_details_edition',"
                        + "'demand_subscriptions_active_textbook','demand_subscriptions_match_textbook','demand_subscriptions_match_plain',"
                        // V7
                        + "'listing_drafts_owner_updated','listing_batches_owner_created','listing_batch_items_one_open_batch',"
                        + "'listing_assist_invites_owner','listing_assist_invites_assistant','listing_assist_events_invite',"
                        // V8（删除了 V7 的 orders_completed_price_snapshot、products_single_campus_category）
                        // V9（删除了 V8 的 orders_trade_guidance）
                        + "'circles_discoverable','circle_memberships_one_owner','circle_memberships_user_active',"
                        + "'circle_events_circle','circle_invites_circle','product_circle_visibility_circle',"
                        + "'demand_subscriptions_match_circle','demand_subscriptions_match_public','orders_public_trade_guidance',"
                        + "'products_created_order')",
                Long.class);
        return count == null ? 0 : count;
    }

    private static boolean hasTable(JdbcTemplate jdbc, String table) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = ?", Integer.class, table);
        return count != null && count > 0;
    }

    private static boolean hasFlywayHistory(JdbcTemplate jdbc) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = 'flyway_schema_history'",
                Integer.class);
        return count != null && count > 0;
    }

    private static long countOf(JdbcTemplate jdbc, String table) {
        Long count = jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
        return count == null ? 0 : count;
    }

    private static boolean exists(JdbcTemplate jdbc, String table, UUID id) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM " + table + " WHERE id = ?", Integer.class, id);
        return count != null && count == 1;
    }

    // ---- 旧数据哨兵构造（字段依据 V1 的 NOT NULL 与 CHECK 约束）----

    private static UUID insertUser(JdbcTemplate jdbc, String label) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?,?,?,?,?)",
                id, label + "-" + id, "not-a-real-hash", label, "东校区");
        return id;
    }

    private static UUID insertProduct(JdbcTemplate jdbc, UUID sellerId, String title) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status) "
                        + "VALUES (?,?,?,?,?,?,?,?,?)",
                id, sellerId, title, "接管前写入的旧数据哨兵",
                new java.math.BigDecimal("66.00"), "教材书籍", "几乎全新", "东校区", "在售");
        return id;
    }

    private static UUID insertOrder(JdbcTemplate jdbc, UUID productId, UUID buyerId, UUID sellerId) {
        UUID id = UUID.randomUUID();
        OffsetDateTime meetingAt = OffsetDateTime.now(ZoneOffset.UTC).plusDays(2);
        jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, "
                        + "meeting_at, contact, confirmation_code, idempotency_key, request_hash, expires_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id, productId, buyerId, sellerId, new java.math.BigDecimal("66.00"),
                "PENDING_SELLER_CONFIRM", "东校区-library", meetingAt, "13800000000",
                "654321", "legacy-idem-" + id, "legacy-hash-" + id, meetingAt.plusDays(30));
        return id;
    }
}
