package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.*;
import java.util.*;

/**
 * 联系申请。状态机与「已读时间」的形状由 V16 的数据库守卫保证；这里的语句只按条件推进一步，
 * 返回 0 行表示状态已经变化（并发的另一次操作先到），由服务层重新读取后给出结论。
 */
@Mapper
public interface ContactRequestMapper {
    @Select("SELECT * FROM contact_requests WHERE id=#{id} FOR UPDATE")
    Map<String,Object> lock(@Param("id") UUID id);

    @Select("SELECT * FROM contact_requests WHERE product_id=#{pid} AND buyer_id=#{buyer}")
    Map<String,Object> find(@Param("pid") UUID pid, @Param("buyer") UUID buyer);

    @Select("SELECT * FROM contact_requests WHERE product_id=#{pid} AND buyer_id=#{buyer} FOR UPDATE")
    Map<String,Object> lockFor(@Param("pid") UUID pid, @Param("buyer") UUID buyer);

    /** 新申请：卖家未读；买家没有需要读的结果。 */
    @Insert("INSERT INTO contact_requests(id,product_id,buyer_id,seller_id,buyer_seen_at) VALUES(#{id},#{pid},#{buyer},#{seller},now()) "
            + "ON CONFLICT(product_id,buyer_id) DO NOTHING")
    int insert(@Param("id") UUID id, @Param("pid") UUID pid, @Param("buyer") UUID buyer, @Param("seller") UUID seller);

    /** 撤回后重新申请：回到 PENDING，卖家重新看到一条未读。 */
    @Update("UPDATE contact_requests SET status='PENDING', updated_at=now(), seller_seen_at=NULL, buyer_seen_at=now() "
            + "WHERE id=#{id} AND status='WITHDRAWN'")
    int reapply(@Param("id") UUID id);

    /** 卖家同意 / 拒绝：买家多一条未读结果。 */
    @Update("UPDATE contact_requests SET status=#{status}, updated_at=now(), decided_at=now(), buyer_seen_at=NULL "
            + "WHERE id=#{id} AND status='PENDING'")
    int decide(@Param("id") UUID id, @Param("status") String status);

    /** 买家撤回还没有处理的申请。 */
    @Update("UPDATE contact_requests SET status='WITHDRAWN', updated_at=now() WHERE id=#{id} AND status='PENDING'")
    int withdraw(@Param("id") UUID id);

    /** 卖家撤回同意：买家立即看不到联系方式，并多一条未读结果。 */
    @Update("UPDATE contact_requests SET status='REVOKED', updated_at=now(), decided_at=now(), buyer_seen_at=NULL "
            + "WHERE id=#{id} AND status='APPROVED'")
    int revoke(@Param("id") UUID id);

    String VIEW_COLUMNS = "r.*, p.title AS product_title, b.nickname AS buyer_nickname, s.nickname AS seller_nickname";
    String VIEW_JOINS = " FROM contact_requests r JOIN products p ON p.id=r.product_id JOIN users b ON b.id=r.buyer_id "
            + "JOIN users s ON s.id=r.seller_id ";
    /** 只列出本人仍能看到的商品上的申请（被隐藏、移出圈子、跨校后不再出现）。 */
    String VISIBLE = " AND product_visible_to(p.id,p.visibility,p.seller_id,p.campus,p.moderation_hidden_at,#{uid}) ";

    @Select("SELECT " + VIEW_COLUMNS + VIEW_JOINS + "WHERE r.id=#{id}")
    Map<String,Object> view(@Param("id") UUID id);

    @Select("""
            <script>
            SELECT\s""" + VIEW_COLUMNS + VIEW_JOINS + """
            WHERE <choose><when test="received">r.seller_id=#{uid}</when><otherwise>r.buyer_id=#{uid}</otherwise></choose>
            """ + VISIBLE + """
            <if test="status != null">AND r.status=#{status}</if>
            ORDER BY r.updated_at DESC, r.id
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<Map<String,Object>> page(@Param("uid") UUID uid, @Param("received") boolean received, @Param("status") String status,
                                  @Param("limit") int limit, @Param("offset") int offset);

    @Select("""
            <script>
            SELECT count(*) FROM contact_requests r JOIN products p ON p.id=r.product_id
            WHERE <choose><when test="received">r.seller_id=#{uid}</when><otherwise>r.buyer_id=#{uid}</otherwise></choose>
            """ + VISIBLE + """
            <if test="status != null">AND r.status=#{status}</if>
            </script>
            """)
    long count(@Param("uid") UUID uid, @Param("received") boolean received, @Param("status") String status);

    /** 卖家未读：还没看过的待处理申请。 */
    @Select("SELECT count(*) FROM contact_requests r JOIN products p ON p.id=r.product_id "
            + "WHERE r.seller_id=#{uid} AND r.status='PENDING' AND r.seller_seen_at IS NULL" + VISIBLE)
    long unreadReceived(@Param("uid") UUID uid);

    /** 买家未读：还没看过的同意 / 拒绝 / 撤回同意。 */
    @Select("SELECT count(*) FROM contact_requests r JOIN products p ON p.id=r.product_id "
            + "WHERE r.buyer_id=#{uid} AND r.status IN ('APPROVED','REJECTED','REVOKED') AND r.buyer_seen_at IS NULL" + VISIBLE)
    long unreadUpdates(@Param("uid") UUID uid);

    @Update("UPDATE contact_requests SET seller_seen_at=now() WHERE seller_id=#{uid} AND status='PENDING' AND seller_seen_at IS NULL")
    int markReceivedSeen(@Param("uid") UUID uid);

    @Update("UPDATE contact_requests SET buyer_seen_at=now() "
            + "WHERE buyer_id=#{uid} AND status IN ('APPROVED','REJECTED','REVOKED') AND buyer_seen_at IS NULL")
    int markUpdatesSeen(@Param("uid") UUID uid);
}
