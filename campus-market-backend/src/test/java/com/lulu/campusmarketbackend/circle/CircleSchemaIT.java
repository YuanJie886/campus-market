package com.lulu.campusmarketbackend.circle;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V9 的数据库层兜底：即使绕过应用直接写库，圈子与可见性的不变量也成立。 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class CircleSchemaIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_circle_schema")
            .withUsername("campus_cs").withPassword("campus_cs_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "circle-schema-it-secret-0123456789ab");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate tx;

    @Test
    @DisplayName("1. 没有「官方认证」字段；类型只有 CLASS / CLUB / INTEREST / OTHER（没有宿舍圈）；名称与简介有长度限制")
    void circleShape() {
        List<String> columns = jdbc.queryForList("SELECT column_name FROM information_schema.columns WHERE table_name='circles'", String.class);
        assertThat(columns).doesNotContain("official", "verified", "is_official");
        UUID owner = user("东校区");
        assertThatThrownBy(() -> circle(owner, "DORM", "宿舍圈")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> circle(owner, "CLUB", "x")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> circle(owner, "CLUB", "a".repeat(31))).isInstanceOf(DataAccessException.class);
        assertThat(circle(owner, "CLASS", "软工 2 班")).isNotNull();
    }

    @Test
    @DisplayName("2. 所有者：至多一个在籍 OWNER（部分唯一索引）；提交时恰好一个且与 circles.owner_user_id 一致（约束触发器）")
    void singleOwner() {
        UUID owner = user("东校区");
        UUID other = user("东校区");
        UUID c = circle(owner, "CLUB", "所有者约束");
        jdbc.update("INSERT INTO circle_memberships(circle_id, user_id, school_id, role) VALUES (?,?,'pilot','MEMBER')", c, other);
        assertThatThrownBy(() -> jdbc.update("UPDATE circle_memberships SET role='OWNER' WHERE circle_id=? AND user_id=?", c, other))
                .as("第二个 OWNER").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE circle_memberships SET role='MODERATOR' WHERE circle_id=? AND user_id=?", c, owner))
                .as("没有 OWNER 的在用圈子不能提交").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE circles SET owner_user_id=? WHERE id=?", other, c))
                .as("owner_user_id 必须与在籍 OWNER 一致").isInstanceOf(DataAccessException.class);
        tx.executeWithoutResult(s -> {
            jdbc.update("UPDATE circle_memberships SET role='MODERATOR' WHERE circle_id=? AND user_id=?", c, owner);
            jdbc.update("UPDATE circle_memberships SET role='OWNER' WHERE circle_id=? AND user_id=?", c, other);
            jdbc.update("UPDATE circles SET owner_user_id=? WHERE id=?", other, c);
        });
        assertThat(jdbc.queryForObject("SELECT owner_user_id FROM circles WHERE id=?", UUID.class, c)).isEqualTo(other);
    }

    @Test
    @DisplayName("3. 成员必须同校；成员关系、圈子、审计事件都不能删除；审计不能改写")
    void membershipRules() {
        jdbc.update("INSERT INTO schools(id,name) VALUES ('cs-other','他校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('cs-他校区','cs-other','cs-他校区') ON CONFLICT DO NOTHING");
        UUID owner = user("东校区");
        UUID foreign = user("cs-他校区");
        UUID c = circle(owner, "CLUB", "同校约束");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO circle_memberships(circle_id, user_id, school_id, role) VALUES (?,?,'pilot','MEMBER')", c, foreign))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM circle_memberships WHERE circle_id=?", c)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM circles WHERE id=?", c)).isInstanceOf(DataAccessException.class);
        jdbc.update("INSERT INTO circle_events(circle_id, actor_user_id, event_code) VALUES (?,?,'CIRCLE_CREATED')", c, owner);
        assertThatThrownBy(() -> jdbc.update("UPDATE circle_events SET event_code='CIRCLE_UPDATED' WHERE circle_id=?", c)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM circle_events WHERE circle_id=?", c)).isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("4. 商品圈子关系：PUBLIC 不能有、CIRCLE_ONLY 提交时必须 1～5 个；卖家必须在籍；圈子必须在用且同校")
    void productCircles() {
        UUID seller = user("东校区");
        UUID stranger = user("东校区");
        UUID mine = circle(seller, "CLUB", "关系约束 A");
        UUID notMine = circle(stranger, "CLUB", "关系约束 B");
        UUID publicProduct = product(seller, "PUBLIC");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO product_circle_visibility(product_id, circle_id) VALUES (?,?)", publicProduct, mine))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> product(seller, "CIRCLE_ONLY")).as("没有关联圈子的 CIRCLE_ONLY 不能提交").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            UUID p = productRow(seller, "CIRCLE_ONLY");
            jdbc.update("INSERT INTO product_circle_visibility(product_id, circle_id) VALUES (?,?)", p, notMine);
        })).as("卖家不是成员").isInstanceOf(DataAccessException.class);
        List<UUID> six = new java.util.ArrayList<>();
        for (int i = 0; i < 6; i++) six.add(circle(seller, "INTEREST", "六个圈子 " + i));
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            UUID p = productRow(seller, "CIRCLE_ONLY");
            for (UUID c : six) jdbc.update("INSERT INTO product_circle_visibility(product_id, circle_id) VALUES (?,?)", p, c);
        })).as("超过 5 个").isInstanceOf(DataAccessException.class);
        UUID ok = tx.execute(s -> {
            UUID p = productRow(seller, "CIRCLE_ONLY");
            jdbc.update("INSERT INTO product_circle_visibility(product_id, circle_id) VALUES (?,?)", p, mine);
            return p;
        });
        assertThatThrownBy(() -> jdbc.update("DELETE FROM product_circle_visibility WHERE product_id=?", ok)).as("删光关联").isInstanceOf(DataAccessException.class);
        jdbc.update("UPDATE circles SET status='ARCHIVED', archived_at=now() WHERE id=?", mine);
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            UUID p = productRow(seller, "CIRCLE_ONLY");
            jdbc.update("INSERT INTO product_circle_visibility(product_id, circle_id) VALUES (?,?)", p, mine);
        })).as("已归档的圈子").isInstanceOf(DataAccessException.class);
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, ?) FROM products WHERE id=?", Boolean.class, stranger, ok)).isFalse();
        // 6.1A（V10）：公开商品对同校登录用户可见；未登录（NULL）一律不可见
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, ?) FROM products WHERE id=?", Boolean.class, stranger, publicProduct)).isTrue();
        assertThat(jdbc.queryForObject("SELECT product_visible_to(id, visibility, seller_id, NULL) FROM products WHERE id=?", Boolean.class, publicProduct)).isFalse();
    }

    @Test
    @DisplayName("5. 邀请只能存 64 位十六进制哈希、有效期不超过 7 天；圈子订阅只能由在籍成员创建且范围固定为全校；订单可见性快照不可改写")
    void invitesSubscriptionsOrders() {
        UUID owner = user("东校区");
        UUID stranger = user("东校区");
        UUID c = circle(owner, "CLUB", "邀请约束");
        String insert = "INSERT INTO circle_invites(id, circle_id, created_by, token_hash, expires_at) VALUES (gen_random_uuid(), ?, ?, ?, now() + ?::interval)";
        assertThatThrownBy(() -> jdbc.update(insert, c, owner, "raw-token", "1 day")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, c, owner, "a".repeat(64), "8 days")).isInstanceOf(DataAccessException.class);
        jdbc.update(insert, c, owner, "b".repeat(64), "7 days");

        String sub = "INSERT INTO demand_subscriptions(id,user_id,school_id,keyword,normalized_keyword,geo_scope,campus_id,fingerprint,circle_id) "
                + "VALUES (gen_random_uuid(), ?, 'pilot', '台灯', '台灯', ?, ?, ?, ?)";
        assertThatThrownBy(() -> jdbc.update(sub, stranger, "SCHOOL", null, "c".repeat(64), c)).as("非成员").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(sub, owner, "CAMPUS", "东校区", "d".repeat(64), c)).as("圈子订阅范围固定为全校").isInstanceOf(DataAccessException.class);
        jdbc.update(sub, owner, "SCHOOL", null, "e".repeat(64), c);

        UUID p = product(owner, "PUBLIC");
        UUID buyer = user("东校区");
        UUID order = UUID.randomUUID();
        jdbc.update("INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, confirmation_code, "
                + "idempotency_key, request_hash, expires_at, visibility_snapshot) VALUES (?,?,?,?,1,'CANCELLED','东校区-library',now()+interval '1 day',"
                + "'1','123456',?,'h',now()+interval '2 days','PUBLIC')", order, p, buyer, owner, "k-" + order);
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET visibility_snapshot='CIRCLE_ONLY' WHERE id=?", order)).isInstanceOf(DataAccessException.class);
    }

    // ------------------------------------------------------------------

    private UUID user(String campus) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?,?,?,?,?)", id, "cs-" + id, "x", "s", campus);
        return id;
    }

    /** 一个圈子与它的 OWNER 成员关系（同一事务：提交时的约束触发器要求恰好一个 OWNER）。 */
    private UUID circle(UUID owner, String type, String name) {
        UUID id = UUID.randomUUID();
        tx.executeWithoutResult(s -> {
            jdbc.update("INSERT INTO circles(id, school_id, type, name, owner_user_id) VALUES (?, 'pilot', ?, ?, ?)", id, type, name, owner);
            jdbc.update("INSERT INTO circle_memberships(circle_id, user_id, school_id, role) VALUES (?,?,'pilot','OWNER')", id, owner);
        });
        return id;
    }

    private UUID productRow(UUID seller, String visibility) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, visibility) "
                + "VALUES (?, ?, 't', 'd', 1, '其他', '全新', '东校区', '在售', ?)", id, seller, visibility);
        return id;
    }

    private UUID product(UUID seller, String visibility) {
        return productRow(seller, visibility);
    }
}
