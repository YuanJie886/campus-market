package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("conversations")
public class ConversationEntity {
    @TableId private UUID id;
    private UUID productId;
    private UUID buyerId;
    private UUID sellerId;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
