package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("favorites")
public class FavoriteEntity {
    @TableId private UUID id;
    private UUID userId;
    private UUID productId;
    private OffsetDateTime createdAt;
}
