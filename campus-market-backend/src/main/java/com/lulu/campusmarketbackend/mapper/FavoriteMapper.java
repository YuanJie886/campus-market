package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.FavoriteEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface FavoriteMapper extends BaseMapper<FavoriteEntity> {
    /** 模块 6：只列出当前仍可见的商品——商品改成圈子可见后，非成员的收藏不再出现，也不暴露它是否存在。 */
    @Select("SELECT f.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id=#{uid} "
            + "AND product_visible_to(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, #{uid}) ORDER BY f.created_at DESC")
    List<Map<String, Object>> selectRowsByUser(@Param("uid") UUID uid);
    @Delete("DELETE FROM favorites WHERE user_id=#{uid} AND product_id=#{productId}") int deleteByUserAndProduct(@Param("uid") UUID uid, @Param("productId") UUID productId);
    /**
     * 幂等新增收藏。依赖 favorites 表已有的 UNIQUE(user_id, product_id) 约束，
     * 用 ON CONFLICT DO NOTHING 让重复调用成为无副作用的空操作，
     * 而不是靠捕获唯一约束异常来兜底。
     */
    @Insert("INSERT INTO favorites(id,user_id,product_id) VALUES(#{id},#{uid},#{productId}) ON CONFLICT (user_id,product_id) DO NOTHING")
    int insertIfAbsent(@Param("id") UUID id, @Param("uid") UUID uid, @Param("productId") UUID productId);
    @Select("SELECT count(*) FROM favorites WHERE user_id=#{uid} AND product_id=#{productId}") int countByUserAndProduct(@Param("uid") UUID uid, @Param("productId") UUID productId);
}
