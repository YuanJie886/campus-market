package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;

import java.util.UUID;

@Mapper
public interface ReferenceMapper {
    @Select("SELECT 1") int health();
    @Select("SELECT school_id FROM campuses WHERE id = #{campus}") String selectCampusSchool(@Param("campus") String campus);
    /** 6.1A：认证用户所在校区所属的学校，学校隔离的唯一口径 */
    @Select("SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = #{userId}") String selectUserSchool(@Param("userId") UUID userId);
    /** 学校数据包：校区所属学校与两级 active 标志；校区不存在时为 null */
    @Select("SELECT c.school_id, c.active AS campus_active, s.active AS school_active FROM campuses c JOIN schools s ON s.id = c.school_id WHERE c.id = #{campus}")
    java.util.Map<String, Object> selectCampusState(@Param("campus") String campus);
    @Select("SELECT campus FROM users WHERE id = #{userId}") String selectUserCampus(@Param("userId") UUID userId);

}
