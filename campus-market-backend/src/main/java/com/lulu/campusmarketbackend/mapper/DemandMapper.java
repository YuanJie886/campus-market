package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 需求雷达的数据访问。
 *
 * <p>刻意没有「按商品列出订阅者」之类的方法：卖家侧不存在任何能看到订阅人的读路径。
 */
@Mapper
public interface DemandMapper {

    /** 用户所在学校：由用户校区推导，客户端无法指定。 */
    @Select("SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = #{userId}")
    String selectUserSchool(@Param("userId") UUID userId);

    @Select("SELECT school_id FROM campuses WHERE id = #{campus}")
    String selectCampusSchool(@Param("campus") String campus);

    @Select("SELECT count(*) FROM demand_subscriptions WHERE user_id = #{userId} AND active")
    long countActive(@Param("userId") UUID userId);

    @Select("SELECT id FROM demand_subscriptions WHERE user_id = #{userId} AND fingerprint = #{fingerprint} AND active")
    UUID selectActiveByFingerprint(@Param("userId") UUID userId, @Param("fingerprint") String fingerprint);

    /** 同条件的已停用订阅，取最近更新的一条用于重新激活。 */
    @Select("SELECT id FROM demand_subscriptions WHERE user_id = #{userId} AND fingerprint = #{fingerprint} "
            + "AND NOT active ORDER BY updated_at DESC, id LIMIT 1")
    UUID selectInactiveByFingerprint(@Param("userId") UUID userId, @Param("fingerprint") String fingerprint);

    @Insert("""
            INSERT INTO demand_subscriptions(id, user_id, school_id, keyword, normalized_keyword, category,
                min_price, max_price, geo_scope, campus_id, building_id, fingerprint, textbook_edition_id, circle_id)
            VALUES (#{id}, #{userId}, #{schoolId}, #{keyword}, #{normalizedKeyword}, #{category},
                #{minPrice}, #{maxPrice}, #{geoScope}, #{campusId}, #{buildingId}, #{fingerprint},
                #{textbookEditionId,jdbcType=VARCHAR}, #{circleId,jdbcType=OTHER})
            """)
    int insertSubscription(@Param("id") UUID id, @Param("userId") UUID userId, @Param("schoolId") String schoolId,
                           @Param("keyword") String keyword, @Param("normalizedKeyword") String normalizedKeyword,
                           @Param("category") String category, @Param("minPrice") BigDecimal minPrice,
                           @Param("maxPrice") BigDecimal maxPrice, @Param("geoScope") String geoScope,
                           @Param("campusId") String campusId, @Param("buildingId") String buildingId,
                           @Param("fingerprint") String fingerprint,
                           @Param("textbookEditionId") String textbookEditionId,
                           @Param("circleId") UUID circleId);

    @Select("SELECT count(*) FROM textbook_editions WHERE id = #{editionId} AND school_id = #{schoolId} AND active")
    long countEditionInSchool(@Param("editionId") String editionId, @Param("schoolId") String schoolId);

    /** 模块 4：本人对该教材版本的启用订阅（至多一条，部分唯一索引保证）。 */
    @Select("SELECT id FROM demand_subscriptions WHERE user_id = #{userId} "
            + "AND textbook_edition_id = #{editionId} AND active")
    UUID selectActiveByTextbook(@Param("userId") UUID userId, @Param("editionId") String editionId);

    @Update("""
            UPDATE demand_subscriptions SET
                keyword = #{keyword}, normalized_keyword = #{normalizedKeyword}, category = #{category},
                min_price = #{minPrice}, max_price = #{maxPrice}, geo_scope = #{geoScope},
                campus_id = #{campusId}, building_id = #{buildingId}, fingerprint = #{fingerprint},
                active = #{active}, updated_at = now()
            WHERE id = #{id} AND user_id = #{userId}
            """)
    int updateSubscription(@Param("id") UUID id, @Param("userId") UUID userId,
                           @Param("keyword") String keyword, @Param("normalizedKeyword") String normalizedKeyword,
                           @Param("category") String category, @Param("minPrice") BigDecimal minPrice,
                           @Param("maxPrice") BigDecimal maxPrice, @Param("geoScope") String geoScope,
                           @Param("campusId") String campusId, @Param("buildingId") String buildingId,
                           @Param("fingerprint") String fingerprint, @Param("active") boolean active);

    @Update("UPDATE demand_subscriptions SET active = #{active}, updated_at = now() "
            + "WHERE id = #{id} AND user_id = #{userId}")
    int setActive(@Param("id") UUID id, @Param("userId") UUID userId, @Param("active") boolean active);

    List<Map<String, Object>> selectSubscriptionsByUser(@Param("userId") UUID userId);

    Map<String, Object> selectSubscriptionForUser(@Param("id") UUID id, @Param("userId") UUID userId);

    List<Map<String, Object>> selectMatchCandidates(@Param("schoolId") String schoolId,
                                                    @Param("sellerId") UUID sellerId,
                                                    @Param("category") String category,
                                                    @Param("price") BigDecimal price,
                                                    @Param("normalizedTitle") String normalizedTitle,
                                                    @Param("normalizedDescription") String normalizedDescription,
                                                    @Param("campus") String campus,
                                                    @Param("buildingId") String buildingId,
                                                    @Param("zone") String zone,
                                                    @Param("textbookEditionId") String textbookEditionId,
                                                    @Param("circleIds") List<UUID> circleIds);

    /** 待写入的一条匹配。reasonCodes 为 PostgreSQL 数组字面量，只由固定常量组成。 */
    record MatchRow(UUID id, UUID subscriptionId, int score, String reasonCodes) {}

    int upsertMatches(@Param("productId") UUID productId, @Param("matches") List<MatchRow> matches);

    int invalidateMatchesExcept(@Param("productId") UUID productId, @Param("keep") List<UUID> keep);

    List<Map<String, Object>> selectMatchesForUser(@Param("userId") UUID userId,
                                                   @Param("limit") int limit, @Param("offset") int offset);

    long countMatchesForUser(@Param("userId") UUID userId);

    long countUnread(@Param("userId") UUID userId);

    /** 标记已读。通过订阅归属校验本人，他人的匹配 id 更新 0 行。幂等。 */
    @Update("""
            UPDATE demand_matches m SET read_at = COALESCE(m.read_at, now())
            FROM demand_subscriptions s
            WHERE m.id = #{id} AND s.id = m.subscription_id AND s.user_id = #{userId}
            """)
    int markRead(@Param("id") UUID id, @Param("userId") UUID userId);

    /** 忽略。同样只能作用于本人的匹配，幂等。 */
    @Update("""
            UPDATE demand_matches m SET dismissed_at = COALESCE(m.dismissed_at, now()),
                                        read_at = COALESCE(m.read_at, now())
            FROM demand_subscriptions s
            WHERE m.id = #{id} AND s.id = m.subscription_id AND s.user_id = #{userId}
            """)
    int dismiss(@Param("id") UUID id, @Param("userId") UUID userId);
}
