package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("conversation_reads")
public class ConversationReadEntity {
    @TableId private UUID conversationId;
    private UUID userId;
    private OffsetDateTime readAt;
}
