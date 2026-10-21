package com.lulu.campusmarketbackend.support;

import com.lulu.campusmarketbackend.support.SupplyApi.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

/**
 * 历史订单夹具（冻结的 SQL 种子）。站内交易已停用，V16 把订单相关表冻结为只读历史，应用里也没有任何写订单的代码；
 * 后台只读查看、可见性与治理规则仍要面对 V16 之前留下的这些行。这里在单个事务里以 replica 角色临时跳过触发器，
 * 写入与 V16 收尾之后的历史形状一致的数据：订单已经结束（EXPIRED 或 CANCELLED），带下单时的快照与事件。
 * CHECK 与外键照常生效。只用于测试库。
 */
public final class LegacyOrders {

    private LegacyOrders() {}

    /** 一笔被 V16 统一关闭的历史订单（待卖家确认 → EXPIRED），返回订单 id。 */
    public static String expired(JdbcTemplate jdbc, User buyer, String productId) {
        return seed(jdbc, buyer, productId, "EXPIRED", null);
    }

    /** 一笔由买家在卖家确认前取消的历史订单（带取消说明），返回订单 id。 */
    public static String cancelled(JdbcTemplate jdbc, User buyer, String productId, String note) {
        return seed(jdbc, buyer, productId, "CANCELLED", note);
    }

    private static String seed(JdbcTemplate jdbc, User buyer, String productId, String finalStatus, String note) {
        UUID id = UUID.randomUUID();
        new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())).executeWithoutResult(tx -> {
            jdbc.execute("SET LOCAL session_replication_role = replica");
            jdbc.update("""
                    INSERT INTO orders(id, product_id, buyer_id, seller_id, price, status, meeting_point_id, meeting_at, meeting_ends_at,
                                       contact, confirmation_code, idempotency_key, request_hash, expires_at,
                                       price_snapshot, currency, school_id_snapshot, category_snapshot, condition_snapshot,
                                       listing_kind_snapshot, visibility_snapshot, created_at, updated_at)
                    SELECT ?, p.id, ?::uuid, p.seller_id, p.price, ?, p.campus || '-library',
                           now() + interval '1 day', now() + interval '1 day 1 hour',
                           '13800000000', '000000', ?, 'legacy', now() + interval '1 day',
                           p.price, 'CNY', c.school_id, p.category, p.condition, p.listing_kind, COALESCE(p.visibility, 'PUBLIC'),
                           now() - interval '2 days', now() - interval '1 day'
                    FROM products p JOIN campuses c ON c.id = p.campus WHERE p.id = ?::uuid
                    """, id, buyer.id(), finalStatus, UUID.randomUUID().toString(), productId);
            jdbc.update("INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, created_at) "
                    + "VALUES (?, ?, ?::uuid, NULL, 'PENDING_SELLER_CONFIRM', now() - interval '2 days')", UUID.randomUUID(), id, buyer.id());
            boolean cancelled = "CANCELLED".equals(finalStatus);
            jdbc.update("INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, reason, created_at) "
                    + "VALUES (?, ?, ?::uuid, 'PENDING_SELLER_CONFIRM', ?, ?, now() - interval '1 day')",
                    UUID.randomUUID(), id, cancelled ? buyer.id() : null, finalStatus, cancelled ? note : "平台已停止站内交易，未结束的订单统一关闭");
            if (cancelled) {
                jdbc.update("INSERT INTO order_cancellations(order_id, school_id, actor_user_id, phase, reason_code, note) "
                        + "SELECT ?, school_id_snapshot, ?::uuid, 'BEFORE_SELLER_CONFIRM', 'OTHER', ? FROM orders WHERE id = ?",
                        id, buyer.id(), note, id);
            }
        });
        return id.toString();
    }
}
