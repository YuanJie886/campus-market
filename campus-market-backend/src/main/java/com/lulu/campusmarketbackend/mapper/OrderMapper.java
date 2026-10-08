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
    /**
     * 待过期订单。两套独立阈值：
     * 早期状态沿用订单自带的 expires_at；BUYER_CONFIRMED 另用「进入该状态后停留时长」判断，
     * 避免卖家迟迟不核销时订单与商品被永久占用。updated_at 在每次状态迁移时刷新。
     */
    @Select("SELECT * FROM orders WHERE "
            // DISPUTED 同样按 expires_at 过期：没有仲裁角色时，它不能把商品永久占住
            + "(status IN ('PENDING_SELLER_CONFIRM','PENDING_MEETING','DISPUTED') AND expires_at<=now()) "
            + "OR (status='BUYER_CONFIRMED' AND updated_at <= now() - (#{buyerConfirmedHours} * interval '1 hour')) "
            + "FOR UPDATE SKIP LOCKED")
    List<OrderEntity> selectExpiredForUpdate(@Param("buyerConfirmedHours") int buyerConfirmedHours);
    List<Map<String, Object>> selectRowsByRole(@Param("uid") UUID uid, @Param("role") String role);
    Map<String, Object> selectRowWithSummary(@Param("orderId") UUID orderId, @Param("uid") UUID uid);
    List<Map<String, Object>> selectReviewRowsForOrders(@Param("orderIds") List<UUID> orderIds);
    @Select("SELECT * FROM reviews WHERE order_id=#{orderId}") List<Map<String, Object>> selectReviewRows(@Param("orderId") UUID orderId);
    /** 带上限的确认码错误计数自增。调用方已持有该行的 FOR UPDATE 锁，此处的 code_attempts<max 是数据库级硬不变量。 */
    @Update("UPDATE orders SET code_attempts=code_attempts+1 WHERE id=#{id} AND code_attempts<#{max}") int incrementCodeAttempts(@Param("id") UUID id, @Param("max") int max);
}
