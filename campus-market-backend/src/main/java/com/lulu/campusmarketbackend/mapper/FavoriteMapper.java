package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.FavoriteEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface FavoriteMapper extends BaseMapper<FavoriteEntity> {
    @Select("SELECT * FROM favorites WHERE user_id=#{uid} ORDER BY created_at DESC") List<Map<String, Object>> selectRowsByUser(@Param("uid") UUID uid);
    @Delete("DELETE FROM favorites WHERE user_id=#{uid} AND product_id=#{productId}") int deleteByUserAndProduct(@Param("uid") UUID uid, @Param("productId") UUID productId);
}
