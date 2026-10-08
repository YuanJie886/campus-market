package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 模块 6：圈子、成员关系、邀请、审计与商品圈子可见关系。可见性判断本身在 V9 的 SQL 函数里。 */
@Mapper
public interface CircleMapper {

    // ================= 圈子 =================

    @Insert("INSERT INTO circles(id, school_id, type, name, description, visibility, owner_user_id) "
            + "VALUES (#{id}, #{schoolId}, #{type}, #{name}, #{description}, #{visibility}, #{owner})")
    int insertCircle(@Param("id") UUID id, @Param("schoolId") String schoolId, @Param("type") String type,
                     @Param("name") String name, @Param("description") String description,
                     @Param("visibility") String visibility, @Param("owner") UUID owner);

    @Select("SELECT * FROM circles WHERE id = #{id}")
    Map<String, Object> selectCircle(@Param("id") UUID id);

    /** 所有成员变动、归档、改资料都先锁圈子行：同一圈子的这些操作串行执行。 */
    @Select("SELECT * FROM circles WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockCircle(@Param("id") UUID id);

    @Update("UPDATE circles SET name = #{name}, description = #{description}, visibility = #{visibility}, type = #{type}, "
            + "updated_at = now() WHERE id = #{id} AND status = 'ACTIVE'")
    int updateCircle(@Param("id") UUID id, @Param("type") String type, @Param("name") String name,
                     @Param("description") String description, @Param("visibility") String visibility);

    // 状态变化的时间用 clock_timestamp()（执行这条语句的时刻）而不是 now()（事务开始时刻）：
    // 等锁的事务开始得早、生效得晚，用 now() 会让时间顺序与实际生效顺序相反
    @Update("UPDATE circles SET status = 'ARCHIVED', archived_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = #{id} AND status = 'ACTIVE'")
    int archiveCircle(@Param("id") UUID id);

    @Update("UPDATE circles SET owner_user_id = #{owner}, updated_at = now() WHERE id = #{id}")
    int setCircleOwner(@Param("id") UUID id, @Param("owner") UUID owner);

    /** 我在籍的圈子（含已归档，便于查看历史）。只返回圈子资料与我的角色，不含任何其他成员。 */
    @Select("SELECT c.id, c.type, c.name, c.description, c.visibility, c.status, c.created_at, m.role, m.joined_at "
            + "FROM circle_memberships m JOIN circles c ON c.id = m.circle_id "
            + "WHERE m.user_id = #{userId} AND m.status = 'ACTIVE' ORDER BY c.status, c.name COLLATE \"C\", c.id")
    List<Map<String, Object>> selectMyCircles(@Param("userId") UUID userId);

    /** 本校可发现的在用圈子。只有名称、简介、类型与「我是否已在籍」，不含所有者、人数或成员。 */
    @Select("""
            <script>
            SELECT c.id, c.type, c.name, c.description,
                   EXISTS (SELECT 1 FROM circle_memberships m WHERE m.circle_id = c.id AND m.user_id = #{userId} AND m.status = 'ACTIVE') AS joined
            FROM circles c
            WHERE c.school_id = #{schoolId} AND c.status = 'ACTIVE' AND c.visibility = 'DISCOVERABLE'
            <if test="q != null">AND strpos(lower(c.name), #{q}) &gt; 0</if>
            ORDER BY c.created_at DESC, c.id
            LIMIT #{limit}
            </script>
            """)
    List<Map<String, Object>> selectDiscoverable(@Param("schoolId") String schoolId, @Param("userId") UUID userId,
                                                 @Param("q") String q, @Param("limit") int limit);

    // ================= 成员关系 =================

    @Select("SELECT * FROM circle_memberships WHERE circle_id = #{circleId} AND user_id = #{userId}")
    Map<String, Object> selectMembership(@Param("circleId") UUID circleId, @Param("userId") UUID userId);

    /**
     * 加入或重新加入（退出 / 被移除后再次通过邀请加入）。只在当前不在籍时生效，返回 0 表示已经在籍。
     * 主键 (circle_id, user_id) 保证同一个人在同一圈子只有一条记录，不会出现重复成员。
     */
    @Insert("INSERT INTO circle_memberships(circle_id, user_id, school_id, role) VALUES (#{circleId}, #{userId}, #{schoolId}, #{role}) "
            + "ON CONFLICT (circle_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', joined_at = now(), "
            + "updated_at = now(), ended_at = NULL WHERE circle_memberships.status <> 'ACTIVE'")
    int joinCircle(@Param("circleId") UUID circleId, @Param("userId") UUID userId,
                   @Param("schoolId") String schoolId, @Param("role") String role);

    @Update("UPDATE circle_memberships SET role = #{role}, updated_at = now() "
            + "WHERE circle_id = #{circleId} AND user_id = #{userId} AND status = 'ACTIVE'")
    int setRole(@Param("circleId") UUID circleId, @Param("userId") UUID userId, @Param("role") String role);

    @Update("UPDATE circle_memberships SET status = #{status}, role = 'MEMBER', ended_at = clock_timestamp(), updated_at = clock_timestamp() "
            + "WHERE circle_id = #{circleId} AND user_id = #{userId} AND status = 'ACTIVE'")
    int endMembership(@Param("circleId") UUID circleId, @Param("userId") UUID userId, @Param("status") String status);

    /**
     * 管理所需的最小公共投影：昵称、头像、角色、加入时间。没有账号、联系方式或宿舍楼。
     * 6.1C：分页；排序（角色优先级 → 加入时间 → userId）与 V10 的 circle_memberships_page 索引逐列一致。
     */
    @Select("SELECT m.user_id, u.nickname, u.avatar, m.role, m.joined_at FROM ("
            + "SELECT user_id, role, joined_at, circle_role_rank(role) AS rank FROM circle_memberships "
            + "WHERE circle_id = #{circleId} AND status = 'ACTIVE' "
            + "ORDER BY circle_role_rank(role), joined_at, user_id LIMIT #{limit} OFFSET #{offset}) m "
            + "JOIN users u ON u.id = m.user_id ORDER BY m.rank, m.joined_at, m.user_id")
    List<Map<String, Object>> selectMembers(@Param("circleId") UUID circleId, @Param("limit") int limit, @Param("offset") int offset);

    @Select("SELECT count(*) FROM circle_memberships WHERE circle_id = #{circleId} AND status = 'ACTIVE'")
    long countActiveMembers(@Param("circleId") UUID circleId);

    // ================= 审计 =================

    @Insert("INSERT INTO circle_events(circle_id, actor_user_id, target_user_id, event_code, detail_code) "
            + "VALUES (#{circleId}, #{actor}, #{target}, #{code}, #{detail})")
    int insertEvent(@Param("circleId") UUID circleId, @Param("actor") UUID actor, @Param("target") UUID target,
                    @Param("code") String code, @Param("detail") String detail);

    @Select("SELECT event_code, detail_code, actor_user_id, target_user_id, created_at FROM circle_events "
            + "WHERE circle_id = #{circleId} ORDER BY seq")
    List<Map<String, Object>> selectEvents(@Param("circleId") UUID circleId);

    // ================= 邀请 =================

    /** 到期时间与 created_at 用同一个数据库 now() 计算：应用与数据库的时钟偏差不会让 7 天上限的 CHECK 误判。 */
    @Insert("INSERT INTO circle_invites(id, circle_id, created_by, token_hash, expires_at) "
            + "VALUES (#{id}, #{circleId}, #{createdBy}, #{tokenHash}, now() + make_interval(hours => #{hours}))")
    int insertInvite(@Param("id") UUID id, @Param("circleId") UUID circleId, @Param("createdBy") UUID createdBy,
                     @Param("tokenHash") String tokenHash, @Param("hours") int hours);

    /** unexpired 用数据库时间判断（与 redeemInvite 的 expires_at > now() 同一口径）。 */
    @Select("SELECT i.*, i.expires_at > now() AS unexpired FROM circle_invites i WHERE i.token_hash = #{hash} FOR UPDATE")
    Map<String, Object> lockInviteByHash(@Param("hash") String hash);

    @Select("SELECT * FROM circle_invites WHERE id = #{id}")
    Map<String, Object> selectInvite(@Param("id") UUID id);

    @Update("UPDATE circle_invites SET status = 'REDEEMED', redeemed_by = #{userId}, redeemed_at = now() "
            + "WHERE id = #{id} AND status = 'PENDING' AND expires_at > now()")
    int redeemInvite(@Param("id") UUID id, @Param("userId") UUID userId);

    @Update("UPDATE circle_invites SET status = 'REVOKED', revoked_at = now() WHERE id = #{id} AND status = 'PENDING'")
    int revokeInvite(@Param("id") UUID id);

    @Update("UPDATE circle_invites SET status = 'REVOKED', revoked_at = now() WHERE circle_id = #{circleId} AND status = 'PENDING'")
    int revokePendingInvites(@Param("circleId") UUID circleId);

    @Select("SELECT i.id, i.status, i.expires_at, i.created_at, i.redeemed_at, i.revoked_at FROM circle_invites i "
            + "WHERE i.circle_id = #{circleId} ORDER BY i.created_at DESC, i.id LIMIT 100")
    List<Map<String, Object>> selectInvites(@Param("circleId") UUID circleId);

    // ================= 退出 / 移除 / 归档的连带清理 =================

    /** 成员离开后：他在这个圈子的订阅停用。返回停用条数。 */
    @Update("UPDATE demand_subscriptions SET active = false, updated_at = clock_timestamp() "
            + "WHERE circle_id = #{circleId} AND user_id = #{userId} AND active")
    int deactivateMemberSubscriptions(@Param("circleId") UUID circleId, @Param("userId") UUID userId);

    /** 成员离开后：这些订阅产生的匹配一律失效（未读随之清零，收件箱不再出现私密商品）。 */
    @Update("UPDATE demand_matches SET invalidated_at = clock_timestamp() WHERE invalidated_at IS NULL AND subscription_id IN "
            + "(SELECT id FROM demand_subscriptions WHERE circle_id = #{circleId} AND user_id = #{userId})")
    int invalidateMemberMatches(@Param("circleId") UUID circleId, @Param("userId") UUID userId);

    @Update("UPDATE demand_subscriptions SET active = false, updated_at = clock_timestamp() WHERE circle_id = #{circleId} AND active")
    int deactivateCircleSubscriptions(@Param("circleId") UUID circleId);

    @Update("UPDATE demand_matches SET invalidated_at = clock_timestamp() WHERE invalidated_at IS NULL AND subscription_id IN "
            + "(SELECT id FROM demand_subscriptions WHERE circle_id = #{circleId})")
    int invalidateCircleMatches(@Param("circleId") UUID circleId);

    // ================= 商品圈子可见关系 =================

    /**
     * 发布 / 购买前的成员资格检查，并对涉及的圈子行与成员行加共享锁：
     * 并发的移除、退出、归档（它们要改这些行）必须等本事务提交，不会出现「检查通过后立刻失效」的窗口。
     * 返回满足「圈子在用、同校、该用户在籍」的圈子 id。
     */
    @Select("""
            <script>
            SELECT c.id FROM circles c
            WHERE c.status = 'ACTIVE' AND c.school_id = #{schoolId}
              AND c.id IN <foreach collection="circleIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY c.id
            FOR SHARE
            </script>
            """)
    List<UUID> lockActiveCircles(@Param("schoolId") String schoolId, @Param("circleIds") List<UUID> circleIds);

    @Select("""
            <script>
            SELECT m.circle_id FROM circle_memberships m
            WHERE m.user_id = #{userId} AND m.status = 'ACTIVE'
              AND m.circle_id IN <foreach collection="circleIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY m.circle_id
            FOR SHARE
            </script>
            """)
    List<UUID> lockActiveMemberships(@Param("userId") UUID userId, @Param("circleIds") List<UUID> circleIds);

    /**
     * 发布 / 订阅前的成员资格检查，并加共享锁：并发的移除、退出、归档（它们先对圈子行加 FOR UPDATE，再改成员行）
     * 必须等本事务结束。<b>加锁顺序固定为「先圈子、后成员」</b>，与移除 / 归档一致，因此不会互相死锁。
     * 返回满足「圈子在用、同校、该用户在籍」的圈子 id。
     */
    default List<UUID> lockUsableCircles(UUID userId, String schoolId, List<UUID> circleIds) {
        List<UUID> active = lockActiveCircles(schoolId, circleIds);
        if (active.isEmpty()) return List.of();
        return lockActiveMemberships(userId, active);
    }

    /** 买家对某件圈子商品的访问：同样先锁圈子、后锁成员行，返回买家可以凭之购买的圈子。 */
    default List<UUID> lockBuyerAccess(UUID productId, UUID userId, String schoolId) {
        List<UUID> linked = selectProductCircleIds(productId);
        if (linked.isEmpty()) return List.of();
        return lockUsableCircles(userId, schoolId, linked);
    }

    @Insert("""
            <script>
            INSERT INTO product_circle_visibility(product_id, circle_id) VALUES
            <foreach collection="circleIds" item="id" separator=",">(#{productId}, #{id})</foreach>
            </script>
            """)
    int insertProductCircles(@Param("productId") UUID productId, @Param("circleIds") List<UUID> circleIds);

    @Update("DELETE FROM product_circle_visibility WHERE product_id = #{productId}")
    int deleteProductCircles(@Param("productId") UUID productId);

    @Select("SELECT circle_id FROM product_circle_visibility WHERE product_id = #{productId} ORDER BY circle_id")
    List<UUID> selectProductCircleIds(@Param("productId") UUID productId);

    /** 单个商品的权威可读判断（V9 product_readable_by）。商品不存在时返回 null。 */
    @Select("SELECT product_readable_by(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, #{viewer}) FROM products p WHERE p.id = #{productId}")
    Boolean selectReadable(@Param("productId") UUID productId, @Param("viewer") UUID viewer);

    /** 批量发布预校验用：某用户在籍的在用圈子 id（一条语句）。 */
    @Select("SELECT m.circle_id FROM circle_memberships m JOIN circles c ON c.id = m.circle_id AND c.status = 'ACTIVE' "
            + "WHERE m.user_id = #{userId} AND m.status = 'ACTIVE' AND c.school_id = #{schoolId}")
    List<UUID> selectUsableCircleIds(@Param("userId") UUID userId, @Param("schoolId") String schoolId);

    @Select("SELECT school_id FROM campuses WHERE id = #{campus}")
    String selectCampusSchool(@Param("campus") String campus);

    @Select("SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = #{userId}")
    String selectUserSchool(@Param("userId") UUID userId);
}
