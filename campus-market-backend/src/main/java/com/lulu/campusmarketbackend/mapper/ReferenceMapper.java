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
    @Select("SELECT id,campus_id AS campus,name FROM meeting_points ORDER BY id") List<Map<String, Object>> selectMeetingPoints();
    @Select("SELECT count(*) FROM meeting_points WHERE id=#{id} AND campus_id=#{campus}") long countMeetingPoint(@Param("id") String id, @Param("campus") String campus);
    @Select("SELECT count(DISTINCT school_id) FROM campuses WHERE id IN (#{first},#{second})") long countSchools(@Param("first") String first, @Param("second") String second);
}
