package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface ReferenceMapper {
    @Select("SELECT 1") int health();
    // V3 起带上演示坐标，供校园示意地图与面交点推荐使用；V5 起带上启用状态，停用点只用于展示历史订单
    @Select("SELECT id,campus_id,name,latitude,longitude,active FROM meeting_points ORDER BY id")
    List<Map<String, Object>> selectMeetingPoints();
    @Select("SELECT count(*) FROM meeting_points WHERE id=#{id} AND campus_id=#{campus} AND active") long countMeetingPoint(@Param("id") String id, @Param("campus") String campus);
    @Select("SELECT school_id FROM campuses WHERE id = #{campus}") String selectCampusSchool(@Param("campus") String campus);
    /** 6.1A：认证用户所在校区所属的学校，学校隔离的唯一口径 */
    @Select("SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = #{userId}") String selectUserSchool(@Param("userId") UUID userId);
    @Select("SELECT count(DISTINCT school_id) FROM campuses WHERE id IN (#{first},#{second})") long countSchools(@Param("first") String first, @Param("second") String second);

    /**
     * V8：下单瞬间的统计维度，直接来自服务端商品记录（调用方已对商品加 FOR UPDATE 行锁）。
     * 教材版本只取单件教材书籍商品的关联；学校取商品校区所属的学校。
     */
    @Select("SELECT c.school_id, p.category, p.condition, p.listing_kind, "
            + "CASE WHEN p.listing_kind = 'SINGLE' AND p.category = '教材书籍' THEN d.textbook_edition_id END AS textbook_edition_id "
            + "FROM products p JOIN campuses c ON c.id = p.campus "
            + "LEFT JOIN product_textbook_details d ON d.product_id = p.id WHERE p.id = #{productId}")
    Map<String, Object> selectTradeDimensions(@Param("productId") java.util.UUID productId);
}
