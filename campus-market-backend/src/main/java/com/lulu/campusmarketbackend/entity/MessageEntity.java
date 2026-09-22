package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("messages")
public class MessageEntity {
    @TableId private UUID id;
    private UUID conversationId;
    private UUID senderId;
    private String content;
    private OffsetDateTime createdAt;
}
