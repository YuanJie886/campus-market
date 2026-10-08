package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.ConversationEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface ConversationMapper extends BaseMapper<ConversationEntity> {
    /**
     * 模块 6：卖家看到自己商品的全部会话；买家只看到仍能读取该商品的会话（product_readable_by：
     * 商品可见，或他在这件商品上有有效 / 已完成订单）。商品改为圈子可见后，非成员的未成交会话随之消失。
     */
    @Select("SELECT c.* FROM conversations c JOIN products p ON p.id = c.product_id "
            + "WHERE c.seller_id=#{uid} OR (c.buyer_id=#{uid} AND product_readable_by(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, #{uid})) "
            + "ORDER BY c.updated_at DESC")
    List<Map<String, Object>> selectRowsByUser(@Param("uid") UUID uid);
    @Select("SELECT * FROM conversations WHERE id=#{id}") ConversationEntity selectByConversationId(@Param("id") UUID id);
    @Select("SELECT * FROM conversations WHERE product_id=#{productId} AND buyer_id=#{buyerId}") Map<String, Object> selectRowByProductAndBuyer(@Param("productId") UUID productId, @Param("buyerId") UUID buyerId);
    @Insert("INSERT INTO conversations(id,product_id,buyer_id,seller_id) VALUES(#{id},#{productId},#{buyerId},#{sellerId}) ON CONFLICT(product_id,buyer_id) DO UPDATE SET product_id=EXCLUDED.product_id") int insertOrReuse(@Param("id") UUID id, @Param("productId") UUID productId, @Param("buyerId") UUID buyerId, @Param("sellerId") UUID sellerId);
    @Update("UPDATE conversations SET updated_at=now() WHERE id=#{id}") int touch(@Param("id") UUID id);
    /** 会话访问：参与者，且（卖家，或买家仍能读取这件商品）。与列表同一条件。 */
    @Select("SELECT count(*) FROM conversations c JOIN products p ON p.id = c.product_id WHERE c.id=#{id} "
            + "AND (c.seller_id=#{uid} OR (c.buyer_id=#{uid} AND product_readable_by(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, #{uid})))")
    long countMember(@Param("id") UUID id, @Param("uid") UUID uid);
}
