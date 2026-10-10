package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface DemandSubscriptionMapper {
    @Select("SELECT * FROM demand_subscriptions WHERE user_id=#{userId} ORDER BY created_at DESC")
    List<Map<String, Object>> selectByUser(@Param("userId") UUID userId);

    @Select("SELECT * FROM demand_subscriptions WHERE user_id=#{userId} AND keyword=#{keyword} AND category IS NOT DISTINCT FROM #{category,jdbcType=VARCHAR} AND campus IS NOT DISTINCT FROM #{campus,jdbcType=VARCHAR} AND min_price IS NOT DISTINCT FROM #{minPrice,jdbcType=NUMERIC} AND max_price IS NOT DISTINCT FROM #{maxPrice,jdbcType=NUMERIC} LIMIT 1")
    Map<String, Object> selectDuplicate(@Param("userId") UUID userId, @Param("keyword") String keyword,
                                        @Param("category") String category, @Param("campus") String campus,
                                        @Param("minPrice") BigDecimal minPrice, @Param("maxPrice") BigDecimal maxPrice);

    @Insert("INSERT INTO demand_subscriptions(id,user_id,keyword,category,campus,min_price,max_price) VALUES(#{id},#{userId},#{keyword},#{category,jdbcType=VARCHAR},#{campus,jdbcType=VARCHAR},#{minPrice,jdbcType=NUMERIC},#{maxPrice,jdbcType=NUMERIC})")
    int insert(@Param("id") UUID id, @Param("userId") UUID userId, @Param("keyword") String keyword,
               @Param("category") String category, @Param("campus") String campus,
               @Param("minPrice") BigDecimal minPrice, @Param("maxPrice") BigDecimal maxPrice);

    @Delete("DELETE FROM demand_subscriptions WHERE id=#{id} AND user_id=#{userId}")
    int deleteByUser(@Param("id") UUID id, @Param("userId") UUID userId);
}
