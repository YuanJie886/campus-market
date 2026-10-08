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
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V5 的数据库层约束与触发器（3.1F）。
 *
 * <p>每一条都<b>绕过服务层</b>直接写表：不可篡改、只能前进、只有参与方——
 * 这些规则如果只写在 Java 里，一次手工修数据或一个写错的新接口就能打破它们。
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
    UUID buyer, seller, stranger, product, order;

    @BeforeEach
    void fixtures() {
        buyer = user("buyer");
        seller = user("seller");
        stranger = user("stranger");
        product = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) VALUES (?,?,?,?,?,?,?,?)",
                product, seller, "t", "d", BigDecimal.TEN, "数码电子", "全新", "东校区");
        order = UUID.randomUUID();
        Timestamp later = Timestamp.from(Instant.now().plusSeconds(86_400));
        jdbc.update("INSERT INTO orders(id,product_id,buyer_id,seller_id,price,status,meeting_point_id,meeting_at,contact,"
                        + "confirmation_code,idempotency_key,request_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                order, product, buyer, seller, BigDecimal.TEN, "PENDING_MEETING", "东校区-library", later, "c",
                "123456", "k" + order, "h", later);
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

    // ------------------------------------------------------------------
    // 订单快照与验货
    // ------------------------------------------------------------------

    private void pendingInspection() {
        jdbc.update("INSERT INTO order_inspections(order_id,template_id,template_title_snapshot,template_version,status) "
                + "VALUES (?,'tpl-digital-v1','数码电子验货清单',1,'PENDING')", order);
        jdbc.update("INSERT INTO order_inspection_items(order_id,item_code,label_snapshot,description_snapshot,required_snapshot,"
                + "sort_order,seller_condition_snapshot,seller_note_snapshot) VALUES (?,'SCREEN','屏幕显示正常','',true,2,'NORMAL','')", order);
    }

    @Test
    @DisplayName("5. 验货记录的状态组合约束")
    void inspectionStateShape() {
        rejects("NOT_PROVIDED 却带模板", () -> jdbc.update(
                "INSERT INTO order_inspections(order_id,template_id,template_title_snapshot,template_version,status) "
                        + "VALUES (?,'tpl-digital-v1','t',1,'NOT_PROVIDED')", order));
        rejects("SUBMITTED 却没有提交人与时间", () -> jdbc.update(
                "INSERT INTO order_inspections(order_id,template_id,template_title_snapshot,template_version,status) "
                        + "VALUES (?,'tpl-digital-v1','t',1,'SUBMITTED')", order));
        rejects("需要处理却没有不一致", () -> jdbc.update(
                "INSERT INTO order_inspections(order_id,template_id,template_title_snapshot,template_version,status,submitted_at,submitted_by) "
                        + "VALUES (?,'tpl-digital-v1','t',1,'NEEDS_RESOLUTION',now(),?)", order, buyer));
        rejects("未知状态", () -> jdbc.update(
                "INSERT INTO order_inspections(order_id,status) VALUES (?,'已验货')", order));
    }

    @Test
    @DisplayName("6. 快照中的卖家声明任何时候都不可改；草稿阶段买家结果可改；最终提交后全部冻结；不可删除")
    void snapshotImmutability() {
        pendingInspection();
        rejects("改卖家声明快照", () -> jdbc.update(
                "UPDATE order_inspection_items SET seller_condition_snapshot='DEFECT' WHERE order_id=?", order));
        rejects("改条目文案快照", () -> jdbc.update(
                "UPDATE order_inspection_items SET label_snapshot='改了' WHERE order_id=?", order));

        // 草稿：买家结果可反复改
        jdbc.update("UPDATE order_inspection_items SET buyer_result='MISMATCH' WHERE order_id=?", order);
        jdbc.update("UPDATE order_inspection_items SET buyer_result='MATCH', checked_at=now() WHERE order_id=?", order);
        jdbc.update("UPDATE order_inspections SET status='SUBMITTED', submitted_at=now(), submitted_by=? WHERE order_id=?", buyer, order);

        rejects("提交后改买家结果", () -> jdbc.update(
                "UPDATE order_inspection_items SET buyer_result='MISMATCH' WHERE order_id=?", order));
        rejects("提交后改状态", () -> jdbc.update(
                "UPDATE order_inspections SET status='PENDING', submitted_at=NULL, submitted_by=NULL WHERE order_id=?", order));
        rejects("删条目", () -> jdbc.update("DELETE FROM order_inspection_items WHERE order_id=?", order));
        rejects("删记录", () -> jdbc.update("DELETE FROM order_inspections WHERE order_id=?", order));
    }

    @Test
    @DisplayName("7. 买家备注限长、禁 HTML；未给结果不能有检查时间")
    void buyerInputShape() {
        pendingInspection();
        rejects("备注超长", () -> jdbc.update("UPDATE order_inspection_items SET buyer_note=? WHERE order_id=?", "长".repeat(201), order));
        rejects("备注含 HTML", () -> jdbc.update("UPDATE order_inspection_items SET buyer_note='<b>x</b>' WHERE order_id=?", order));
        rejects("未知买家结果", () -> jdbc.update("UPDATE order_inspection_items SET buyer_result='OK' WHERE order_id=?", order));
        rejects("没有结果却有检查时间", () -> jdbc.update("UPDATE order_inspection_items SET checked_at=now() WHERE order_id=?", order));
    }

    // ------------------------------------------------------------------
    // 档期提议
    // ------------------------------------------------------------------

    private static final String PROPOSE = "INSERT INTO order_meeting_proposals(id,order_id,proposer_id,meeting_point_id,starts_at,ends_at,status) "
            + "VALUES (gen_random_uuid(),?,?,'东校区-library',now() + interval '1 day',now() + interval '1 day' + (?::int * interval '1 minute'),'PENDING')";

    @Test
    @DisplayName("8. 时间段：结束必须晚于开始，且不超过 2 小时")
    void proposalWindow() {
        rejects("结束不晚于开始", () -> jdbc.update(PROPOSE, order, buyer, 0));
        rejects("超过 2 小时", () -> jdbc.update(PROPOSE, order, buyer, 121));
        jdbc.update(PROPOSE, order, buyer, 120);
    }

    @Test
    @DisplayName("9. 同一订单最多一个待处理提议、最多一个当前协议")
    void onePendingOneCurrent() {
        jdbc.update(PROPOSE, order, buyer, 30);
        rejects("第二个 PENDING", () -> jdbc.update(PROPOSE, order, seller, 30));

        String accepted = "INSERT INTO order_meeting_proposals(id,order_id,proposer_id,meeting_point_id,starts_at,ends_at,status,revision,responded_at,responded_by) "
                + "VALUES (gen_random_uuid(),?,?,'东校区-library',now()+interval '2 day',now()+interval '2 day 30 minutes','ACCEPTED',?,now(),?)";
        jdbc.update(accepted, order, buyer, 1, seller);
        rejects("两个当前协议", () -> jdbc.update(accepted, order, buyer, 2, seller));
    }

    @Test
    @DisplayName("10. 不能接受或拒绝自己的提议；撤回只能由发起方；接受必须有版本号")
    void responderRules() {
        String responded = "INSERT INTO order_meeting_proposals(id,order_id,proposer_id,meeting_point_id,starts_at,ends_at,status,revision,responded_at,responded_by) "
                + "VALUES (gen_random_uuid(),?,?,'东校区-library',now()+interval '1 day',now()+interval '1 day 30 minutes',?,?,now(),?)";
        rejects("自己接受自己", () -> jdbc.update(responded, order, buyer, "ACCEPTED", 1, buyer));
        rejects("自己拒绝自己", () -> jdbc.update(responded, order, buyer, "REJECTED", null, buyer));
        rejects("对方替我撤回", () -> jdbc.update(responded, order, buyer, "WITHDRAWN", null, seller));
        rejects("接受却没有版本号", () -> jdbc.update(responded, order, buyer, "ACCEPTED", null, seller));
        rejects("拒绝却带版本号", () -> jdbc.update(responded, order, buyer, "REJECTED", 3, seller));
    }

    @Test
    @DisplayName("11. 订单当前协议窗口：结束晚于开始且不超过 2 小时；V11 起档期只能随版本号增加（改约握手）变化")
    void orderMeetingWindow() {
        // 同时增加版本号（相当于一次被接受的改约），这样被拒绝的原因是 V5 的窗口 CHECK，而不是 V11 的冻结
        rejects("结束早于开始", () -> jdbc.update("UPDATE orders SET meeting_ends_at = meeting_at - interval '1 minute', meeting_revision = meeting_revision + 1 WHERE id=?", order));
        rejects("超过 2 小时", () -> jdbc.update("UPDATE orders SET meeting_ends_at = meeting_at + interval '3 hours', meeting_revision = meeting_revision + 1 WHERE id=?", order));
        rejects("V11：版本号不变时档期冻结", () -> jdbc.update("UPDATE orders SET meeting_ends_at = meeting_at + interval '30 minutes' WHERE id=?", order));
        jdbc.update("UPDATE orders SET meeting_ends_at = meeting_at + interval '30 minutes', meeting_revision = meeting_revision + 1 WHERE id=?", order);
    }

    // ------------------------------------------------------------------
    // 到达状态
    // ------------------------------------------------------------------

    private static final String PRESENCE = "INSERT INTO order_presence(order_id,user_id,meeting_revision,status,departed_at,arrived_at) VALUES (?,?,0,?,?,?)";

    @Test
    @DisplayName("12. 只有订单买卖双方能有到达记录")
    void presenceParticipantsOnly() {
        rejects("非参与方", () -> jdbc.update(PRESENCE, order, stranger, "DEPARTED", Timestamp.from(Instant.now()), null));
        jdbc.update(PRESENCE, order, buyer, "DEPARTED", Timestamp.from(Instant.now()), null);
    }

    @Test
    @DisplayName("13. 状态组合合法；只能前进；已记录的时间不可改写；不可删除")
    void presenceMovesForwardOnly() {
        // 取数据库时间：下面的 arrived_at=now() 也是数据库时间，宿主机与数据库的时钟偏差不能影响「到达不早于出发」的判断
        Timestamp now = jdbc.queryForObject("SELECT now()", Timestamp.class);
        rejects("DEPARTED 没有出发时间", () -> jdbc.update(PRESENCE, order, buyer, "DEPARTED", null, null));
        rejects("到达早于出发", () -> jdbc.update(PRESENCE, order, buyer, "ARRIVED",
                now, Timestamp.from(now.toInstant().minusSeconds(60))));

        jdbc.update(PRESENCE, order, buyer, "DEPARTED", now, null);
        jdbc.update("UPDATE order_presence SET status='ARRIVED', arrived_at=now() WHERE order_id=? AND user_id=?", order, buyer);
        rejects("ARRIVED 退回 DEPARTED", () -> jdbc.update(
                "UPDATE order_presence SET status='DEPARTED', arrived_at=NULL WHERE order_id=? AND user_id=?", order, buyer));
        rejects("改写出发时间", () -> jdbc.update(
                "UPDATE order_presence SET departed_at=now() - interval '1 hour' WHERE order_id=? AND user_id=?", order, buyer));
        rejects("删除历史", () -> jdbc.update("DELETE FROM order_presence WHERE order_id=?", order));

        // 允许直接「已到」（同楼自提），此时不伪造出发时间
        jdbc.update(PRESENCE, order, seller, "ARRIVED", null, now);
    }

    @Test
    @DisplayName("14. 到达表没有任何坐标、定位精度、路线或设备字段")
    void presenceStoresNoLocation() {
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name='order_presence'", String.class);
        assertThat(columns).containsExactlyInAnyOrder(
                "order_id", "user_id", "meeting_revision", "status", "departed_at", "arrived_at", "updated_at");
    }

    // ------------------------------------------------------------------
    // 事件与面交点
    // ------------------------------------------------------------------

    @Test
    @DisplayName("15. 流程事件只接受已知机器码，且不存自由文本")
    void flowEventCodes() {
        jdbc.update("INSERT INTO order_flow_events(order_id,actor_id,event_code,meeting_revision) VALUES (?,?,'PRESENCE_DEPARTED',0)", order, buyer);
        rejects("未知机器码", () -> jdbc.update(
                "INSERT INTO order_flow_events(order_id,actor_id,event_code) VALUES (?,?,'已出发')", order, buyer));
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name='order_flow_events'", String.class);
        assertThat(columns).noneSatisfy(c -> assertThat(c).containsAnyOf("note", "reason", "payload", "text", "code_value"));
    }

    @Test
    @DisplayName("16. 面交点默认启用，可停用")
    void meetingPointActive() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM meeting_points WHERE active", Integer.class)).isEqualTo(12);
        jdbc.update("UPDATE meeting_points SET active=false WHERE id='北校区-express'");
        jdbc.update("UPDATE meeting_points SET active=true WHERE id='北校区-express'");
    }
}
