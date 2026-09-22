package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.UserEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;
import java.util.UUID;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Select("SELECT * FROM users WHERE id=#{id}") Map<String, Object> selectRowById(@Param("id") UUID id);
    @Select("SELECT * FROM users WHERE account=#{account}") Map<String, Object> selectRowByAccount(@Param("account") String account);
    @Select("SELECT id FROM users WHERE id=#{id} FOR UPDATE") Map<String, Object> lockById(@Param("id") UUID id);
    @Select("SELECT campus FROM users WHERE id=#{id}") String selectCampus(@Param("id") UUID id);
}
