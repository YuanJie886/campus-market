package com.lulu.campusmarketbackend.supply;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V7 的数据库层保证：即使绕过应用直接写库，这些不变量也成立。 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class SupplySchemaIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_supply_schema")
            .withUsername("campus_ss").withPassword("campus_ss_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "supply-schema-it-secret-0123456789ab");
    }

    @Autowired JdbcTemplate jdbc;

    @Test
    @DisplayName("1. 发布人只能是所有者；协助人不能是所有者；商品形态只有 SINGLE / BUNDLE")
    void productAttribution() {
        UUID owner = user();
        UUID other = user();
        UUID product = product(owner);
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET published_by=? WHERE id=?", other, product)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET assisted_by=? WHERE id=?", owner, product)).isInstanceOf(DataAccessException.class);
        jdbc.update("UPDATE products SET published_by=?, assisted_by=? WHERE id=?", owner, other, product);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status, listing_kind) "
                + "VALUES (gen_random_uuid(), ?, 't', 'd', 1, '其他', '全新', '东校区', '在售', 'PALLET')", owner)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO bundle_items(product_id,item_code,name,category,condition,quantity,sort_order) "
                + "VALUES (?, 'I01', 'x', '其他', '全新', 1, 0)", product)).as("单件商品不能有明细").isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("2. 批次：位置 1～20；同一草稿只能在一个未发布批次里；幂等键长度与商品 id 数量受约束")
    void batchConstraints() {
        UUID owner = user();
        UUID draft = draft(owner);
        UUID a = batch(owner);
        UUID b = batch(owner);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO listing_batch_items(batch_id,draft_id,owner_user_id,position) VALUES (?,?,?,21)", a, draft, owner))
                .isInstanceOf(DataAccessException.class);
        jdbc.update("INSERT INTO listing_batch_items(batch_id,draft_id,owner_user_id,position) VALUES (?,?,?,1)", a, draft, owner);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO listing_batch_items(batch_id,draft_id,owner_user_id,position) VALUES (?,?,?,1)", b, draft, owner))
                .isInstanceOf(DataAccessException.class);
        UUID stranger = user();
        assertThatThrownBy(() -> jdbc.update("INSERT INTO listing_batch_items(batch_id,draft_id,owner_user_id,position) VALUES (?,?,?,2)", a, draft(stranger), owner))
                .as("草稿与批次必须同一所有者").isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO listing_publish_requests(owner_user_id,idempotency_key,request_hash,batch_id,product_ids) "
                + "VALUES (?, 'short', ?, ?, ARRAY[gen_random_uuid()])", owner, "a".repeat(64), a)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO listing_publish_requests(owner_user_id,idempotency_key,request_hash,batch_id,product_ids) "
                + "VALUES (?, 'long-enough-key', ?, ?, ARRAY[]::uuid[])", owner, "a".repeat(64), a)).isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("3. 邀请：草稿与批次恰好一个；token 只能是 64 位十六进制哈希；有效期不超过 7 天；邀请码哈希唯一")
    void inviteConstraints() {
        UUID owner = user();
        UUID draft = draft(owner);
        String insert = "INSERT INTO listing_assist_invites(id, owner_user_id, draft_id, batch_id, token_hash, expires_at) VALUES (gen_random_uuid(), ?, ?, ?, ?, now() + ?::interval)";
        assertThatThrownBy(() -> jdbc.update(insert, owner, draft, batch(owner), hex('a'), "1 day")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, owner, null, null, hex('b'), "1 day")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, owner, draft, null, "raw-token-not-a-hash", "1 day")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, owner, draft, null, hex('c'), "8 days")).isInstanceOf(DataAccessException.class);
        jdbc.update(insert, owner, draft, null, hex('d'), "7 days");
        assertThatThrownBy(() -> jdbc.update(insert, owner, draft, null, hex('d'), "1 day")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, user(), draft, null, hex('e'), "1 day")).as("只能邀请自己名下的草稿").isInstanceOf(DataAccessException.class);
    }

    @Test
    @DisplayName("4. 成交价快照：与币种同时为空或同时存在；不能为负；写入后不可改写")
    void snapshotConstraints() {
        UUID seller = user();
        UUID buyer = user();
        UUID product = product(seller);
        String insert = "INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, contact, confirmation_code, "
                + "idempotency_key, request_hash, expires_at, price_snapshot, currency) VALUES (?,?,?,?,1,'CANCELLED','东校区-library',now()+interval '1 day',"
                + "'13800000000','123456',?,'h',now()+interval '2 days',?,?)";
        assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID(), product, buyer, seller, "k1", BigDecimal.ONE, null)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID(), product, buyer, seller, "k2", new BigDecimal("-1"), "CNY")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID(), product, buyer, seller, "k3", BigDecimal.ONE, "USD")).isInstanceOf(DataAccessException.class);
        UUID order = UUID.randomUUID();
        jdbc.update(insert, order, product, buyer, seller, "k4", BigDecimal.TEN, "CNY");
        assertThatThrownBy(() -> jdbc.update("UPDATE orders SET price_snapshot = 11 WHERE id=?", order)).isInstanceOf(DataAccessException.class);
        jdbc.update("UPDATE orders SET status='CANCELLED' WHERE id=?", order);
        assertThat(jdbc.queryForObject("SELECT price_snapshot FROM orders WHERE id=?", BigDecimal.class, order)).isEqualByComparingTo("10");
    }

    // ------------------------------------------------------------------

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, account, password_hash, nickname, campus) VALUES (?,?,?,?,?)", id, "ss-" + id, "x", "s", "东校区");
        return id;
    }

    private UUID product(UUID seller) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id, seller_id, title, description, price, category, condition, campus, status) "
                + "VALUES (?, ?, 't', 'd', 1, '其他', '全新', '东校区', '在售')", id, seller);
        return id;
    }

    private UUID draft(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO listing_drafts(id, owner_user_id, editor_user_id, draft_type, expires_at) VALUES (?,?,?,'SINGLE', now() + interval '30 days')", id, owner, owner);
        return id;
    }

    private UUID batch(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO listing_batches(id, owner_user_id) VALUES (?,?)", id, owner);
        return id;
    }

    private static String hex(char c) {
        return String.valueOf(c).repeat(64);
    }
}
