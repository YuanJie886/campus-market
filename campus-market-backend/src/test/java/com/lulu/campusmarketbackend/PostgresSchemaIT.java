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

import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 真实 PostgreSQL 16 集成测试底座。
 *
 * <p>用途：验证生产 Flyway 迁移 {@code db/migration/V1__initial_schema.sql} 在真实
 * PostgreSQL 16 空库上可执行，且表结构、预置数据、索引定义与部分唯一索引的并发语义
 * 与设计一致。H2 的 {@code MODE=PostgreSQL} 不支持本项目所依赖的部分唯一索引、
 * {@code ON CONFLICT}、{@code FOR UPDATE SKIP LOCKED} 等特性，
 * 因此这些语义只能在真实 PostgreSQL 上验证。
 *
 * <p>执行方式：{@code ./mvnw verify -Ppostgres-it}（由 Failsafe 按 {@code *IT} 命名匹配）。
 * 普通 {@code ./mvnw test} 不会执行本类。
 *
 * <p>本类刻意<b>不</b>标注 {@code @Transactional}：测试 5 依赖真实的唯一约束冲突，
 * 若置于外层事务中，一次约束失败会把整个事务置为 aborted，后续语句将无法执行。
 * JdbcTemplate 在无外层事务时以 auto-commit 逐条提交，正是这里需要的行为。
 */
@Testcontainers
@SpringBootTest(properties = {
        // 必须用 @SpringBootTest 的内联属性而不是 @DynamicPropertySource 打开 Flyway：
        // FlywayAutoConfiguration 上的 @ConditionalOnProperty 在自动配置选择阶段求值，
        // 此时 DynamicPropertySource 的覆盖尚不参与条件判定，
        // application-test.yaml 的 spring.flyway.enabled=false 会把整个 Flyway 自动配置挡掉。
        "spring.flyway.enabled=true",
        // 空库场景不允许基线，必须走真正的 V1 迁移而不是 BASELINE 记录。
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class PostgresSchemaIT {

    private static final String POSTGRES_IMAGE = "postgres:16-alpine";

    /** 仅本次一次性容器使用的测试凭据，与项目 .env / 生产配置无关。 */
    private static final String TEST_DB = "campus_market_test";
    private static final String TEST_USER = "campus_test";
    private static final String TEST_PASSWORD = "campus_test_only";

    /** schema.sql 中 campuses 的预置值。 */
    private static final Set<String> EXPECTED_CAMPUSES = Set.of("东校区", "西校区", "南校区", "北校区");

    /** schema.sql 中每个校区自动派生的三个面交点后缀。 */
    private static final Set<String> MEETING_POINT_SUFFIXES = Set.of("-library", "-canteen", "-express");

    /** Flyway 自身的历史表，不属于业务表集合，断言时单独排除。 */
    private static final String FLYWAY_HISTORY_TABLE = "flyway_schema_history";
    /** V2 引入的基础设施表：限流计数。属于基础设施，不计入 14 张业务领域表。 */
    private static final String RATE_LIMIT_TABLE = "rate_limit_counters";

    /**
     * 迁移实际创建的全部业务表。
     * 期望集合依据 {@code src/main/resources/db/migration/} 下的迁移脚本
     * 逐条建立，而非依据文档。V3 新增 buildings，V4 新增需求雷达两张表，V5 新增可信面交 8 张表。
     */
    private static final Set<String> EXPECTED_TABLES = Set.of(
            "admin_staff_audit",
            "admin_product_audit",
            // V10：交易承诺与可信治理
            "order_cancellations",
            "order_no_show_reports",
            "staff_members",
            "moderation_cases",
            "moderation_reports",
            "moderation_actions",
            "moderation_appeals",
            "user_restrictions",
            // V11 治理规则收口
            "order_slot_agreements",
            "user_restriction_basis",
            "user_restriction_corrections",

            // V9：圈子集市
            "circles",
            "circle_memberships",
            "circle_events",
            "circle_invites",
            "product_circle_visibility",

            // V7：毕业季通用供给引擎
            "listing_drafts",
            "listing_batches",
            "listing_batch_items",
            "listing_publish_requests",
            "bundle_items",
            "listing_assist_invites",
            "listing_assist_events",

            // V6：课程教材图谱
            "courses",
            "course_offerings",
            "textbook_editions",
            "course_textbooks",
            "textbook_suggestions",
            "product_textbook_details",

            "inspection_templates",
            "inspection_template_items",
            "product_inspection_disclosures",
            "order_inspections",
            "order_inspection_items",
            "order_meeting_proposals",
            "order_presence",
            "order_flow_events",

            "demand_subscriptions",
            "demand_matches",
            "buildings",
            "schools",
            "campuses",
            "meeting_points",
            "users",
            "sessions",
            "products",
            "favorites",
            "orders",
            "order_events",
            "reviews",
            "comments",
            "conversations",
            "messages",
            "conversation_reads");

    /** schema.sql 中显式 CREATE INDEX / CREATE UNIQUE INDEX 创建的具名索引。 */
    private static final Set<String> EXPECTED_INDEXES = Set.of(
            // V5
            "order_events_order_created",
            "inspection_templates_one_active",
            "order_meeting_proposals_one_pending",
            "order_meeting_proposals_one_current",
            "order_meeting_proposals_revision",
            "order_meeting_proposals_order_created",
            "order_flow_events_order",
            // V4
            "demand_subscriptions_active_fingerprint",
            "demand_subscriptions_user_created",
            "demand_subscriptions_match_category",
            "demand_subscriptions_match_building",
            "demand_subscriptions_match_campus",
            "demand_matches_product",
            "demand_matches_subscription_created",
            "demand_matches_unread",
            // V3
            "buildings_campus_active_sort",
            "buildings_campus_zone",
            "products_building_status",
            "users_dorm_building",
            "meeting_points_campus",
            // V1
            "one_active_order_per_product",
            "products_campus_created",
            "products_seller",
            "orders_buyer",
            "orders_seller",
            "messages_conversation_created");

    @Container
    @SuppressWarnings("resource") // 容器生命周期由 @Testcontainers 扩展管理
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(POSTGRES_IMAGE)
            .withDatabaseName(TEST_DB)
            .withUsername(TEST_USER)
            .withPassword(TEST_PASSWORD);

    /**
     * 覆盖 application-test.yaml 的 H2 配置，指向本次一次性 PostgreSQL 容器。
     *
     * <p>注意 application-test.yaml 把 {@code driver-class-name} 固定为 org.h2.Driver
     * 且把 {@code spring.flyway.enabled} 关成 false，两者都必须在此覆盖，
     * 否则 Flyway 不会执行 V1 迁移。
     */
    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");

        // spring.flyway.enabled / baseline-on-migrate 见类上 @SpringBootTest 的 properties，
        // 此处不重复注册（DynamicPropertySource 对自动配置条件不生效）。
        // 关闭订单超时释放业务，避免定时任务改动集成测试数据。
        registry.add("campus-market.expiry-job-enabled", () -> "false");

        // 仅测试使用的 JWT 密钥，长度满足 JwtService 的 >= 32 字符校验；不写入任何生产配置。
        registry.add("campus-market.jwt-secret",
                () -> "integration-test-only-jwt-secret-value-0123456789");
    }

    @Autowired
    private JdbcTemplate jdbc;

    // ------------------------------------------------------------------
    // 测试 1：PostgreSQL 版本与连接
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 连接的是真实 PostgreSQL 16，且数据库与用户符合预期")
    void postgresVersionAndConnection() {
        String database = jdbc.queryForObject("SELECT current_database()", String.class);
        String user = jdbc.queryForObject("SELECT current_user", String.class);
        Integer serverVersionNum = jdbc.queryForObject("SHOW server_version_num", Integer.class);
        String version = jdbc.queryForObject("SELECT version()", String.class);

        assertThat(database).isEqualTo(TEST_DB);
        assertThat(user).isEqualTo(TEST_USER);

        // server_version_num 形如 160015 —— 主版本 = num / 10000
        assertThat(serverVersionNum).isNotNull();
        assertThat(serverVersionNum / 10000)
                .as("PostgreSQL 主版本应为 16，实际 server_version_num=%s", serverVersionNum)
                .isEqualTo(16);

        assertThat(version).startsWith("PostgreSQL 16.");
    }

    // ------------------------------------------------------------------
    // 测试 2：schema.sql 创建的表全部存在
    // ------------------------------------------------------------------

    @Test
    @DisplayName("2. public schema 下的业务表集合与全部迁移完全一致（排除 Flyway 历史表）")
    void allSchemaTablesExist() {
        List<String> actual = jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                        + "AND table_name NOT IN (?, ?) "
                        + "ORDER BY table_name",
                String.class, FLYWAY_HISTORY_TABLE, RATE_LIMIT_TABLE);

        assertThat(actual)
                .as("迁移应创建且仅创建这 %d 张业务表", EXPECTED_TABLES.size())
                .containsExactlyInAnyOrderElementsOf(EXPECTED_TABLES);

        // Flyway 历史表本身必须存在，但单独验证，不混入业务表集合
        Integer historyTableCount = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = ?",
                Integer.class, FLYWAY_HISTORY_TABLE);
        assertThat(historyTableCount).as("Flyway 历史表应存在").isEqualTo(1);

        // 基础设施表单独验证，不混入业务表集合
        Integer rateLimitTableCount = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = ?",
                Integer.class, RATE_LIMIT_TABLE);
        assertThat(rateLimitTableCount).as("V2 的限流计数表应存在").isEqualTo(1);
    }

    // ------------------------------------------------------------------
    // 测试 3：预置参考数据
    // ------------------------------------------------------------------

    @Test
    @DisplayName("3. schools / campuses / meeting_points 预置数据与 schema.sql 一致且无悬空外键")
    void referenceSeedDataMatchesSchema() {
        // schools：schema.sql 仅插入一行 'pilot'
        List<String> schools = jdbc.queryForList("SELECT id FROM schools ORDER BY id", String.class);
        assertThat(schools).containsExactly("pilot");

        // campuses：4 个，且 id 与 name 同值、school_id 均为 pilot
        List<Map<String, Object>> campuses =
                jdbc.queryForList("SELECT id, school_id, name FROM campuses ORDER BY id");
        assertThat(campuses).hasSize(4);
        assertThat(campuses).extracting(row -> (String) row.get("id"))
                .containsExactlyInAnyOrderElementsOf(EXPECTED_CAMPUSES);
        assertThat(campuses).allSatisfy(row -> {
            assertThat(row.get("school_id")).isEqualTo("pilot");
            assertThat(row.get("name")).isEqualTo(row.get("id"));
        });

        // meeting_points：每校区 3 个，共 12 个
        Integer meetingPointCount =
                jdbc.queryForObject("SELECT count(*) FROM meeting_points", Integer.class);
        assertThat(meetingPointCount)
                .as("4 个校区 × 3 个面交点（图书馆门口 / 食堂入口 / 快递站）")
                .isEqualTo(12);

        List<String> meetingPointIds =
                jdbc.queryForList("SELECT id FROM meeting_points ORDER BY id", String.class);
        for (String campus : EXPECTED_CAMPUSES) {
            for (String suffix : MEETING_POINT_SUFFIXES) {
                assertThat(meetingPointIds).contains(campus + suffix);
            }
        }

        // 每个 meeting_point 都引用有效 campus，且不存在悬空引用
        Integer danglingMeetingPoints = jdbc.queryForObject(
                "SELECT count(*) FROM meeting_points mp "
                        + "LEFT JOIN campuses c ON c.id = mp.campus_id WHERE c.id IS NULL",
                Integer.class);
        assertThat(danglingMeetingPoints).as("不应存在悬空 campus 引用").isZero();

        Integer danglingCampuses = jdbc.queryForObject(
                "SELECT count(*) FROM campuses c "
                        + "LEFT JOIN schools s ON s.id = c.school_id WHERE s.id IS NULL",
                Integer.class);
        assertThat(danglingCampuses).as("不应存在悬空 school 引用").isZero();
    }

    // ------------------------------------------------------------------
    // 测试 4：关键索引存在，且部分唯一索引的定义正确
    // ------------------------------------------------------------------

    @Test
    @DisplayName("4. schema.sql 的具名索引全部存在，one_active_order_per_product 为部分唯一索引")
    void requiredIndexesExistWithCorrectDefinition() {
        List<String> indexNames = jdbc.queryForList(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
                String.class);
        assertThat(indexNames).containsAll(EXPECTED_INDEXES);

        Map<String, Object> partial = jdbc.queryForMap(
                "SELECT i.indisunique AS is_unique, "
                        + "       (i.indpred IS NOT NULL) AS is_partial, "
                        + "       pg_get_expr(i.indpred, i.indrelid) AS predicate, "
                        + "       pg_get_indexdef(i.indexrelid) AS indexdef, "
                        + "       t.relname AS table_name "
                        + "FROM pg_index i "
                        + "JOIN pg_class c ON c.oid = i.indexrelid "
                        + "JOIN pg_class t ON t.oid = i.indrelid "
                        + "WHERE c.relname = 'one_active_order_per_product'");

        assertThat(partial.get("table_name")).isEqualTo("orders");
        assertThat((Boolean) partial.get("is_unique")).as("必须是 UNIQUE 索引").isTrue();
        assertThat((Boolean) partial.get("is_partial")).as("必须是部分索引").isTrue();

        String indexDef = (String) partial.get("indexdef");
        assertThat(indexDef).as("索引列应包含 product_id").contains("(product_id)");

        // 谓词应排除三个终态，使这三种状态不占用商品的活跃订单名额
        String predicate = (String) partial.get("predicate");
        assertThat(predicate).isNotNull();
        assertThat(predicate).contains("CANCELLED");
        assertThat(predicate).contains("EXPIRED");
        assertThat(predicate).contains("COMPLETED");

        // 索引应建在 status 列上（谓词引用 status）
        assertThat(predicate).contains("status");
    }

    // ------------------------------------------------------------------
    // 测试 5：部分唯一索引的真实并发语义
    // ------------------------------------------------------------------

    @Test
    @DisplayName("5. 同一商品只能存在一个活跃订单，取消后名额释放")
    void oneActiveOrderPerProductIsEnforced() {
        UUID seller = insertUser("seller");
        UUID buyerA = insertUser("buyerA");
        UUID buyerB = insertUser("buyerB");
        UUID product = insertProduct(seller);

        // 买家 A 建立第一个活跃订单
        UUID orderA = insertOrder(product, buyerA, seller, "PENDING_SELLER_CONFIRM");
        assertThat(countActiveOrders(product)).isEqualTo(1);

        // 买家 B 对同一商品建立第二个活跃订单 —— 必须被部分唯一索引拒绝
        DataIntegrityViolationException violation = assertThrows(
                DataIntegrityViolationException.class,
                () -> insertOrder(product, buyerB, seller, "PENDING_SELLER_CONFIRM"),
                "同一商品的第二个活跃订单应触发 one_active_order_per_product 唯一冲突");

        assertThat(sqlState(violation))
                .as("PostgreSQL 唯一约束冲突的 SQLSTATE 应为 23505")
                .isEqualTo("23505");
        assertThat(rootMessage(violation))
                .as("冲突应由 one_active_order_per_product 引发")
                .contains("one_active_order_per_product");

        // 仍然只有一个活跃订单
        assertThat(countActiveOrders(product)).isEqualTo(1);

        // 第一个订单取消后，名额释放
        jdbc.update("UPDATE orders SET status = 'CANCELLED', updated_at = now() WHERE id = ?", orderA);
        assertThat(countActiveOrders(product)).isZero();

        // 买家 B 此时可以成功下单
        UUID orderB = insertOrder(product, buyerB, seller, "PENDING_SELLER_CONFIRM");
        assertThat(orderB).isNotNull();

        // 最终仍然只有一个活跃订单，且归属买家 B
        assertThat(countActiveOrders(product)).isEqualTo(1);
        UUID activeBuyer = jdbc.queryForObject(
                "SELECT buyer_id FROM orders WHERE product_id = ? "
                        + "AND status NOT IN ('CANCELLED','EXPIRED','COMPLETED')",
                UUID.class, product);
        assertThat(activeBuyer).isEqualTo(buyerB);

        // 定时任务不得把本测试的订单改成 EXPIRED（expiry-job-enabled=false）
        Integer expired = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE product_id = ? AND status = 'EXPIRED'",
                Integer.class, product);
        assertThat(expired).as("expiry 业务不应在集成测试中执行").isZero();
    }

    // ------------------------------------------------------------------
    // 测试 6：Flyway 历史表正确记录了 V1 迁移
    // ------------------------------------------------------------------

    @Test
    @DisplayName("6. flyway_schema_history 将 V1～V14 记录为成功执行的 SQL 迁移（非 BASELINE）")
    void flywayHistoryRecordsInitialMigration() {
        List<Map<String, Object>> history = jdbc.queryForList(
                "SELECT installed_rank, version, description, type, checksum, installed_on, success "
                        + "FROM " + FLYWAY_HISTORY_TABLE + " ORDER BY installed_rank");

        assertThat(history).as("空库场景下应有 V1～V14 十四条迁移记录").hasSize(14);

        Map<String, Object> v1 = history.get(0);
        assertThat(v1.get("version")).as("首条版本应为 1").isEqualTo("1");
        assertThat((String) v1.get("description"))
                .as("description 由文件名 V1__initial_schema.sql 推导")
                .isEqualTo("initial schema");
        assertThat((String) v1.get("type"))
                .as("空库应执行真正的 SQL 迁移，而不是 BASELINE")
                .isEqualTo("SQL");
        assertThat(v1.get("checksum")).as("SQL 迁移必须有校验和").isNotNull();
        assertThat(v1.get("installed_on")).as("安装时间不应为空").isNotNull();
        assertThat((Boolean) v1.get("success")).as("迁移应成功").isTrue();

        Map<String, Object> v2 = history.get(1);
        assertThat(v2.get("version")).isEqualTo("2");
        assertThat((String) v2.get("description")).isEqualTo("rate limit counters");
        assertThat((String) v2.get("type")).isEqualTo("SQL");
        assertThat(v2.get("checksum")).isNotNull();
        assertThat((Boolean) v2.get("success")).isTrue();

        Map<String, Object> v3 = history.get(2);
        assertThat(v3.get("version")).isEqualTo("3");
        assertThat((String) v3.get("description")).isEqualTo("building market");
        assertThat((String) v3.get("type")).isEqualTo("SQL");
        assertThat(v3.get("checksum")).isNotNull();
        assertThat((Boolean) v3.get("success")).isTrue();

        Integer v3SuccessCount = jdbc.queryForObject(
                "SELECT count(*) FROM " + FLYWAY_HISTORY_TABLE
                        + " WHERE version = '3' AND success = true",
                Integer.class);
        assertThat(v3SuccessCount).as("V3 只能成功记录一次").isEqualTo(1);

        Map<String, Object> v4 = history.get(3);
        assertThat(v4.get("version")).isEqualTo("4");
        assertThat((String) v4.get("description")).isEqualTo("demand radar");
        assertThat((String) v4.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v4.get("success")).isTrue();

        Map<String, Object> v5 = history.get(4);
        assertThat(v5.get("version")).isEqualTo("5");
        assertThat((String) v5.get("description")).isEqualTo("trusted meeting flow");
        assertThat((String) v5.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v5.get("success")).isTrue();

        Map<String, Object> v6 = history.get(5);
        assertThat(v6.get("version")).isEqualTo("6");
        assertThat((String) v6.get("description")).isEqualTo("course textbook graph");
        assertThat((String) v6.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v6.get("success")).isTrue();

        Map<String, Object> v7 = history.get(6);
        assertThat(v7.get("version")).isEqualTo("7");
        assertThat((String) v7.get("description")).isEqualTo("graduation supply engine");
        assertThat((String) v7.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v7.get("success")).isTrue();

        Map<String, Object> v8 = history.get(7);
        assertThat(v8.get("version")).isEqualTo("8");
        assertThat((String) v8.get("description")).isEqualTo("immutable trade dimensions");
        assertThat((String) v8.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v8.get("success")).isTrue();

        Map<String, Object> v9 = history.get(8);
        assertThat(v9.get("version")).isEqualTo("9");
        assertThat((String) v9.get("description")).isEqualTo("circle market");
        assertThat((String) v9.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v9.get("success")).isTrue();

        Map<String, Object> v10 = history.get(9);
        assertThat(v10.get("version")).isEqualTo("10");
        assertThat((String) v10.get("description")).isEqualTo("commitment and moderation");
        assertThat((String) v10.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v10.get("success")).isTrue();

        Map<String, Object> v11 = history.get(10);
        assertThat(v11.get("version")).isEqualTo("11");
        assertThat((String) v11.get("description")).isEqualTo("slots corrections and content moderation");
        assertThat((String) v11.get("type")).isEqualTo("SQL");
        assertThat((Boolean) v11.get("success")).isTrue();
        for (int version = 12; version <= 14; version++) {
            Map<String, Object> migration = history.get(version - 1);
            assertThat(migration.get("version")).isEqualTo(String.valueOf(version));
            assertThat(migration.get("type")).isEqualTo("SQL");
            assertThat(migration.get("success")).isEqualTo(true);
        }

        // V1 只应成功记录一次，且不存在任何失败记录
        Integer v1SuccessCount = jdbc.queryForObject(
                "SELECT count(*) FROM " + FLYWAY_HISTORY_TABLE
                        + " WHERE version = '1' AND success = true",
                Integer.class);
        assertThat(v1SuccessCount).as("V1 只能成功记录一次").isEqualTo(1);

        Integer v2SuccessCount = jdbc.queryForObject(
                "SELECT count(*) FROM " + FLYWAY_HISTORY_TABLE
                        + " WHERE version = '2' AND success = true",
                Integer.class);
        assertThat(v2SuccessCount).as("V2 只能成功记录一次").isEqualTo(1);

        Integer failedCount = jdbc.queryForObject(
                "SELECT count(*) FROM " + FLYWAY_HISTORY_TABLE + " WHERE success = false",
                Integer.class);
        assertThat(failedCount).as("不应存在失败的迁移记录").isZero();
    }

    // ------------------------------------------------------------------
    // 测试数据构造（字段依据 V1 迁移的 NOT NULL 与 CHECK 约束，不关闭任何约束）
    // ------------------------------------------------------------------

    private UUID insertUser(String label) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?,?,?,?,?)",
                id,
                label + "-" + id,          // account NOT NULL UNIQUE
                "not-a-real-hash",          // password_hash NOT NULL
                label,                      // nickname NOT NULL
                "东校区");                   // campus NOT NULL REFERENCES campuses(id)
        return id;
    }

    private UUID insertProduct(UUID sellerId) {
        UUID id = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status) "
                        + "VALUES (?,?,?,?,?,?,?,?,?)",
                id,
                sellerId,
                "集成测试商品",
                "由 PostgresSchemaIT 创建，仅存在于一次性容器",
                new java.math.BigDecimal("99.00"), // price CHECK(price >= 0)
                "数码电子",
                "几乎全新",
                "东校区",
                "在售");                            // CHECK(status IN ('在售','已售出','已下架','预约中'))
        return id;
    }

    private UUID insertOrder(UUID productId, UUID buyerId, UUID sellerId, String status) {
        UUID id = UUID.randomUUID();
        OffsetDateTime meetingAt = OffsetDateTime.now(ZoneOffset.UTC).plusDays(1);
        // V11：新预约必须带明确的结束时间
        jdbc.update(
                "INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, "
                        + "meeting_at, contact, confirmation_code, idempotency_key, request_hash, expires_at, meeting_ends_at) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id,
                productId,
                buyerId,
                sellerId,
                new java.math.BigDecimal("99.00"),
                status,
                "东校区-library",                    // REFERENCES meeting_points
                meetingAt,
                "13800000000",
                "123456",
                "idem-" + id,                        // UNIQUE(buyer_id, idempotency_key)
                "hash-" + id,
                meetingAt.plusDays(30),              // 远期到期，避免被任何超时逻辑波及
                meetingAt.plusHours(1));
        return id;
    }

    private int countActiveOrders(UUID productId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM orders WHERE product_id = ? "
                        + "AND status NOT IN ('CANCELLED','EXPIRED','COMPLETED')",
                Integer.class, productId);
        return count == null ? 0 : count;
    }

    // ------------------------------------------------------------------
    // 异常根因提取：只依赖 SQLSTATE 与索引名，不依赖完整英文错误文案
    // ------------------------------------------------------------------

    private static String sqlState(Throwable throwable) {
        for (Throwable t = throwable; t != null; t = t.getCause()) {
            if (t instanceof SQLException sqlException) {
                return sqlException.getSQLState();
            }
        }
        return null;
    }

    private static String rootMessage(Throwable throwable) {
        Throwable last = throwable;
        StringBuilder combined = new StringBuilder();
        for (Throwable t = throwable; t != null; t = t.getCause()) {
            combined.append(String.valueOf(t.getMessage())).append('\n');
            last = t;
        }
        combined.append(String.valueOf(last.getMessage()));
        return combined.toString();
    }
}
