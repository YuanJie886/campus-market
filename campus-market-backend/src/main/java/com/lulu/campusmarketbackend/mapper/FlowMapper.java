package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 可信面交流程的数据访问：档期、到达、时间线、履历（模块 3.4～3.6）。
 */
@Mapper
public interface FlowMapper {

    String ORDER_COLUMNS = "o.id, o.product_id, o.buyer_id, o.seller_id, o.status, o.meeting_point_id, "
            + "o.meeting_at, o.meeting_ends_at, o.meeting_revision, o.expires_at, p.campus AS product_campus";

    /** 锁住订单行：同一订单上的档期、到达、验货写操作全部在这把锁下串行化。 */
    @Select("SELECT " + ORDER_COLUMNS + " FROM orders o JOIN products p ON p.id = o.product_id "
            + "WHERE o.id = #{id} FOR UPDATE OF o")
    Map<String, Object> lockOrder(@Param("id") UUID id);

    @Select("SELECT " + ORDER_COLUMNS + " FROM orders o JOIN products p ON p.id = o.product_id WHERE o.id = #{id}")
    Map<String, Object> selectOrder(@Param("id") UUID id);

    @Select("SELECT id, campus_id, name, active FROM meeting_points WHERE id = #{id}")
    Map<String, Object> selectMeetingPoint(@Param("id") String id);

    // ---------------- 档期提议 ----------------

    @Insert("""
            INSERT INTO order_meeting_proposals(id, order_id, proposer_id, meeting_point_id, starts_at, ends_at, note, status)
            VALUES (#{id}, #{orderId}, #{proposerId}, #{meetingPointId}, #{startsAt}, #{endsAt}, #{note}, 'PENDING')
            """)
    int insertProposal(@Param("id") UUID id, @Param("orderId") UUID orderId, @Param("proposerId") UUID proposerId,
                       @Param("meetingPointId") String meetingPointId, @Param("startsAt") OffsetDateTime startsAt,
                       @Param("endsAt") OffsetDateTime endsAt, @Param("note") String note);

    @Select("SELECT count(*) FROM order_meeting_proposals WHERE order_id = #{orderId} AND status = 'PENDING'")
    long countPending(@Param("orderId") UUID orderId);

    @Select("SELECT id, order_id, proposer_id, meeting_point_id, starts_at, ends_at, status, revision, responded_by "
            + "FROM order_meeting_proposals WHERE id = #{id} AND order_id = #{orderId}")
    Map<String, Object> selectProposal(@Param("id") UUID id, @Param("orderId") UUID orderId);

    /** 当前协议被替换：旧的 ACCEPTED 标记 SUPERSEDED，历史保留。必须先于新提议变成 ACCEPTED。 */
    @Update("UPDATE order_meeting_proposals SET status = 'SUPERSEDED' WHERE order_id = #{orderId} AND status = 'ACCEPTED'")
    int supersedeCurrent(@Param("orderId") UUID orderId);

    @Update("""
            UPDATE order_meeting_proposals SET status = 'ACCEPTED', revision = #{revision},
                responded_at = now(), responded_by = #{responderId}
            WHERE id = #{id} AND status = 'PENDING'
            """)
    int acceptProposal(@Param("id") UUID id, @Param("revision") int revision, @Param("responderId") UUID responderId);

    @Update("""
            UPDATE order_meeting_proposals SET status = #{status}, responded_at = now(), responded_by = #{responderId}
            WHERE id = #{id} AND status = 'PENDING'
            """)
    int closeProposal(@Param("id") UUID id, @Param("status") String status, @Param("responderId") UUID responderId);

    /** 新协议生效：更新订单上的当前档期与过期时间。 */
    @Update("""
            UPDATE orders SET meeting_point_id = #{meetingPointId}, meeting_at = #{startsAt}, meeting_ends_at = #{endsAt},
                meeting_revision = #{revision}, expires_at = #{expiresAt}, updated_at = now()
            WHERE id = #{orderId}
            """)
    int applyAgreement(@Param("orderId") UUID orderId, @Param("meetingPointId") String meetingPointId,
                       @Param("startsAt") OffsetDateTime startsAt, @Param("endsAt") OffsetDateTime endsAt,
                       @Param("revision") int revision, @Param("expiresAt") OffsetDateTime expiresAt);

    @Select("""
            SELECT pr.id, pr.proposer_id, pr.meeting_point_id, mp.name AS meeting_point_name, pr.starts_at, pr.ends_at,
                   pr.note, pr.status, pr.revision, pr.created_at, pr.responded_at
            FROM order_meeting_proposals pr JOIN meeting_points mp ON mp.id = pr.meeting_point_id
            WHERE pr.order_id = #{orderId}
            ORDER BY pr.created_at, pr.id
            """)
    List<Map<String, Object>> selectProposals(@Param("orderId") UUID orderId);

    // ---------------- 到达 ----------------

    @Select("SELECT user_id, status, departed_at, arrived_at FROM order_presence "
            + "WHERE order_id = #{orderId} AND meeting_revision = #{revision}")
    List<Map<String, Object>> selectPresence(@Param("orderId") UUID orderId, @Param("revision") int revision);

    @Insert("""
            INSERT INTO order_presence(order_id, user_id, meeting_revision, status, departed_at, arrived_at)
            VALUES (#{orderId}, #{userId}, #{revision}, #{status},
                    CASE WHEN #{status} = 'DEPARTED' THEN now() ELSE NULL END,
                    CASE WHEN #{status} = 'ARRIVED' THEN now() ELSE NULL END)
            ON CONFLICT (order_id, user_id, meeting_revision) DO NOTHING
            """)
    int insertPresence(@Param("orderId") UUID orderId, @Param("userId") UUID userId,
                       @Param("revision") int revision, @Param("status") String status);

    @Update("""
            UPDATE order_presence SET status = 'ARRIVED', arrived_at = now(), updated_at = now()
            WHERE order_id = #{orderId} AND user_id = #{userId} AND meeting_revision = #{revision} AND status = 'DEPARTED'
            """)
    int markArrived(@Param("orderId") UUID orderId, @Param("userId") UUID userId, @Param("revision") int revision);

    // ---------------- 事件与时间线 ----------------

    @Insert("INSERT INTO order_flow_events(order_id, actor_id, event_code, meeting_revision) "
            + "VALUES (#{orderId}, #{actorId}, #{code}, #{revision})")
    int insertFlowEvent(@Param("orderId") UUID orderId, @Param("actorId") UUID actorId,
                        @Param("code") String code, @Param("revision") Integer revision);

    @Insert("INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, reason) "
            + "VALUES (#{id}, #{orderId}, #{actorId}, #{from}, #{to}, #{reason})")
    int insertOrderEvent(@Param("id") UUID id, @Param("orderId") UUID orderId, @Param("actorId") UUID actorId,
                         @Param("from") String from, @Param("to") String to, @Param("reason") String reason);

    @Update("UPDATE orders SET status = #{to}, updated_at = now() WHERE id = #{orderId} AND status = #{from}")
    int moveStatus(@Param("orderId") UUID orderId, @Param("from") String from, @Param("to") String to);

    /**
     * 时间线：订单状态事件与流程事件合并为一条有序序列。
     *
     * <p>只取机器码、操作人与时间，<b>不取</b>取消原因等自由文本——那里可能有联系方式。
     * 同一事务写入的多条事件 created_at 相同，由 Java 侧按固定的逻辑先后再排一次。
     */
    @Select("""
            SELECT 'ORDER' AS source, e.from_status, e.to_status, NULL::text AS event_code,
                   e.actor_id, NULL::int AS meeting_revision, e.created_at, 0::bigint AS seq, e.id::text AS ref
            FROM order_events e WHERE e.order_id = #{orderId}
            UNION ALL
            SELECT 'FLOW', NULL, NULL, f.event_code, f.actor_id, f.meeting_revision, f.created_at, f.seq, f.seq::text
            FROM order_flow_events f WHERE f.order_id = #{orderId}
            """)
    List<Map<String, Object>> selectTimeline(@Param("orderId") UUID orderId);

    // ---------------- 履历 ----------------

    /**
     * 本人履历的全部计数：一条聚合 SQL，不逐笔订单查询。
     *
     * <p>「争议」用相关子查询按订单主键探测 order_inspections，而不是与整张表做哈希连接：
     * 这样代价随「该用户的订单数」增长，而不是随全站验货记录总数增长。
     */
    @Select("""
            SELECT
              count(*) FILTER (WHERE o.status = 'COMPLETED')                                  AS completed,
              count(*) FILTER (WHERE o.status = 'COMPLETED' AND o.buyer_id = #{userId})       AS completed_as_buyer,
              count(*) FILTER (WHERE o.status = 'COMPLETED' AND o.seller_id = #{userId})      AS completed_as_seller,
              count(*) FILTER (WHERE o.status = 'CANCELLED')                                  AS cancelled,
              count(*) FILTER (WHERE o.status = 'EXPIRED')                                    AS expired,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM order_inspections i
                                             WHERE i.order_id = o.id AND i.has_mismatch))     AS disputed,
              count(*) FILTER (WHERE o.status NOT IN ('COMPLETED','CANCELLED','EXPIRED'))     AS active
            FROM orders o
            WHERE o.buyer_id = #{userId} OR o.seller_id = #{userId}
            """)
    Map<String, Object> selectOwnCounts(@Param("userId") UUID userId);

    @Select("""
            SELECT o.id, o.status, o.buyer_id, o.seller_id, o.updated_at, p.title AS product_title
            FROM orders o JOIN products p ON p.id = o.product_id
            WHERE o.buyer_id = #{userId} OR o.seller_id = #{userId}
            ORDER BY o.updated_at DESC, o.id
            LIMIT #{limit}
            """)
    List<Map<String, Object>> selectRecentOrders(@Param("userId") UUID userId, @Param("limit") int limit);

    /**
     * 公共履历：只有聚合数字。不取任何订单 id、商品、对方身份或时间。
     * 评价只统计「对方给该用户」的评价。
     *
     * <p>先按参与者索引取出该用户的订单，再逐单经 reviews(order_id, reviewer_id) 唯一索引
     * 取评价。用选择列表里的相关子查询而不是 JOIN / LATERAL：后两者会被规划器展开成
     * 与整张 reviews 的哈希连接，代价随全站评价数增长；相关子查询则只随该用户的订单数增长。
     */
    @Select("""
            SELECT
              count(*) FILTER (WHERE x.status = 'COMPLETED') AS completed,
              coalesce(sum(x.review_count), 0)               AS review_count,
              sum(x.rating_sum)                              AS rating_sum
            FROM (
              SELECT o.status,
                     (SELECT count(*)       FROM reviews rv WHERE rv.order_id = o.id AND rv.reviewer_id <> #{userId}) AS review_count,
                     (SELECT sum(rv.rating) FROM reviews rv WHERE rv.order_id = o.id AND rv.reviewer_id <> #{userId}) AS rating_sum
              FROM orders o
              WHERE o.buyer_id = #{userId} OR o.seller_id = #{userId}
            ) x
            """)
    Map<String, Object> selectPublicCounts(@Param("userId") UUID userId);
}
