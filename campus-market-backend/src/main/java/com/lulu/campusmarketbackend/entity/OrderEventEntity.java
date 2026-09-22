package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("order_events")
public class OrderEventEntity {
    @TableId private UUID id;
    private UUID orderId;
    private UUID actorId;
    private String fromStatus;
    private String toStatus;
    private String reason;
    private OffsetDateTime createdAt;
}
