package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.ConversationEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface ConversationMapper extends BaseMapper<ConversationEntity> {
    @Select("SELECT * FROM conversations WHERE buyer_id=#{uid} OR seller_id=#{uid} ORDER BY updated_at DESC") List<Map<String, Object>> selectRowsByUser(@Param("uid") UUID uid);
    @Select("SELECT * FROM conversations WHERE id=#{id}") ConversationEntity selectByConversationId(@Param("id") UUID id);
    @Select("SELECT * FROM conversations WHERE product_id=#{productId} AND buyer_id=#{buyerId}") Map<String, Object> selectRowByProductAndBuyer(@Param("productId") UUID productId, @Param("buyerId") UUID buyerId);
    @Insert("INSERT INTO conversations(id,product_id,buyer_id,seller_id) VALUES(#{id},#{productId},#{buyerId},#{sellerId}) ON CONFLICT(product_id,buyer_id) DO UPDATE SET product_id=EXCLUDED.product_id") int insertOrReuse(@Param("id") UUID id, @Param("productId") UUID productId, @Param("buyerId") UUID buyerId, @Param("sellerId") UUID sellerId);
    @Update("UPDATE conversations SET updated_at=now() WHERE id=#{id}") int touch(@Param("id") UUID id);
    @Select("SELECT count(*) FROM conversations WHERE id=#{id} AND (buyer_id=#{uid} OR seller_id=#{uid})") long countMember(@Param("id") UUID id, @Param("uid") UUID uid);
}
