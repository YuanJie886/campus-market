package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.OrderEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface OrderMapper extends BaseMapper<OrderEntity> {
    @Select("SELECT * FROM orders WHERE buyer_id=#{buyerId} AND idempotency_key=#{key}") List<Map<String, Object>> selectByIdempotency(@Param("buyerId") UUID buyerId, @Param("key") String key);
    @Select("SELECT * FROM orders WHERE id=#{id} FOR UPDATE") OrderEntity selectForUpdate(@Param("id") UUID id);
    @Select("SELECT * FROM orders WHERE expires_at<=now() AND status IN ('PENDING_SELLER_CONFIRM','PENDING_MEETING') FOR UPDATE SKIP LOCKED") List<OrderEntity> selectExpiredForUpdate();
    List<Map<String, Object>> selectRowsByRole(@Param("uid") UUID uid, @Param("role") String role);
    @Select("SELECT * FROM reviews WHERE order_id=#{orderId}") List<Map<String, Object>> selectReviewRows(@Param("orderId") UUID orderId);
    @Update("UPDATE orders SET code_attempts=code_attempts+1 WHERE id=#{id}") int incrementCodeAttempts(@Param("id") UUID id);
}
