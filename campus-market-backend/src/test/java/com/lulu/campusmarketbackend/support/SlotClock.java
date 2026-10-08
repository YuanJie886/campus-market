package com.lulu.campusmarketbackend.support;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.UUID;

/**
 * 测试专用的「时间旅行」。V11 起档期接受后冻结（orders_slot_guard）、快照只增不改，生产代码没有任何路径能改写；
 * 测试要模拟「档期已经过去」或「V11 之前的旧预约」，只能在测试库里、单个事务内以 replica 角色临时跳过触发器。
 * CHECK 约束照常生效。
 */
public final class SlotClock {

    private SlotClock() {
    }

    /** 把订单当前档期（订单行 + 对应版本的冻结快照）平移到过去：时长 60 分钟，结束于 minutesAgo 分钟前。 */
    public static void endedMinutesAgo(JdbcTemplate jdbc, String orderId, int minutesAgo) {
        inReplica(jdbc, c -> {
            try (PreparedStatement o = c.prepareStatement(
                    "UPDATE orders SET meeting_at = now() - make_interval(mins => ? + 60), meeting_ends_at = now() - make_interval(mins => ?) WHERE id = ?::uuid");
                 PreparedStatement a = c.prepareStatement(
                    "UPDATE order_slot_agreements a SET starts_at = o.meeting_at, ends_at = o.meeting_ends_at FROM orders o "
                            + "WHERE o.id = ?::uuid AND a.order_id = o.id AND a.meeting_revision = o.meeting_revision")) {
                o.setInt(1, minutesAgo);
                o.setInt(2, minutesAgo);
                o.setString(3, orderId);
                o.executeUpdate();
                a.setString(1, orderId);
                a.executeUpdate();
            }
        });
    }

    /**
     * 模拟 V11 之前的旧预约：订单行没有结束时间、当前版本没有快照（开始于 startedMinutesAgo 分钟前）。
     * 与 FlywayLegacyBaselineIT 的真实升级场景一致：迁移不会为这类订单补写结束时间。
     */
    public static void legacyWithoutEnd(JdbcTemplate jdbc, String orderId, int startedMinutesAgo) {
        inReplica(jdbc, c -> {
            try (PreparedStatement o = c.prepareStatement(
                    "UPDATE orders SET meeting_at = now() - make_interval(mins => ?), meeting_ends_at = NULL WHERE id = ?::uuid");
                 PreparedStatement a = c.prepareStatement("DELETE FROM order_slot_agreements WHERE order_id = ?::uuid")) {
                o.setInt(1, startedMinutesAgo);
                o.setString(2, orderId);
                o.executeUpdate();
                a.setString(1, orderId);
                a.executeUpdate();
            }
        });
    }

    /** 把一次确认的确认时间挪到 daysAgo 天前（30 天窗口测试用；状态不变）。 */
    public static void confirmedDaysAgo(JdbcTemplate jdbc, UUID reportId, int daysAgo) {
        jdbc.update("UPDATE order_no_show_reports SET confirmed_at = now() - make_interval(days => ?) WHERE id = ?", daysAgo, reportId);
    }

    private interface Body {
        void run(Connection c) throws java.sql.SQLException;
    }

    private static void inReplica(JdbcTemplate jdbc, Body body) {
        jdbc.execute((ConnectionCallback<Void>) c -> {
            boolean auto = c.getAutoCommit();
            c.setAutoCommit(false);
            try (Statement s = c.createStatement()) {
                s.execute("SET LOCAL session_replication_role = replica");
                body.run(c);
                c.commit();
            } catch (java.sql.SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            } finally {
                c.setAutoCommit(auto);
            }
            return null;
        });
    }
}
