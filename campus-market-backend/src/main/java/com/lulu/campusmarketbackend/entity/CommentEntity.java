package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("comments")
public class CommentEntity {
    @TableId private UUID id;
    private UUID productId;
    private UUID userId;
    private String content;
    private UUID parentId;
    private OffsetDateTime createdAt;
}
