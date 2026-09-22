package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.CommentEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface CommentMapper extends BaseMapper<CommentEntity> {
    @Select("SELECT * FROM comments WHERE product_id=#{productId} ORDER BY created_at") List<Map<String, Object>> selectRowsByProduct(@Param("productId") UUID productId);
    @Select("SELECT count(*) FROM comments WHERE id=#{id} AND product_id=#{productId} AND parent_id IS NULL") long countRootByIdAndProduct(@Param("id") UUID id, @Param("productId") UUID productId);
}
