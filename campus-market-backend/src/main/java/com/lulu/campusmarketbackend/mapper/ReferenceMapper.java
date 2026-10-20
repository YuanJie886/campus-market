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

}
