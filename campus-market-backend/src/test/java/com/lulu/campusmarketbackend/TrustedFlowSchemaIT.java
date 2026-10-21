package com.lulu.campusmarketbackend;

import org.junit.jupiter.api.BeforeEach;
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
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V5 的数据库层约束与触发器（3.1F）：验货模板与商品声明。
 *
 * <p>每一条都<b>绕过服务层</b>直接写表——这些规则如果只写在 Java 里，一次手工修数据或一个写错的新接口就能打破它们。
 * 订单验货快照、档期提议、到达记录、流程事件与面交点的约束随站内交易一起退役：V16 起这些表是只读历史，
 * 任何写入都被拒绝（PostgresSchemaIT「历史交易表只读」）。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class TrustedFlowSchemaIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_tf_schema")
            .withUsername("campus_tfs").withPassword("campus_tfs_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "trusted-flow-schema-secret-0123456789");
    }

    @Autowired JdbcTemplate jdbc;
    UUID seller, product;

    @BeforeEach
    void fixtures() {
        seller = user("seller");
        product = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) VALUES (?,?,?,?,?,?,?,?)",
                product, seller, "t", "d", BigDecimal.TEN, "数码电子", "全新", "东校区");
    }

    private UUID user(String prefix) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,?,?)",
                id, prefix + id, "x", prefix, "东校区");
        return id;
    }

    private void rejects(String description, Runnable action) {
        assertThatThrownBy(action::run).as(description).isInstanceOf(DataAccessException.class);
    }

    // ------------------------------------------------------------------
    // 模板
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 模板种子覆盖五个真实分类，「其他」无模板；每个分类只有一个启用版本")
    void templateSeeds() {
        List<String> categories = jdbc.queryForList(
                "SELECT category FROM inspection_templates WHERE active ORDER BY category", String.class);
        assertThat(categories).containsExactlyInAnyOrder("数码电子", "教材书籍", "生活用品", "服饰鞋包", "运动户外");
        rejects("同分类两个启用版本", () -> jdbc.update(
                "INSERT INTO inspection_templates(id,category,version,title) VALUES ('x-v2','数码电子',2,'新版')"));
        rejects("版本号必须为正", () -> jdbc.update(
                "INSERT INTO inspection_templates(id,category,version,title,active) VALUES ('x-v0','其他',0,'t',false)"));
    }

    @Test
    @DisplayName("2. 已发布的模板条目不可修改或删除；模板只允许切换 active")
    void templatesAreImmutable() {
        rejects("改条目文案", () -> jdbc.update(
                "UPDATE inspection_template_items SET label='改了' WHERE id='tpl-digital-v1:SCREEN'"));
        rejects("删条目", () -> jdbc.update("DELETE FROM inspection_template_items WHERE id='tpl-digital-v1:SCREEN'"));
        rejects("改模板标题", () -> jdbc.update("UPDATE inspection_templates SET title='改了' WHERE id='tpl-books-v1'"));
        rejects("删模板", () -> jdbc.update("DELETE FROM inspection_templates WHERE id='tpl-books-v1'"));

        // 下线旧版本、发布新版本是受支持的路径
        jdbc.update("UPDATE inspection_templates SET active=false WHERE id='tpl-sports-v1'");
        jdbc.update("INSERT INTO inspection_templates(id,category,version,title) VALUES ('tpl-sports-v2','运动户外',2,'运动户外验货清单')");
        jdbc.update("UPDATE inspection_templates SET active=false WHERE id='tpl-sports-v2'");
        jdbc.update("UPDATE inspection_templates SET active=true WHERE id='tpl-sports-v1'");
    }

    @Test
    @DisplayName("3. 条目机器码格式、排序号非负")
    void templateItemShape() {
        jdbc.update("INSERT INTO inspection_templates(id,category,version,title,active) VALUES ('shape-v9','其他',9,'t',false)");
        rejects("机器码不能是中文", () -> jdbc.update(
                "INSERT INTO inspection_template_items(id,template_id,code,label,sort_order) VALUES ('s1','shape-v9','屏幕','屏幕',0)"));
        rejects("排序号为负", () -> jdbc.update(
                "INSERT INTO inspection_template_items(id,template_id,code,label,sort_order) VALUES ('s2','shape-v9','OK_CODE','x',-1)"));
    }

    // ------------------------------------------------------------------
    // 商品声明
    // ------------------------------------------------------------------

    @Test
    @DisplayName("4. 商品声明：枚举、长度、HTML、条目必须属于该模板")
    void disclosureConstraints() {
        String sql = "INSERT INTO product_inspection_disclosures(product_id,template_id,item_code,declared_condition,note) VALUES (?,?,?,?,?)";
        jdbc.update(sql, product, "tpl-digital-v1", "SCREEN", "DEFECT", "左上角一处划痕");
        rejects("未知状态", () -> jdbc.update(sql, product, "tpl-digital-v1", "BATTERY", "GOOD", ""));
        rejects("说明超长", () -> jdbc.update(sql, product, "tpl-digital-v1", "BATTERY", "NORMAL", "长".repeat(201)));
        rejects("说明含 HTML", () -> jdbc.update(sql, product, "tpl-digital-v1", "BATTERY", "NORMAL", "<script>"));
        rejects("条目不属于该模板", () -> jdbc.update(sql, product, "tpl-digital-v1", "PAGES_COMPLETE", "NORMAL", ""));
        rejects("同一商品同一条目重复", () -> jdbc.update(sql, product, "tpl-digital-v1", "SCREEN", "NORMAL", ""));
    }
}
