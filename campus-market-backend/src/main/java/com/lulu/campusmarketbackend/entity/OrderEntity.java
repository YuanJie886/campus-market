package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("orders")
public class OrderEntity {
    @TableId private UUID id;
    private UUID productId;
    private UUID buyerId;
    private UUID sellerId;
    private BigDecimal price;
    private String status;
    private String meetingPointId;
    private OffsetDateTime meetingAt;
    private String contact;
    private String confirmationCode;
    private Integer codeAttempts;
    private String idempotencyKey;
    private String requestHash;
    private OffsetDateTime expiresAt;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
